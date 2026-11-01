import SwiftUI

/// The focused window's back/forward actions for the View menu. The availability flags are
/// stored, not read through the navigator, because menu commands only update when the focused
/// value itself changes.
struct SettingsHistoryActions {
    let canGoBack: Bool
    let canGoForward: Bool
    let navigator: SettingsNavigator

    @MainActor
    func goBack() {
        navigator.goBack()
    }

    @MainActor
    func goForward() {
        navigator.goForward()
    }
}

extension FocusedValues {
    @Entry var settingsHistory: SettingsHistoryActions?
}
