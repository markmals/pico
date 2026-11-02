/// What the detail area shows: a pane's main page, or one provider's page inside Providers &
/// Accounts. History steps through pages.
enum SettingsPage: Hashable, Sendable {
    case main(SettingsDestination)
    /// A provider's page, identified by the provider's slug.
    case provider(String)

    var destination: SettingsDestination {
        switch self {
        case .main(let destination): destination
        case .provider: .providers
        }
    }
}
