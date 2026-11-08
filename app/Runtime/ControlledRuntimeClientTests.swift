import Foundation

@testable import Pico

/// A stand-in for the runtime client. It answers the way one real environment would, counts
/// every call so a test can prove what readiness did and did not run, and can hold a call in
/// flight so a test can watch an operation while it is still going.
actor ControlledRuntimeClient: PicoRuntimeServing {
    nonisolated let chosenExecutable: String?

    private(set) var actions: [HomebrewAction] = []
    private(set) var inspections = 0
    private(set) var installedVersionReads = 0
    private(set) var locations = 0
    private(set) var refreshes = 0
    private(set) var versions = 0

    /// Read without the actor's isolation, as the protocol requires, and changed by a test
    /// that installs Homebrew while Pico is running.
    private nonisolated let homebrew: Availability

    private var actionResult: Result<Void, PicoCommandError> = .success(())
    private var inspectionResult: Result<HomebrewInspection, PicoCommandError>
    private var installedByAction: String?
    private var isHeld = false
    private var installedVersionsResult: Result<InstalledVersions, PicoCommandError>
    private var suspendNextInspection = false
    private var heldCalls: [CheckedContinuation<Void, Never>] = []
    private var locationResult: Result<PicoRuntimeLocation, PicoCommandError>
    private var refreshResult: Result<Void, PicoCommandError> = .success(())
    private var versionResult: Result<String, PicoCommandError>

    init(
        isHomebrewAvailable: Bool = true,
        chosenExecutable: String? = nil,
        location: Result<PicoRuntimeLocation, PicoCommandError> = .success(.homebrew),
        version: Result<String, PicoCommandError> = .success("0.1.0"),
        installedVersions: Result<InstalledVersions, PicoCommandError> = .success(
            InstalledVersions(pico: "0.1.0", omp: "18.14.0")
        ),
        inspection: Result<HomebrewInspection, PicoCommandError> = .success(.formula(.fixture()))
    ) {
        self.chosenExecutable = chosenExecutable
        homebrew = Availability(isHomebrewAvailable)
        inspectionResult = inspection
        locationResult = location
        installedVersionsResult = installedVersions
        versionResult = version
    }

    nonisolated var isHomebrewAvailable: Bool { homebrew.isAvailable }

    func failAction(_ failure: PicoCommandError) {
        actionResult = .failure(failure)
    }

    func failInspection(_ failure: PicoCommandError) {
        inspectionResult = .failure(failure)
    }

    func failRefresh(_ failure: PicoCommandError) {
        refreshResult = .failure(failure)
    }

    /// Stops answering until `release()`, so a test can see an operation while it runs.
    func hold() {
        isHeld = true
    }

    func holdNextInspection() {
        suspendNextInspection = true
    }

    func inspectFormula() async throws -> HomebrewInspection {
        if suspendNextInspection {
            suspendNextInspection = false
            isHeld = true
        }
        inspections += 1
        await waitWhileHeld()
        return try inspectionResult.get()
    }

    /// What a successful package action leaves behind: the version the command then reports,
    /// with the same engine, and a formula whose linked keg matches it.
    func installs(_ version: String) {
        installedByAction = version
    }

    func installedVersions(of location: PicoRuntimeLocation) async throws -> InstalledVersions {
        installedVersionReads += 1
        await waitWhileHeld()
        return try installedVersionsResult.get()
    }

    func locate() async throws -> PicoRuntimeLocation {
        locations += 1
        await waitWhileHeld()
        return try locationResult.get()
    }

    func perform(_ action: HomebrewAction) async throws {
        actions.append(action)
        await waitWhileHeld()
        try actionResult.get()
        guard let installedByAction else { return }
        versionResult = .success(installedByAction)
        installedVersionsResult = .success(
            InstalledVersions(pico: installedByAction, omp: "18.14.0")
        )
        inspectionResult = .success(
            .formula(
                .fixture(
                    stable: installedByAction,
                    installed: [installedByAction],
                    linked: installedByAction
                )
            )
        )
    }

    func refreshFormula() async throws {
        refreshes += 1
        await waitWhileHeld()
        try refreshResult.get()
    }

    func release() {
        suspendNextInspection = false
        isHeld = false
        for continuation in heldCalls { continuation.resume() }
        heldCalls.removeAll(keepingCapacity: true)
    }

    /// The command answering with a different version, as a replaced executable would.
    func reports(_ version: String) {
        versionResult = .success(version)
    }

    /// Homebrew appearing, or going away, between one operation and the next.
    nonisolated func setHomebrewAvailable(_ isAvailable: Bool) {
        homebrew.set(isAvailable)
    }

    func version(of location: PicoRuntimeLocation) async throws -> String {
        versions += 1
        await waitWhileHeld()
        return try versionResult.get()
    }

    func waitForActions(_ count: Int) async throws {
        try await waitUntil { await self.actions.count >= count }
    }

    func waitForLocations(_ count: Int) async throws {
        try await waitUntil { await self.locations >= count }
    }
    func waitForInspections(_ count: Int) async throws {
        try await waitUntil { await self.inspections >= count }
    }

    private func waitUntil(_ condition: @Sendable () async -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while await !condition() {
            guard ContinuousClock.now < deadline else {
                throw PicoCommandError(message: "The runtime client was never asked")
            }
            try await Task.sleep(for: .milliseconds(5))
        }
    }

    private func waitWhileHeld() async {
        guard isHeld else { return }
        await withCheckedContinuation { heldCalls.append($0) }
    }
}

extension ControlledRuntimeClient {
    /// Whether Homebrew is there, readable from outside the actor because the client answers
    /// that question without waiting.
    private final class Availability: @unchecked Sendable {
        private let lock = NSLock()
        private var value: Bool

        init(_ value: Bool) {
            self.value = value
        }

        var isAvailable: Bool { lock.withLock { value } }

        func set(_ newValue: Bool) {
            lock.withLock { value = newValue }
        }
    }
}

extension HomebrewFormula {
    /// A published formula, installed and linked at the same version unless a test says
    /// otherwise.
    static func fixture(
        stable: String = "0.1.0",
        package: String? = nil,
        installed: [String] = ["0.1.0"],
        linked: String? = "0.1.0",
        isOutdated: Bool = false
    ) -> HomebrewFormula {
        HomebrewFormula(
            installedVersions: installed,
            isOutdated: isOutdated,
            linkedVersion: linked,
            packageVersion: package ?? stable,
            stableVersion: stable
        )
    }
}

extension PicoRuntimeLocation {
    static let custom = PicoRuntimeLocation(path: "/tmp/pico-tests/pico", isHomebrewManaged: false)
    static let homebrew = PicoRuntimeLocation(
        path: "/opt/homebrew/bin/pico",
        isHomebrewManaged: true
    )
}
