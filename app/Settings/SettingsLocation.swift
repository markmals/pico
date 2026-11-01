import Foundation

/// A place in Settings that search results, links, and navigation can open: a pane, or one
/// setting within it.
enum SettingsLocation: Hashable, Sendable {
    case destination(SettingsDestination)
    case item(SettingsItem)

    /// Every location, as the sidebar orders them: each pane, then its items.
    static let allInSidebarOrder: [SettingsLocation] = SettingsDestination.sidebarGroups
        .flatMap(\.self)
        .flatMap { destination in
            [.destination(destination)] + destination.items.map(SettingsLocation.item)
        }

    var destination: SettingsDestination {
        switch self {
        case .destination(let destination): destination
        case .item(let item): item.destination
        }
    }
}

extension SettingsLocation: Identifiable {
    var id: Self { self }
}
