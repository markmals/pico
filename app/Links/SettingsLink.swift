import Foundation

/// A `pico://` link that does not name a Pico settings location.
struct SettingsLinkError: Error, Equatable {}

/// `pico://settings[/<destination>[/<item>]]` links (proposal 0005).
enum SettingsLink {
    private static let host = "settings"
    private static let scheme = "pico"

    /// The location a link opens, or `nil` for the settings root, which only brings Pico forward.
    static func location(from url: URL) throws(SettingsLinkError) -> SettingsLocation? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == scheme,
            components.host?.lowercased() == host,
            components.user == nil, components.password == nil, components.port == nil,
            components.query == nil, components.fragment == nil
        else { throw SettingsLinkError() }

        var path = components.percentEncodedPath
        if path.hasSuffix("/") { path.removeLast() }
        if path.isEmpty { return nil }
        guard path.hasPrefix("/") else { throw SettingsLinkError() }

        let segments = path.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
        guard let destination = SettingsDestination(rawValue: String(segments[0])) else {
            throw SettingsLinkError()
        }
        switch segments.count {
        case 1:
            return .destination(destination)
        case 2:
            guard let item = destination.items.first(where: { $0.slug == segments[1] }) else {
                throw SettingsLinkError()
            }
            return .item(item)
        default:
            throw SettingsLinkError()
        }
    }

    static func url(for location: SettingsLocation) -> URL {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        switch location {
        case .destination(let destination):
            components.path = "/\(destination.rawValue)"
        case .item(let item):
            components.path = "/\(item.destination.rawValue)/\(item.slug)"
        }
        guard let url = components.url else {
            preconditionFailure(
                "Settings slugs are lowercase kebab-case and always form a URL path"
            )
        }
        return url
    }
}
