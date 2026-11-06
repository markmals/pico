import Foundation

/// Homebrew, run from where it is installed rather than from a shell. Pico replaces the
/// environment outright: no automatic metadata refresh, no cleanup of the versions running
/// sessions are still using, no `sudo`, no prompts, and a PATH of Homebrew's own making.
struct HomebrewCommand: Sendable {
    /// Where Homebrew's installer puts it, on Apple silicon and on Intel.
    static let defaultCandidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]

    /// The formula `pico` ships as, and the tap it comes from.
    static let formula = "markmals/tap/pico"
    static let tap = "markmals/tap"

    private static let disabled = [
        "HOMEBREW_NO_ANALYTICS",
        "HOMEBREW_NO_ASK",
        "HOMEBREW_NO_AUTOREMOVE",
        "HOMEBREW_NO_AUTO_UPDATE",
        "HOMEBREW_NO_COLOR",
        "HOMEBREW_NO_EMOJI",
        "HOMEBREW_NO_ENV_HINTS",
        "HOMEBREW_NO_INSTALL_CLEANUP",
        "HOMEBREW_NO_SUDO",
    ]
    private static let inherited = ["HOME", "LANG", "LOGNAME", "TMPDIR", "USER"]

    let executable: URL
    let prefix: URL

    /// Homebrew where it is installed. Nothing is read from PATH: a Finder launch has none
    /// of a shell's.
    static func installed(
        candidates: [String] = defaultCandidates,
        owning pico: URL? = nil
    ) -> HomebrewCommand? {
        let resolvedPico = pico?.resolvingSymlinksInPath().path
        var first: HomebrewCommand?
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            let executable = URL(fileURLWithPath: path)
            let prefix = executable.deletingLastPathComponent().deletingLastPathComponent()
            let command = HomebrewCommand(executable: executable, prefix: prefix)
            if first == nil { first = command }
            guard let resolvedPico else { continue }
            let root = prefix.resolvingSymlinksInPath()
            if pico?.standardizedFileURL.path == prefix.appendingPathComponent("bin/pico").path
                || resolvedPico.hasPrefix(root.appendingPathComponent("Cellar/pico").path + "/")
            {
                return command
            }
        }
        return first
    }

    var environment: [String: String] {
        let launched = ProcessInfo.processInfo.environment
        var environment = [String: String]()
        for key in Self.inherited {
            environment[key] = launched[key]
        }
        for key in Self.disabled {
            environment[key] = "1"
        }
        environment["PATH"] = "\(prefix.path)/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        return environment
    }

    /// Runs Homebrew and keeps what it printed within `retention`. Homebrew starts programs
    /// of its own, so stopping the command stops the whole group it leads. An answer that
    /// outgrew its limit is a failure: Pico never reads a truncated one as a whole answer.
    func run(
        _ arguments: [String],
        retention: PicoProcessRun.OutputRetention,
        timeout: TimeInterval
    ) async throws -> Data {
        let outcome: PicoProcessOutcome
        do {
            outcome = try await PicoProcessRun(
                executable: executable,
                arguments: arguments,
                environment: environment,
                outputRetention: retention,
                stopsDescendants: true,
                timeout: timeout
            ).run()
        } catch let failure as PicoProcessFailure {
            throw error(for: failure, command: arguments, timeout: timeout)
        }
        guard outcome.status == 0 else { throw failure(from: outcome, command: arguments) }
        guard !outcome.isOutputTruncated else {
            throw PicoCommandError(message: .homebrewAnsweredTooMuch(command: name(of: arguments)))
        }
        return outcome.standardOutput
    }

    private func detail(of outcome: PicoProcessOutcome) -> String {
        let lines = String(decoding: outcome.standardError, as: UTF8.self)
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return String(lines.suffix(3).joined(separator: " ").prefix(400))
    }

    private func error(
        for failure: PicoProcessFailure,
        command: [String],
        timeout: TimeInterval
    ) -> PicoCommandError {
        switch failure {
        case .cannotStart(let reason):
            PicoCommandError(
                message: .homebrewCannotStart(
                    path: executable.path,
                    reason: reason.localizedDescription
                )
            )
        case .timedOut:
            PicoCommandError(
                message: .homebrewTookTooLong(command: name(of: command), seconds: timeout)
            )
        }
    }

    private func failure(from outcome: PicoProcessOutcome, command: [String]) -> PicoCommandError {
        let detail = detail(of: outcome)
        guard !detail.isEmpty else {
            return PicoCommandError(
                message: .homebrewEndedWithStatus(
                    command: name(of: command),
                    status: Int(outcome.status)
                )
            )
        }
        return PicoCommandError(
            message: .homebrewFailed(command: name(of: command), detail: detail)
        )
    }

    private func name(of command: [String]) -> String {
        "brew \(command.joined(separator: " "))"
    }
}

extension String {
    fileprivate static func homebrewAnsweredTooMuch(command: String) -> String {
        String(
            localized:
                "\(command) printed more than Pico can read, so Pico can't trust what it says."
        )
    }

    fileprivate static func homebrewCannotStart(path: String, reason: String) -> String {
        String(localized: "Pico couldn't start Homebrew at \(path). \(reason)")
    }

    fileprivate static func homebrewEndedWithStatus(command: String, status: Int) -> String {
        String(localized: "\(command) ended with status \(status) and reported no problem.")
    }

    fileprivate static func homebrewFailed(command: String, detail: String) -> String {
        String(localized: "\(command) failed: \(detail)")
    }

    fileprivate static func homebrewTookTooLong(command: String, seconds: TimeInterval) -> String {
        String(
            localized:
                "\(command) did not finish within \(seconds.formatted()) seconds and was stopped."
        )
    }
}
