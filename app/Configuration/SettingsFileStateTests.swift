import Foundation
import Testing

@testable import Pico

@MainActor
@Suite("Pico settings file location", .timeLimit(.minutes(1)))
struct SettingsFileStateTests {
    private let models: [PicoModel] = [
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
    private let path = "/tmp/pico-tests/settings.json"

    @Test("a failed catalog leaves the settings file where the settings read found it")
    func catalogFailureKeepsSettingsFile() async {
        let client = FixedReadsClient(
            catalog: .failure(
                PicoCommandError(
                    code: "KEYCHAIN_ACCESS_DENIED",
                    message: "The selected credential could not be read"
                )
            ),
            settings: .success(snapshot(path: path, revision: "first").settingsRead)
        )
        let settings = ModelSettings(client: client)
        await settings.reload().value
        #expect(settings.settingsFile == .known(path))
        #expect(settings.state == .failed("The selected credential could not be read"))
        #expect(settings.snapshot == nil)
        #expect(settings.chooseModel("provider/second") == nil)
    }

    @Test("a failed settings read reports its cause as the settings file's state")
    func settingsFailureCarriesItsCause() async {
        let cause = "Pico couldn't read /tmp/pico-tests/settings.json"
        let client = FixedReadsClient(
            catalog: .success(models),
            settings: .failure(PicoCommandError(code: "EACCES", message: cause))
        )
        let settings = ModelSettings(client: client)
        await settings.reload().value
        #expect(settings.settingsFile == .failed(cause))
        #expect(settings.state == .failed(cause))
    }

    @Test("an invalid settings file still names its path when the catalog fails too")
    func invalidSettingsKeepsItsPath() async {
        let problem = PicoSettingsProblem(settingsFile: path, message: "Cannot read this version")
        let client = FixedReadsClient(
            catalog: .failure(PicoCommandError(message: "The catalog is unavailable")),
            settings: .success(.invalid(problem))
        )
        let settings = ModelSettings(client: client)
        await settings.reload().value
        #expect(settings.settingsFile == .known(path))
        #expect(settings.state == .invalid(problem))
    }

    @Test("the settings file appears before a slow catalog answers")
    func slowCatalogDoesNotHoldBackTheSettingsFile() async throws {
        let client = SuspendedReadsClient()
        let settings = ModelSettings(client: client)
        let ready = snapshot(path: path, revision: "first")
        let load = settings.reload()
        do {
            try await client.waitForCatalogReads(1)
            try await client.waitForSettingsReads(1)
            await client.finishSettings(0, with: .success(ready.settingsRead))
            try await waitUntil { settings.settingsFile == .known(path) }
            #expect(settings.state == .loading)
            await client.finishCatalog(0, with: .success(models))
            await load.value
            #expect(settings.state == .ready(ready))
        } catch {
            await client.cancelAll()
            await load.value
            throw error
        }
    }

    @Test(
        "a superseded load cannot replace the settings file the newest one found",
        arguments: [true, false]
    )
    func supersededLoadCannotClobber(olderFails: Bool) async throws {
        let client = SuspendedReadsClient()
        let settings = ModelSettings(client: client)
        let current = snapshot(path: "/tmp/pico-tests/current.json", revision: "current")
        let outdated = snapshot(path: "/tmp/pico-tests/outdated.json", revision: "outdated")
        let older = settings.reload()
        var newer: Task<Void, Never>?
        do {
            try await client.waitForCatalogReads(1)
            try await client.waitForSettingsReads(1)
            newer = settings.reload()
            try await client.waitForCatalogReads(2)
            try await client.waitForSettingsReads(2)
            await client.finishSettings(1, with: .success(current.settingsRead))
            await client.finishCatalog(1, with: .success(models))
            await newer?.value
            #expect(settings.settingsFile == .known(current.settingsFile))
            await client.finishSettings(
                0,
                with: olderFails
                    ? .failure(PicoCommandError(message: "The superseded read failed"))
                    : .success(outdated.settingsRead)
            )
            await client.finishCatalog(0, with: .success([]))
            await older.value
            #expect(settings.settingsFile == .known(current.settingsFile))
            #expect(settings.state == .ready(current))
        } catch {
            await client.cancelAll()
            await older.value
            await newer?.value
            throw error
        }
    }

    private func snapshot(path: String, revision: String) -> PicoModelSettings {
        PicoModelSettings(
            settingsFile: path,
            revision: revision,
            item: .init(defaultModel: "provider/first", defaultThinking: "high"),
            effective: .init(
                defaultModel: "provider/first",
                defaultThinking: "high",
                available: true
            ),
            models: models
        )
    }

    private func waitUntil(_ reached: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while !reached() {
            guard ContinuousClock.now < deadline else {
                throw PicoCommandError(message: "The expected state did not appear")
            }
            try await Task.sleep(for: .milliseconds(5))
        }
    }
}
