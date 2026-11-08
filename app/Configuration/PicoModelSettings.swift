import Foundation

struct PicoModelSettings: Equatable, Sendable {
    let settingsFile: String
    let revision: String
    let item: PicoDefaults
    let effective: PicoEffectiveDefaults
    let models: [PicoModel]

    func applying(_ receipt: PicoSettingsReceipt) -> Self {
        Self(
            settingsFile: receipt.settingsFile,
            revision: receipt.after.revision,
            item: receipt.after.item,
            effective: PicoEffectiveDefaults(
                defaultModel: receipt.after.item.defaultModel,
                defaultThinking: receipt.after.item.defaultThinking,
                available: true
            ),
            models: models
        )
    }
}

struct PicoDefaults: Equatable, Sendable {
    let defaultModel: String?
    let defaultThinking: String?
    /// Where the user chose to run `intellisense` from, exactly as they chose it. Nothing
    /// saved leaves Pico to find the program itself.
    let intellisensePath: String?
}

extension PicoDefaults: Decodable {
    private enum CodingKeys: String, CodingKey {
        case defaultModel, defaultThinking, intellisensePath
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        defaultModel = try container.decode(String?.self, forKey: .defaultModel)
        defaultThinking = try container.decode(String?.self, forKey: .defaultThinking)
        intellisensePath = try container.decodeIfPresent(String.self, forKey: .intellisensePath)
    }
}

struct PicoEffectiveDefaults: Decodable, Equatable, Sendable {
    let defaultModel: String?
    let defaultThinking: String?
    let available: Bool
}

struct PicoModel: Decodable, Equatable, Identifiable, Sendable {
    let value: String
    let name: String
    let provider: String
    let thinking: [ThinkingChoice]
    let defaultThinking: String

    var id: String { value }
}

extension PicoModel {
    struct ThinkingChoice: Decodable, Equatable, Identifiable, Sendable {
        let value: String
        let name: String

        var id: String { value }
    }
}

struct PicoSettingsProblem: Equatable, Sendable {
    let settingsFile: String
    let message: String
}

enum PicoSettingsChange: Equatable, Sendable {
    /// A chosen location, or nothing to go back to the one Pico finds for itself.
    case intellisensePath(String?)
    case model(String)
    case thinking(model: String, level: String)

    var arguments: [String] {
        switch self {
        case .intellisensePath(let path): ["--intellisense-path", path ?? "auto"]
        case .model(let model): ["--default-model", model]
        case .thinking(let model, let level):
            ["--default-model", model, "--default-thinking", level]
        }
    }
}
