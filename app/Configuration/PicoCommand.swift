import Foundation

struct PicoCommand: Sendable {
    private let executable: URL
    private let timeout: TimeInterval

    init(executable: URL, timeout: TimeInterval = 30) {
        self.executable = executable
        self.timeout = timeout
    }

    /// Runs once, with cancellation stopping and reaping the command before returning.
    func run(_ arguments: [String]) async throws -> Data {
        let outcome: PicoProcessOutcome
        do {
            outcome = try await PicoProcessRun(
                executable: executable,
                arguments: arguments,
                timeout: timeout
            ).run()
        } catch let failure as PicoProcessFailure {
            throw error(for: failure)
        }
        guard outcome.status == 0 else { throw failure(from: outcome) }
        try requireSupportedVersion(of: outcome.standardOutput)
        return outcome.standardOutput
    }

    private func detail(of lines: [String]) -> String {
        String(lines.suffix(3).joined(separator: " ").prefix(400))
    }

    private func error(for failure: PicoProcessFailure) -> PicoCommandError {
        switch failure {
        case .cannotStart(let reason):
            PicoCommandError(
                message: .cannotStart(path: executable.path, reason: reason.localizedDescription)
            )
        case .timedOut:
            PicoCommandError(message: .tookTooLong(path: executable.path, seconds: timeout))
        }
    }

    private func failure(from outcome: PicoProcessOutcome) -> PicoCommandError {
        let lines = String(decoding: outcome.standardError, as: UTF8.self)
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        if let reported = ErrorDocument(line: lines.last ?? "") {
            guard reported.apiVersion == 1 else { return unsupportedVersion(reported.apiVersion) }
            return PicoCommandError(code: reported.error.code, message: reported.error.message)
        }
        guard !lines.isEmpty else {
            return PicoCommandError(
                message: .endedWithStatus(path: executable.path, status: Int(outcome.status))
            )
        }
        return PicoCommandError(
            message: .failedPrinting(path: executable.path, detail: detail(of: lines))
        )
    }

    private func requireSupportedVersion(of document: Data) throws {
        guard let result = try? JSONDecoder().decode(ResultDocument.self, from: document) else {
            throw PicoCommandError(message: .unreadableDocument(path: executable.path))
        }
        guard result.apiVersion == 1 else { throw unsupportedVersion(result.apiVersion) }
    }

    private func unsupportedVersion(_ version: Int?) -> PicoCommandError {
        guard let version else {
            return PicoCommandError(message: .documentWithoutVersion(path: executable.path))
        }
        return PicoCommandError(
            message: .unsupportedVersion(version, path: executable.path)
        )
    }
}

extension PicoCommand {
    private struct ErrorDocument: Decodable {
        struct Reported: Decodable {
            let code: String
            let message: String
        }

        let apiVersion: Int?
        let error: Reported

        init?(line: String) {
            guard let data = line.data(using: .utf8),
                let document = try? JSONDecoder().decode(Self.self, from: data)
            else { return nil }
            self = document
        }
    }

    private struct ResultDocument: Decodable {
        let apiVersion: Int?
    }
}

extension String {
    fileprivate static func cannotStart(path: String, reason: String) -> String {
        String(localized: "Pico couldn't start the pico command at \(path). \(reason)")
    }

    fileprivate static func documentWithoutVersion(path: String) -> String {
        String(
            localized:
                "The pico command at \(path) answered without a command API version Pico supports."
        )
    }

    fileprivate static func endedWithStatus(path: String, status: Int) -> String {
        String(
            localized:
                "The pico command at \(path) ended with status \(status) and reported no problem."
        )
    }

    fileprivate static func failedPrinting(path: String, detail: String) -> String {
        String(localized: "The pico command at \(path) failed: \(detail)")
    }

    fileprivate static func tookTooLong(path: String, seconds: TimeInterval) -> String {
        String(
            localized:
                "The pico command at \(path) did not answer within \(seconds.formatted()) seconds and was stopped."
        )
    }

    fileprivate static func unreadableDocument(path: String) -> String {
        String(localized: "Pico couldn't read what the pico command at \(path) printed.")
    }

    fileprivate static func unsupportedVersion(_ version: Int, path: String) -> String {
        String(
            localized:
                "The pico command at \(path) uses command API version \(version), which this version of Pico doesn't support."
        )
    }
}
