import Foundation
import Testing

@testable import Pico

@MainActor
@Suite("Pico model settings transitions", .timeLimit(.minutes(1)))
struct ModelSettingsTests {
    @Test("a refused save keeps the last loaded model and exposes the cause")
    func refusedSave() async {
        let original = snapshot(model: "provider/first", revision: "first")
        let client = ScenarioClient(
            loads: [.ready(original)],
            update: .failure(
                PicoCommandError(code: "AUTH_REQUIRED", message: "Credential is unavailable")
            )
        )
        let settings = ModelSettings(client: client)
        await settings.reload().value
        await settings.chooseModel("provider/second")?.value
        #expect(settings.snapshot == original)
        #expect(settings.saveError == "Credential is unavailable")
        #expect(!settings.isSaving)
    }

    @Test("a conflict reloads external settings rather than retrying or showing the unsaved choice")
    func conflictReloads() async {
        let original = snapshot(model: "provider/first", revision: "first")
        let external = snapshot(model: "provider/external", revision: "external")
        let client = ScenarioClient(
            loads: [.ready(original), .ready(external)],
            update: .failure(
                PicoCommandError(code: "CONFLICT", message: "Changed outside this window")
            )
        )
        let settings = ModelSettings(client: client)
        await settings.reload().value
        await settings.chooseModel("provider/second")?.value
        #expect(settings.snapshot == external)
        #expect(settings.saveError != nil)
        #expect(await client.updateCount == 1)
    }

    @Test("a save uses the receipt's model and reasoning level together")
    func appliesReceipt() async {
        let original = snapshot(model: "provider/first", revision: "first")
        let receipt = PicoSettingsReceipt(
            settingsFile: original.settingsFile,
            after: .init(
                revision: "saved",
                item: .init(defaultModel: "provider/second", defaultThinking: "off")
            )
        )
        let client = ScenarioClient(loads: [.ready(original)], update: .success(receipt))
        let settings = ModelSettings(client: client)
        await settings.reload().value
        await settings.chooseModel("provider/second")?.value
        #expect(settings.snapshot?.item.defaultModel == "provider/second")
        #expect(settings.snapshot?.item.defaultThinking == "off")
        #expect(settings.snapshot?.revision == "saved")
        #expect(settings.saveError == nil)
    }

    @Test("a saved unavailable model is not replaced by an available one")
    func unavailableSavedModel() async {
        let original = snapshot(model: "provider/missing", revision: "first")
        let settings = ModelSettings(client: ScenarioClient(loads: [.ready(original)]))
        await settings.reload().value
        #expect(settings.modelSelection == "provider/missing")
        #expect(settings.selectedModel == nil)
        #expect(settings.snapshot?.models.map(\.value) == ["provider/first", "provider/second"])
    }

    @Test("a built-in choice does not become a saved choice")
    func implicitDefault() async {
        let original = snapshot(model: nil, revision: "none")
        let settings = ModelSettings(client: ScenarioClient(loads: [.ready(original)]))
        await settings.reload().value
        #expect(settings.modelSelection == "")
        #expect(settings.thinkingSelection == "")
        #expect(settings.selectedModel == nil)
        #expect(settings.snapshot?.effective.defaultModel == "provider/first")
    }

    @Test("only the newest load is displayed in either completion order", arguments: [true, false])
    func staleLoad(olderFinishesFirst: Bool) async throws {
        let client = SuspendedLoads()
        let settings = ModelSettings(client: client)
        let older = settings.reload()
        var newer: Task<Void, Never>?
        do {
            try await client.waitForLoads(1)
            newer = settings.reload()
            try await client.waitForLoads(2)
            let latest = snapshot(model: "provider/second", revision: "latest")
            let outdated = snapshot(model: "provider/first", revision: "old")
            if olderFinishesFirst {
                await client.finish(0, with: .ready(outdated))
                await older.value
                #expect(settings.state == .loading)
            }
            await client.finish(1, with: .ready(latest))
            await newer?.value
            if !olderFinishesFirst {
                await client.finish(0, with: .ready(outdated))
                await older.value
            }
            #expect(settings.snapshot == latest)
        } catch {
            await client.cancelAll()
            await older.value
            await newer?.value
            throw error
        }
    }

    @Test("a pending save rejects another mutation but preserves a requested catalog reload")
    func pendingSave() async {
        let original = snapshot(model: "provider/first", revision: "first")
        let client = SuspendedSave(snapshot: original)
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let save = settings.chooseModel("provider/second")
        #expect(settings.isSaving)
        #expect(settings.modelSelection == "provider/first")
        #expect(settings.chooseThinking("off") == nil)
        let refresh = settings.reload()
        #expect(settings.isSaving)
        let refreshedModels = original.models.filter { $0.value == "provider/second" }
        await client.finish(
            .init(
                settingsFile: original.settingsFile,
                after: .init(
                    revision: "saved",
                    item: .init(defaultModel: "provider/second", defaultThinking: "off")
                )
            ),
            models: refreshedModels
        )
        await save?.value
        await refresh.value
        #expect(settings.modelSelection == "provider/second")
        #expect(settings.snapshot?.models == refreshedModels)
        #expect(!settings.isSaving)
    }

    private func snapshot(model: String?, revision: String) -> PicoModelSettings {
        PicoModelSettings(
            settingsFile: "/tmp/pico-tests/settings.json",
            revision: revision,
            item: .init(defaultModel: model, defaultThinking: model == nil ? nil : "high"),
            effective: .init(
                defaultModel: model ?? "provider/first",
                defaultThinking: "high",
                available: true
            ),
            models: [
                .init(
                    value: "provider/first",
                    name: "First",
                    provider: "provider",
                    thinking: [.init(value: "high", name: "High")]
                ),
                .init(
                    value: "provider/second",
                    name: "Second",
                    provider: "provider",
                    thinking: [.init(value: "off", name: "Off")]
                ),
            ]
        )
    }
}

private actor ScenarioClient: PicoSettingsServing {
    private(set) var updateCount = 0
    private var loads: [PicoSettingsLoad]
    private let updateResult: Result<PicoSettingsReceipt, PicoCommandError>

    init(
        loads: [PicoSettingsLoad],
        update: Result<PicoSettingsReceipt, PicoCommandError> = .failure(
            .init(message: "Unexpected save")
        )
    ) {
        self.loads = loads
        updateResult = update
    }

    func load() async throws -> PicoSettingsLoad {
        loads.removeFirst()
    }

    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
    {
        updateCount += 1
        return try updateResult.get()
    }
}

private actor SuspendedLoads: PicoSettingsServing {
    private var pending: [CheckedContinuation<PicoSettingsLoad, any Error>?] = []

    func cancelAll() {
        for index in pending.indices {
            pending[index]?.resume(throwing: CancellationError())
            pending[index] = nil
        }
    }

    func finish(_ index: Int, with snapshot: PicoSettingsLoad) {
        pending[index]?.resume(returning: snapshot)
        pending[index] = nil
    }

    func load() async throws -> PicoSettingsLoad {
        try await withCheckedThrowingContinuation { pending.append($0) }
    }

    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
    {
        throw PicoCommandError(message: "Unexpected save")
    }

    func waitForLoads(_ count: Int) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while pending.count < count {
            guard ContinuousClock.now < deadline else {
                throw PicoCommandError(message: "The expected load did not start")
            }
            try await Task.sleep(for: .milliseconds(5))
        }
    }
}

private actor SuspendedSave: PicoSettingsServing {
    private var snapshot: PicoModelSettings
    private let receipt = AsyncStream<PicoSettingsReceipt>.makeStream()

    init(snapshot: PicoModelSettings) {
        self.snapshot = snapshot
    }

    func finish(_ saved: PicoSettingsReceipt, models: [PicoModel]) {
        let applied = snapshot.applying(saved)
        snapshot = PicoModelSettings(
            settingsFile: applied.settingsFile,
            revision: applied.revision,
            item: applied.item,
            effective: applied.effective,
            models: models
        )
        receipt.continuation.yield(saved)
        receipt.continuation.finish()
    }

    func load() async throws -> PicoSettingsLoad {
        .ready(snapshot)
    }

    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
    {
        for await saved in receipt.stream { return saved }
        throw CancellationError()
    }
}
