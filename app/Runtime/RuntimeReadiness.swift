import Foundation
import Observation

/// What Pico knows about the command it runs: where it is, whether it starts, and — only when
/// the user asks — how its version compares with the one Homebrew publishes. Nothing here
/// refreshes Homebrew's metadata or changes a package on its own.
@MainActor
@Observable
final class RuntimeReadiness {
    private(set) var actionFailure: String?
    private(set) var activity: Activity?
    private(set) var installation: Installation = .unknown
    private(set) var isHomebrewAvailable: Bool
    private(set) var startup: Startup = .unknown
    private(set) var updates: Updates = .notChecked

    @ObservationIgnored private let client: any PicoRuntimeServing
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var isStopping = false
    @ObservationIgnored private var lastKnown: Known?
    @ObservationIgnored private var location: PicoRuntimeLocation?
    @ObservationIgnored private var operation: Task<Void, Never>?

    init(client: any PicoRuntimeServing) {
        self.client = client
        isHomebrewAvailable = client.isHomebrewAvailable
    }

    var isBusy: Bool { activity != nil }

    /// The one action General offers for the state Pico observed, or none when there is
    /// nothing Pico can honestly offer to do about it. Trust comes first: until Homebrew may
    /// load the tap, no package command can succeed.
    var recovery: Recovery? {
        if case .tapNotTrusted = updates { return .trustTap }
        if case .homebrewUnsupported = updates { return .installHomebrew }
        if case .unlinked = updates {
            return isHomebrewAvailable ? .reinstall : .installHomebrew
        }
        if case .missing = installation {
            guard isHomebrewAvailable else { return .installHomebrew }
            return canInstall ? .install : nil
        }
        switch updates {
        case .available: return isHomebrewAvailable ? .upgrade : .installHomebrew
        case .homebrewUnavailable: return .installHomebrew
        case .notInstalled: return canInstall ? .install : nil
        default: break
        }
        guard case .failed = startup else { return nil }
        guard isHomebrewAvailable, location?.isHomebrewManaged == true else { return nil }
        return .reinstall
    }

    /// Stops whatever is running and hands back the task that joins it, so nothing starts
    /// while the stopped command is still being reaped and a caller that must not outlive it
    /// — the app on its way out — can wait. Whatever the stopped work was in the middle of
    /// checking goes back to the last state Pico observed, because it observed nothing.
    @discardableResult
    func cancel() -> Task<Void, Never>? {
        guard let running = operation else { return nil }
        guard !isStopping else { return running }
        generation += 1
        isStopping = true
        running.cancel()
        activity = .stopping
        restoreLastKnown()
        let join = Task { [weak self] in
            await running.value
            self?.stopped()
        }
        operation = join
        return join
    }

    /// Stops whatever is running and waits for the command, or Homebrew, to be reaped. Safe
    /// to call after `cancel()`: it joins the same work rather than starting a second stop.
    func cancelAndWait() async {
        await cancel()?.value
    }

    /// The local checks: where the command is and whether it starts. Returns the operation
    /// already running rather than starting a second one.
    @discardableResult
    func check() -> Task<Void, Never> {
        if let operation { return operation }
        actionFailure = nil
        let request = begin(.checking)
        let task = Task { [weak self] in
            guard let self else { return }
            await checkCommand(request)
            finish(request)
        }
        operation = task
        return task
    }

    /// The only path that refreshes Homebrew's metadata, and only because the user asked.
    @discardableResult
    func checkForUpdates() -> Task<Void, Never>? {
        guard operation == nil else { return nil }
        let request = begin(.checkingUpdates)
        let task = Task { [weak self] in
            guard let self else { return }
            await checkUpdates(request, refreshing: true)
            finish(request)
        }
        operation = task
        return task
    }

    /// Runs one confirmed Homebrew action, then checks what is actually installed. A package
    /// command that succeeded is no evidence that the command starts.
    @discardableResult
    func perform(_ action: HomebrewAction) -> Task<Void, Never>? {
        guard operation == nil else { return nil }
        actionFailure = nil
        let request = begin(.running(action))
        let task = Task { [weak self] in
            guard let self else { return }
            await run(action, request)
            finish(request)
        }
        operation = task
        return task
    }

    /// Whether installing the formula would give the user the command Pico runs. It would not
    /// when they chose one with `-PicoExecutable`: Homebrew does not write to that path.
    private var canInstall: Bool {
        isHomebrewAvailable && client.chosenExecutable == nil
    }

    private var runningVersion: String? {
        if case .starts(let version) = startup { return version } else { return nil }
    }

    /// Starts one operation: a new request number, the state to go back to if it is
    /// cancelled, whether Homebrew is there now, and what the user is told is happening.
    private func begin(_ activity: Activity) -> Int {
        generation += 1
        isHomebrewAvailable = client.isHomebrewAvailable
        lastKnown = Known(installation: installation, startup: startup, updates: updates)
        self.activity = activity
        return generation
    }

    private func checkCommand(_ request: Int) async {
        guard isCurrent(request) else { return }
        let previousPath = location?.path
        let previousVersion = runningVersion
        installation = .checking
        startup = .checking
        guard let observed = await observeCommand(), isCurrent(request) else { return }
        installation = observed.installation
        location = observed.location
        startup = observed.startup
        // A different command, or a different version of it, says nothing about what the
        // last update check found.
        if observed.location?.path != previousPath || runningVersion != previousVersion {
            updates = .notChecked
        }
        let knownUpdates = updates == .checking ? lastKnown?.updates ?? .notChecked : updates
        lastKnown = Known(installation: installation, startup: startup, updates: knownUpdates)
    }

    private func checkUpdates(_ request: Int, refreshing: Bool) async {
        guard isCurrent(request) else { return }
        guard isHomebrewAvailable else {
            updates = .homebrewUnavailable
            return
        }
        updates = .checking
        do {
            if refreshing {
                try await client.refreshFormula()
                guard isCurrent(request) else { return }
                await checkCommand(request)
                guard isCurrent(request) else { return }
                updates = .checking
            }
            let inspection = try await client.inspectFormula()
            guard isCurrent(request) else { return }
            switch inspection {
            case .formula(let formula): updates = compare(formula)
            case .tapNotTrusted: updates = .tapNotTrusted
            case .unsupported(let version): updates = .homebrewUnsupported(version)
            }
        } catch is CancellationError {
            return
        } catch {
            guard isCurrent(request) else { return }
            updates = .failed(describe(error))
        }
    }

    /// Compares what Pico runs with what Homebrew publishes. A command Homebrew does not
    /// manage is reported as it is: installing or upgrading the formula would not change it.
    /// The running command is read first, so a development build ahead of the formula is
    /// never offered an update that would replace it with an older one.
    private func compare(_ formula: HomebrewFormula) -> Updates {
        if let location, !location.isHomebrewManaged {
            return .custom(location.path, formula.packageVersion)
        }
        if location == nil, let chosen = client.chosenExecutable {
            return .custom(chosen, formula.packageVersion)
        }
        guard !formula.installedVersions.isEmpty else {
            return .notInstalled(formula.packageVersion)
        }
        guard let keg = formula.linkedVersion else {
            return .unlinked(formula.installedVersions)
        }
        if let running = runningVersion, let local = RuntimeVersion(running),
            let stable = RuntimeVersion(formula.stableVersion), local > stable
        {
            return .development(running, formula.packageVersion)
        }
        // The installed keg and the formula's package version share Homebrew's own scheme,
        // including its revisions; the version the command reports does not.
        guard let installed = RuntimeVersion(keg),
            let published = RuntimeVersion(formula.packageVersion)
        else {
            return keg == formula.packageVersion
                ? .current(runningVersion ?? keg)
                : .failed(.cannotCompare(running: keg, published: formula.packageVersion))
        }
        if installed > published { return .development(keg, formula.packageVersion) }
        if installed < published || formula.isOutdated {
            return .available(runningVersion ?? keg, formula.packageVersion)
        }
        if let running = runningVersion, let local = RuntimeVersion(running),
            let stable = RuntimeVersion(formula.stableVersion), local < stable
        {
            return .available(running, formula.packageVersion)
        }
        return .current(runningVersion ?? keg)
    }

    private func describe(_ error: any Error) -> String {
        (error as? PicoCommandError)?.message ?? error.localizedDescription
    }

    private func finish(_ request: Int) {
        guard isCurrent(request) else { return }
        activity = nil
        lastKnown = nil
        operation = nil
    }

    private func isCurrent(_ request: Int) -> Bool {
        request == generation
    }

    /// Nil when the work was cancelled, so a cancelled check leaves the last state alone.
    private func observeCommand() async -> Observed? {
        let found: PicoRuntimeLocation
        do {
            found = try await client.locate()
        } catch is CancellationError {
            return nil
        } catch {
            return Observed(
                installation: .missing(describe(error)),
                location: nil,
                startup: .unknown
            )
        }
        do {
            let version = try await client.version(of: found)
            return Observed(
                installation: .installed(found.path),
                location: found,
                startup: .starts(version)
            )
        } catch is CancellationError {
            return nil
        } catch {
            return Observed(
                installation: .installed(found.path),
                location: found,
                startup: .failed(describe(error))
            )
        }
    }

    private func restoreLastKnown() {
        guard let lastKnown else { return }
        if installation == .checking { installation = lastKnown.installation }
        if startup == .checking { startup = lastKnown.startup }
        if updates == .checking { updates = lastKnown.updates }
        self.lastKnown = nil
    }

    private func run(_ action: HomebrewAction, _ request: Int) async {
        guard isHomebrewAvailable else {
            updates = .homebrewUnavailable
            return
        }
        do {
            try await client.perform(action)
        } catch is CancellationError {
            return
        } catch {
            guard isCurrent(request) else { return }
            actionFailure = describe(error)
        }
        await checkCommand(request)
        await checkUpdates(request, refreshing: false)
    }

    private func stopped() {
        guard isStopping else { return }
        isStopping = false
        activity = nil
        lastKnown = nil
        operation = nil
    }
}

extension RuntimeReadiness {
    enum Activity: Equatable, Sendable {
        case checking
        case checkingUpdates
        case running(HomebrewAction)
        case stopping
    }

    enum Installation: Equatable, Sendable {
        case unknown
        case checking
        case installed(String)
        case missing(String)
    }

    enum Recovery: Equatable, Sendable {
        case install
        case installHomebrew
        case reinstall
        case trustTap
        case upgrade
    }

    enum Startup: Equatable, Sendable {
        case unknown
        case checking
        case starts(String)
        case failed(String)
    }

    enum Updates: Equatable, Sendable {
        case notChecked
        case checking
        case current(String)
        case available(String, String)
        case development(String, String)
        case notInstalled(String)
        case unlinked([String])
        case custom(String, String)
        case tapNotTrusted
        case homebrewUnavailable
        case homebrewUnsupported(String)
        case failed(String)
    }

    /// What Pico last observed, so cancelling a check does not leave a row saying it is
    /// still checking.
    private struct Known {
        let installation: Installation
        let startup: Startup
        let updates: Updates
    }

    private struct Observed {
        let installation: Installation
        let location: PicoRuntimeLocation?
        let startup: Startup
    }
}

extension String {
    fileprivate static func cannotCompare(running: String, published: String) -> String {
        String(
            localized:
                "Pico can't compare the version it runs, \(running), with the published \(published)."
        )
    }
}
