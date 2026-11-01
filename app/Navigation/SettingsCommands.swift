import SwiftUI

struct SettingsCommands: Commands {
    @Binding var showsSampleData: Bool
    @FocusedValue(\.settingsHistory) private var history
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") {
                openWindow(id: SettingsWindowView.sceneID)
            }
            .keyboardShortcut(",", modifiers: .command)
        }
        // Replacing the sidebar group also removes Show/Hide Sidebar: the sidebar is fixed.
        CommandGroup(replacing: .sidebar) {
            Button("Back") {
                history?.goBack()
            }
            .keyboardShortcut("[", modifiers: .command)
            .disabled(history?.canGoBack != true)

            Button("Forward") {
                history?.goForward()
            }
            .keyboardShortcut("]", modifiers: .command)
            .disabled(history?.canGoForward != true)

            Divider()

            Toggle("Show Sample Data", isOn: $showsSampleData)
        }
    }
}
