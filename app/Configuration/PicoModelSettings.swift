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
}

extension PicoDefaults: Decodable {
    private enum CodingKeys: String, CodingKey {
        case defaultModel, defaultThinking
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        defaultModel = try container.decode(String?.self, forKey: .defaultModel)
        defaultThinking = try container.decode(String?.self, forKey: .defaultThinking)
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

enum PicoSettingsLoad: Equatable, Sendable {
    case ready(PicoModelSettings)
    case invalid(PicoSettingsProblem)
}

enum PicoSettingsChange: Sendable {
    case model(String)
    case thinking(String)

    var arguments: [String] {
        switch self {
        case .model(let model): ["--default-model", model]
        case .thinking(let thinking): ["--default-thinking", thinking]
        }
    }
}
