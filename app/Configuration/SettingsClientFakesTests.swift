import Foundation

@testable import Pico

extension PicoModelSettings {
    /// What `pico settings get` returns for this snapshot, for fakes that serve the settings
    /// read and the model catalog separately.
    var settingsRead: PicoSettingsRead {
        .ready(settingsFile: settingsFile, revision: revision, item: item, effective: effective)
    }
}

/// A client whose two reads answer immediately with fixed results.
struct FixedReadsClient: PicoSettingsServing {
    let catalog: Result<[PicoModel], PicoCommandError>
    let settings: Result<PicoSettingsRead, PicoCommandError>

    func readCatalog() async throws -> [PicoModel] {
        try catalog.get()
    }

    func readSettings() async throws -> PicoSettingsRead {
        try settings.get()
    }

    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
    {
        throw PicoCommandError(message: "Unexpected save")
    }
}

/// A client that holds each read open until the test answers it, so a test can order the
/// catalog and the settings read against each other.
actor SuspendedReadsClient: PicoSettingsServing {
    private var catalog = PendingReads<[PicoModel]>()
    private var settings = PendingReads<PicoSettingsRead>()

    func cancelAll() {
        catalog.cancelAll()
        settings.cancelAll()
    }

    func finishCatalog(_ index: Int, with result: Result<[PicoModel], PicoCommandError>) {
        catalog.finish(index, with: result)
    }

    func finishSettings(_ index: Int, with result: Result<PicoSettingsRead, PicoCommandError>) {
        settings.finish(index, with: result)
    }

    func readCatalog() async throws -> [PicoModel] {
        try await withCheckedThrowingContinuation { catalog.append($0) }
    }

    func readSettings() async throws -> PicoSettingsRead {
        try await withCheckedThrowingContinuation { settings.append($0) }
    }

    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
    {
        throw PicoCommandError(message: "Unexpected save")
    }

    func waitForCatalogReads(_ count: Int) async throws {
        try await wait { catalog.count >= count }
    }

    func waitForSettingsReads(_ count: Int) async throws {
        try await wait { settings.count >= count }
    }

    private func wait(for started: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while !started() {
            guard ContinuousClock.now < deadline else {
                throw PicoCommandError(message: "The expected read did not start")
            }
            try await Task.sleep(for: .milliseconds(5))
        }
    }
}

/// The reads a fake client holds open, in the order they arrived.
private struct PendingReads<Value: Sendable> {
    private var continuations: [CheckedContinuation<Value, any Error>?] = []

    var count: Int { continuations.count }

    mutating func append(_ continuation: CheckedContinuation<Value, any Error>) {
        continuations.append(continuation)
    }

    mutating func cancelAll() {
        for index in continuations.indices { resume(index, with: .failure(CancellationError())) }
    }

    mutating func finish(_ index: Int, with result: Result<Value, PicoCommandError>) {
        resume(index, with: result.mapError { $0 as any Error })
    }

    private mutating func resume(_ index: Int, with outcome: Result<Value, any Error>) {
        continuations[index]?.resume(with: outcome)
        continuations[index] = nil
    }
}
