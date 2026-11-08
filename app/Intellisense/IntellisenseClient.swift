import Foundation

protocol IntellisenseChecking: Sendable {
    func check() async throws -> IntellisenseCheck
}

struct IntellisenseClient: IntellisenseChecking {
    let executableOverride: String?

    func check() async throws -> IntellisenseCheck {
        let command = PicoCommand(
            executable: try PicoExecutable.resolve(override: executableOverride)
        )
        let output = try await command.run(["intellisense", "check"])
        do {
            return try JSONDecoder().decode(IntellisenseCheck.self, from: output)
        } catch {
            throw PicoCommandError(
                message: String(
                    localized:
                        "Pico returned an unreadable command response: \(error.localizedDescription)"
                )
            )
        }
    }
}
