import Testing

@testable import Pico

@MainActor
@Suite("Optimistic configuration saves", .timeLimit(.minutes(1)))
struct OptimisticSettingsTests {
    @Test(
        "model and reasoning edits appear immediately while only confirmed receipts advance the revision"
    )
    func immediateChoicesAndOrderedReceipts() async throws {
        let client = try ControlledSettingsClient()
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let modelSave = settings.chooseModel("provider/second")
        #expect(settings.modelSelection == "provider/second")
        #expect(settings.thinkingSelection == "low")
        #expect(settings.snapshot?.revision == "r0")
        let thinkingSave = settings.chooseThinking("off")
        #expect(settings.thinkingSelection == "off")
        try await withCleanup(settings, client, tasks: [modelSave, thinkingSave]) {
            try await client.waitForWrites(1)
            #expect(await client.writeCount == 1)
            await client.release()
            try await client.waitForWrites(2)
            #expect(settings.snapshot?.item.defaultThinking == "low")
            #expect(settings.thinkingSelection == "off")
            await client.release()
            await modelSave?.value
            #expect(settings.snapshot?.item.defaultModel == "provider/second")
            #expect(settings.snapshot?.item.defaultThinking == "off")
            #expect(settings.snapshot?.revision == "r2")
            #expect(settings.saveError == nil)
        }
    }

    @Test("returning to the original model while a save runs does not discard that newer choice")
    func returningToOriginalChoice() async throws {
        let client = try ControlledSettingsClient()
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let first = settings.chooseModel("provider/second")
        let second = settings.chooseModel("provider/first")
        #expect(settings.modelSelection == "provider/first")
        #expect(settings.thinkingSelection == "low")
        try await withCleanup(settings, client, tasks: [first, second]) {
            try await client.waitForWrites(1)
            await client.release()
            try await client.waitForWrites(2)
            #expect(settings.snapshot?.item.defaultModel == "provider/second")
            #expect(settings.modelSelection == "provider/first")
            await client.release()
            await first?.value
            #expect(settings.snapshot?.item.defaultModel == "provider/first")
            #expect(settings.snapshot?.item.defaultThinking == "low")
        }
    }

    @Test("an older failure rolls back that change without discarding a newer model choice")
    func failedOlderChoice() async throws {
        let client = try ControlledSettingsClient()
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let first = settings.chooseModel("provider/second")
        let second = settings.chooseModel("provider/third")
        #expect(settings.modelSelection == "provider/third")
        try await withCleanup(settings, client, tasks: [first, second]) {
            try await client.waitForWrites(1)
            await client.release(.init(code: "NOT_FOUND", message: "Second became unavailable"))
            try await client.waitForWrites(2)
            #expect(settings.modelSelection == "provider/third")
            #expect(settings.thinkingSelection == "xhigh")
            #expect(settings.snapshot?.item.defaultModel == "provider/first")
            #expect(settings.saveError == "Second became unavailable")
            await client.release()
            await first?.value
            #expect(settings.snapshot?.item.defaultModel == "provider/third")
        }
    }

    @Test("a reasoning edit stays bound to its displayed model if the preceding model save fails")
    func reasoningRetainsModelContext() async throws {
        let client = try ControlledSettingsClient()
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let first = settings.chooseModel("provider/second")
        let second = settings.chooseThinking("off")
        try await withCleanup(settings, client, tasks: [first, second]) {
            try await client.waitForWrites(1)
            await client.release(.init(code: "UNAVAILABLE", message: "First save was refused"))
            try await client.waitForWrites(2)
            #expect(settings.modelSelection == "provider/second")
            #expect(settings.thinkingSelection == "off")
            await client.release()
            await first?.value
            #expect(settings.snapshot?.item.defaultModel == "provider/second")
            #expect(settings.snapshot?.item.defaultThinking == "off")
        }
    }

    @Test("a chosen intellisense location is shown before the save that confirms it")
    func chosenIntellisenseLocation() async throws {
        let client = try ControlledSettingsClient()
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let save = settings.chooseIntellisensePath("/Users/mark/.cargo/bin/intellisense")
        #expect(
            settings.displayedDefaults?.intellisensePath
                == "/Users/mark/.cargo/bin/intellisense"
        )
        #expect(settings.snapshot?.item.intellisensePath == nil)
        try await withCleanup(settings, client, tasks: [save]) {
            try await client.waitForWrites(1)
            await client.release()
            await save?.value
            #expect(
                settings.snapshot?.item.intellisensePath
                    == "/Users/mark/.cargo/bin/intellisense"
            )
            #expect(settings.modelSelection == "provider/first")
            #expect(settings.saveError == nil)
        }
    }

    @Test("a refused intellisense location rolls back to the confirmed one with its cause")
    func refusedIntellisenseLocation() async throws {
        let client = try ControlledSettingsClient()
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let save = settings.chooseIntellisensePath("/nowhere/intellisense")
        #expect(settings.displayedDefaults?.intellisensePath == "/nowhere/intellisense")
        try await withCleanup(settings, client, tasks: [save]) {
            try await client.waitForWrites(1)
            await client.release(
                .init(code: "NOT_FOUND", message: "Nothing exists at /nowhere/intellisense")
            )
            await save?.value
            #expect(settings.displayedDefaults?.intellisensePath == nil)
            #expect(settings.saveError == "Nothing exists at /nowhere/intellisense")
            #expect(!settings.isSaving)
        }
    }

    @Test("an external conflict reloads authoritative settings without replaying queued changes")
    func conflictDiscardsQueue() async throws {
        let client = try ControlledSettingsClient()
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let first = settings.chooseModel("provider/second")
        let second = settings.chooseThinking("off")
        try await withCleanup(settings, client, tasks: [first, second]) {
            try await client.waitForWrites(1)
            await client.changeExternally()
            await client.release()
            try await client.waitForLoads(2)
            await client.finish()
            await first?.value
            #expect(await client.writeCount == 1)
            #expect(settings.modelSelection == "provider/third")
            #expect(settings.thinkingSelection == "xhigh")
            #expect(settings.snapshot?.revision == "external")
            #expect(settings.saveError != nil)
            #expect(!settings.isSaving)
        }
    }

    @Test("cancellation abandons unsent edits and a reload reads persisted configuration")
    func cancellationDiscardsQueue() async throws {
        let client = try ControlledSettingsClient()
        let settings = ModelSettings(client: client)
        await settings.reload().value
        let first = settings.chooseModel("provider/second")
        let second = settings.chooseModel("provider/third")
        try await withCleanup(settings, client, tasks: [first, second]) {
            try await client.waitForWrites(1)
            settings.cancel()
            await client.finish()
            await first?.value
            await settings.reload().value
            #expect(await client.writeCount == 1)
            #expect(settings.modelSelection == "provider/first")
            #expect(settings.thinkingSelection == "high")
            #expect(settings.snapshot?.revision == "r0")
            #expect(settings.saveError == nil)
        }
    }

    private func withCleanup(
        _ settings: ModelSettings,
        _ client: ControlledSettingsClient,
        tasks: [Task<Void, Never>?],
        operation: () async throws -> Void
    ) async throws {
        do {
            try await operation()
        } catch {
            settings.cancel()
            await client.finish()
            for task in tasks { await task?.value }
            throw error
        }
        settings.cancel()
        await client.finish()
        for task in tasks { await task?.value }
    }
}
