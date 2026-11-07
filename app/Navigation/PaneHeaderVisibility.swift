import Observation

/// Which panes have their header on screen. While a pane's header shows its name, the toolbar
/// leaves the name out, as System Settings does; it returns once the header scrolls away.
@MainActor
@Observable
final class PaneHeaderVisibility {
    private var visible = Set(SettingsDestination.allCases)

    func isVisible(_ destination: SettingsDestination) -> Bool {
        visible.contains(destination)
    }

    func setVisible(_ isVisible: Bool, for destination: SettingsDestination) {
        if isVisible {
            visible.insert(destination)
        } else {
            visible.remove(destination)
        }
    }
}
