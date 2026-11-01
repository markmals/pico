import Foundation

/// One labelled row in one settings pane. Its identity is its destination plus its slug, which
/// together form its `pico://settings` link; the title and keywords can change without changing
/// which item it is.
struct SettingsItem: Sendable {
    let destination: SettingsDestination
    /// Other terms people search for this setting by. Never provider, model, or capability
    /// names Pico does not support.
    let keywords: [LocalizedStringResource]
    let slug: String
    let title: LocalizedStringResource

    init(
        _ destination: SettingsDestination,
        _ slug: String,
        title: LocalizedStringResource,
        keywords: [LocalizedStringResource] = []
    ) {
        self.destination = destination
        self.keywords = keywords
        self.slug = slug
        self.title = title
    }
}

extension SettingsItem: Hashable {
    static func == (lhs: SettingsItem, rhs: SettingsItem) -> Bool {
        lhs.destination == rhs.destination && lhs.slug == rhs.slug
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(destination)
        hasher.combine(slug)
    }
}

extension SettingsItem: Identifiable {
    var id: Self { self }
}
