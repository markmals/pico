import Foundation
import Observation

/// The window's navigation state: which pane is shown, the back/forward history, and the
/// location the latest navigation opened.
@MainActor
@Observable
final class SettingsNavigator {
    /// The location the latest navigation opened, if it was opened as a location (search
    /// result or link) rather than chosen in the sidebar or reached with back/forward.
    private(set) var openedLocation: SettingsLocation?
    /// Increments on every `open`, so a pane re-scrolls even when the same item is opened again.
    private(set) var openCount = 0
    /// A link that named no settings location, awaiting the user's acknowledgement.
    var rejectedLink: URL?

    private var history = NavigationHistory(start: .general)

    var canGoBack: Bool { history.canGoBack }

    var canGoForward: Bool { history.canGoForward }

    var current: SettingsDestination { history.current }

    /// Whether the rejected-link alert is showing; dismissing it acknowledges the link.
    var isShowingRejectedLink: Bool {
        get { rejectedLink != nil }
        set {
            if !newValue { rejectedLink = nil }
        }
    }

    var revealedItem: SettingsItem? {
        guard case .item(let item) = openedLocation else { return nil }
        return item
    }

    /// The selected search result: choosing one opens it.
    var searchSelection: SettingsLocation? {
        get { openedLocation }
        set {
            guard let newValue else { return }
            open(newValue)
        }
    }

    /// The selected sidebar destination: choosing one navigates to it.
    var selectedDestination: SettingsDestination {
        get { current }
        set {
            guard newValue != current else { return }
            openedLocation = nil
            history.navigate(to: newValue)
        }
    }

    func goBack() {
        guard history.canGoBack else { return }
        openedLocation = nil
        history.goBack()
    }

    func goForward() {
        guard history.canGoForward else { return }
        openedLocation = nil
        history.goForward()
    }

    /// Opens a `pico://` link, or records it as rejected when it names no settings location.
    func handle(_ url: URL) {
        do {
            guard let location = try SettingsLink.location(from: url) else { return }
            open(location)
        } catch {
            rejectedLink = url
        }
    }

    func open(_ location: SettingsLocation) {
        history.navigate(to: location.destination)
        openedLocation = location
        openCount += 1
    }
}
