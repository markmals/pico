import SwiftUI

@main
struct PicoApp: App {
    @State private var navigator = SettingsNavigator()
    @State private var showsSampleData = Self.launchesWithSampleData
    @State private var sampleSettings = SampleSettings()

    var body: some Scene {
        Window("Pico", id: SettingsWindowView.sceneID) {
            SettingsWindowView(navigator: navigator)
                .environment(\.sampleSettings, showsSampleData ? sampleSettings : nil)
        }
        .defaultSize(width: 715, height: 680)
        .windowResizability(.contentSize)
        .commands {
            SettingsCommands(showsSampleData: $showsSampleData)
        }
    }

    /// Whether Pico was launched with `-ShowsSampleData YES`. Only the launch arguments are read,
    /// never saved defaults, so sample data is off at every other launch.
    private static var launchesWithSampleData: Bool {
        let arguments = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        return (arguments["ShowsSampleData"] as? NSString)?.boolValue ?? false
    }
}
