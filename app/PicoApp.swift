import SwiftUI

@main
struct PicoApp: App {
    var body: some Scene {
        Window("Pico", id: SettingsWindowView.sceneID) {
            SettingsWindowView()
        }
        .defaultSize(width: 920, height: 680)
        .windowResizability(.contentMinSize)
        .commands {
            SettingsCommands()
        }
    }
}
