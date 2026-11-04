import Foundation

protocol PicoSettingsServing: Sendable {
    func load() async throws -> PicoSettingsLoad
    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
}

struct PicoSettingsClient: PicoSettingsServing {
    let executableOverride: String?

    func load() async throws -> PicoSettingsLoad {
        let command = try makeCommand()
        async let catalogOutput = command.run(["models", "list"])
        let settingsOutput = try await command.run(["settings", "get"])
        let settings = try decode(PicoSettingsRead.self, from: settingsOutput)
        switch settings {
        case .invalid(let problem):
            return .invalid(problem)
        case .ready(let path, let revision, let item, let effective):
            let catalog = try decode(Catalog.self, from: await catalogOutput)
            return .ready(
                PicoModelSettings(
                    settingsFile: path,
                    revision: revision,
                    item: item,
                    effective: effective,
                    models: catalog.items
                )
            )
        }
    }

    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
    {
        let command = try makeCommand()
        let output = try await command.run(
            ["settings", "update"] + change.arguments + ["--if-revision", revision]
        )
        return try decode(PicoSettingsReceipt.self, from: output)
    }

    private func decode<Response: Decodable>(_ type: Response.Type, from output: Data) throws
        -> Response
    {
        do {
            return try JSONDecoder().decode(type, from: output)
        } catch {
            throw PicoCommandError(
                message: String(
                    localized:
                        "Pico returned an unreadable command response: \(error.localizedDescription)"
                )
            )
        }
    }

    private func makeCommand() throws -> PicoCommand {
        PicoCommand(executable: try PicoExecutable.resolve(override: executableOverride))
    }
}

extension PicoSettingsClient {
    private struct Catalog: Decodable {
        let items: [PicoModel]
    }
}
