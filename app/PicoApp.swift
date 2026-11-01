import SwiftUI

@main
struct PicoApp: App {
    @State private var navigator = SettingsNavigator()

    var body: some Scene {
        Window("Pico", id: SettingsWindowView.sceneID) {
            SettingsWindowView(navigator: navigator)
        }
        .defaultSize(width: 715, height: 680)
        .windowResizability(.contentSize)
        .commands {
            SettingsCommands()
        }
    }
}
