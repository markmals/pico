import Foundation
import Testing

@testable import Pico

@MainActor
@Suite("Pico model settings transitions", .timeLimit(.minutes(1)))
struct ModelSettingsTests {
    @Test(
        "a refused save restores confirmed choices and exposes the cause",
        arguments: [nil, "provider/first"] as [String?]
    )
    func refusedSave(model: String?) async {
        let original = snapshot(model: model, revision: "first")
        let client = ScenarioClient(
            loads: [original],
            update: .failure(
                PicoCommandError(code: "AUTH_REQUIRED", message: "Credential is unavailable")
            )
        )
        let settings = ModelSettings(client: client)
        await settings.reload().value
        await settings.chooseModel("provider/second")?.value
        #expect(settings.snapshot == original)
        #expect(settings.modelSelection == (model ?? ""))
        #expect(settings.saveError == "Credential is unavailable")
        #expect(!settings.isSaving)
    }

    @Test("a conflict reloads external settings rather than retrying or showing the unsaved choice")
    func conflictReloads() async {
        let original = snapshot(model: "provider/first", revision: "first")
        let external = snapshot(model: "provider/external", revision: "external")
        let client = ScenarioClient(
            loads: [original, external],
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
        let client = ScenarioClient(loads: [original], update: .success(receipt))
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
        let settings = ModelSettings(client: ScenarioClient(loads: [original]))
        await settings.reload().value
        #expect(settings.modelSelection == "provider/missing")
        #expect(settings.selectedModel == nil)
        #expect(settings.snapshot?.models.map(\.value) == ["provider/first", "provider/second"])
    }

    @Test("a built-in choice does not become a saved choice")
    func implicitDefault() async {
        let original = snapshot(model: nil, revision: "none")
        let settings = ModelSettings(client: ScenarioClient(loads: [original]))
        await settings.reload().value
        #expect(settings.modelSelection == "")
        #expect(settings.thinkingSelection == "")
        #expect(settings.selectedModel == nil)
        #expect(settings.snapshot?.effective.defaultModel == "provider/first")
    }

    @Test("only the newest load is displayed in either completion order", arguments: [true, false])
    func staleLoad(olderFinishesFirst: Bool) async throws {
        let client = SuspendedReadsClient()
        let settings = ModelSettings(client: client)
        let older = settings.reload()
        var newer: Task<Void, Never>?
        do {
            try await client.waitForCatalogReads(1)
            try await client.waitForSettingsReads(1)
            newer = settings.reload()
            try await client.waitForCatalogReads(2)
            try await client.waitForSettingsReads(2)
            let latest = snapshot(model: "provider/second", revision: "latest")
            let outdated = snapshot(model: "provider/first", revision: "old")
            if olderFinishesFirst {
                await client.finishSettings(0, with: .success(outdated.settingsRead))
                await client.finishCatalog(0, with: .success(outdated.models))
                await older.value
                #expect(settings.state == .loading)
            }
            await client.finishSettings(1, with: .success(latest.settingsRead))
            await client.finishCatalog(1, with: .success(latest.models))
            await newer?.value
            if !olderFinishesFirst {
                await client.finishSettings(0, with: .success(outdated.settingsRead))
                await client.finishCatalog(0, with: .success(outdated.models))
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

    @Test("a pending save shows its selection immediately and preserves a requested catalog reload")
    func pendingSave() async {
        let original = snapshot(model: "provider/first", revision: "first")
        let client = SuspendedSave(snapshot: original)
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let save = settings.chooseModel("provider/second")
        #expect(settings.isSaving)
        #expect(settings.modelSelection == "provider/second")
        #expect(settings.thinkingSelection == "off")
        #expect(settings.snapshot?.item == original.item)
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
                    thinking: [.init(value: "high", name: "High")],
                    defaultThinking: "high"
                ),
                .init(
                    value: "provider/second",
                    name: "Second",
                    provider: "provider",
                    thinking: [.init(value: "off", name: "Off")],
                    defaultThinking: "off"
                ),
            ]
        )
    }
}

private actor ScenarioClient: PicoSettingsServing {
    private(set) var updateCount = 0
    private let catalog: [PicoModel]
    private var reads: [PicoSettingsRead]
    private let updateResult: Result<PicoSettingsReceipt, PicoCommandError>

    init(
        loads: [PicoModelSettings],
        update: Result<PicoSettingsReceipt, PicoCommandError> = .failure(
            .init(message: "Unexpected save")
        )
    ) {
        catalog = loads.first?.models ?? []
        reads = loads.map(\.settingsRead)
        updateResult = update
    }

    func readCatalog() async throws -> [PicoModel] {
        catalog
    }

    func readSettings() async throws -> PicoSettingsRead {
        reads.removeFirst()
    }

    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
    {
        updateCount += 1
        return try updateResult.get()
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

    func readCatalog() async throws -> [PicoModel] {
        snapshot.models
    }

    func readSettings() async throws -> PicoSettingsRead {
        snapshot.settingsRead
    }

    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
    {
        for await saved in receipt.stream { return saved }
        throw CancellationError()
    }
}
