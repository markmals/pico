import Foundation

enum PicoSettingsRead: Equatable, Sendable {
    case ready(
        settingsFile: String,
        revision: String,
        item: PicoDefaults,
        effective: PicoEffectiveDefaults
    )
    case invalid(PicoSettingsProblem)
}

extension PicoSettingsRead: Decodable {
    private enum CodingKeys: String, CodingKey {
        case effective, item, problem, revision, settingsFile, status
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let path = try container.decode(String.self, forKey: .settingsFile)
        let status = try container.decode(String.self, forKey: .status)
        switch status {
        case "missing", "valid":
            self = .ready(
                settingsFile: path,
                revision: try container.decode(String.self, forKey: .revision),
                item: try container.decode(PicoDefaults.self, forKey: .item),
                effective: try container.decode(PicoEffectiveDefaults.self, forKey: .effective)
            )
        case "invalid", "unsupported":
            self = .invalid(
                PicoSettingsProblem(
                    settingsFile: path,
                    message: try container.decode(String.self, forKey: .problem)
                )
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .status,
                in: container,
                debugDescription: "Unknown settings status: \(status)"
            )
        }
    }
}
