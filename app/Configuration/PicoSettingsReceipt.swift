import Foundation

struct PicoSettingsReceipt: Equatable, Sendable {
    let settingsFile: String
    let after: Snapshot
}

extension PicoSettingsReceipt: Decodable {
    private enum CodingKeys: String, CodingKey {
        case after, dryRun, settingsFile
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try !container.decode(Bool.self, forKey: .dryRun) else {
            throw DecodingError.dataCorruptedError(
                forKey: .dryRun,
                in: container,
                debugDescription: "A preview is not a saved settings change"
            )
        }
        settingsFile = try container.decode(String.self, forKey: .settingsFile)
        after = try container.decode(Snapshot.self, forKey: .after)
    }
}

extension PicoSettingsReceipt {
    struct Snapshot: Decodable, Equatable, Sendable {
        let revision: String
        let item: PicoDefaults
    }
}
