import SwiftUI

struct SettingsCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") {
                openWindow(id: SettingsWindowView.sceneID)
            }
            .keyboardShortcut(",", modifiers: .command)
        }
    }
}
