import Foundation

/// What `pico intellisense check` found: the location a new session would run `intellisense`
/// from, and whether the program there answers.
enum IntellisenseCheck: Equatable, Sendable {
    /// The program at `path` ran and reported `version`.
    case ready(path: String, version: String)
    /// No location is saved and none was found, with what the search covered.
    case missing(problem: String)
    /// A location was resolved but cannot be used, and why.
    case unusable(path: String, problem: String)
}

extension IntellisenseCheck: Decodable {
    private enum CodingKeys: String, CodingKey {
        case path, problem, status, version
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let status = try container.decode(String.self, forKey: .status)
        switch status {
        case "ready":
            self = .ready(
                path: try container.decode(String.self, forKey: .path),
                version: try container.decode(String.self, forKey: .version)
            )
        case "missing":
            self = .missing(problem: try container.decode(String.self, forKey: .problem))
        case "unusable":
            self = .unusable(
                path: try container.decode(String.self, forKey: .path),
                problem: try container.decode(String.self, forKey: .problem)
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .status,
                in: container,
                debugDescription: "Unknown intellisense status: \(status)"
            )
        }
    }
}
