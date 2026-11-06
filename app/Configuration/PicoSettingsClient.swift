import Foundation

protocol PicoSettingsServing: Sendable {
    func readCatalog() async throws -> [PicoModel]
    func readSettings() async throws -> PicoSettingsRead
    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
}

struct PicoSettingsClient: PicoSettingsServing {
    let executableOverride: String?

    func readCatalog() async throws -> [PicoModel] {
        let output = try await makeCommand().run(["models", "list"])
        return try decode(Catalog.self, from: output).items
    }

    func readSettings() async throws -> PicoSettingsRead {
        let output = try await makeCommand().run(["settings", "get"])
        return try decode(PicoSettingsRead.self, from: output)
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
