import SwiftUI

@main
struct PicoApp: App {
    @NSApplicationDelegateAdaptor(RuntimeTerminationDelegate.self) private var lifecycle
    @State private var navigator = SettingsNavigator()
    @State private var settings = ModelSettings(
        client: PicoSettingsClient(executableOverride: Self.executableOverride)
    )
    @State private var runtime = RuntimeReadiness(
        client: PicoRuntimeClient(executableOverride: Self.executableOverride)
    )

    var body: some Scene {
        Window("Pico", id: SettingsWindowView.sceneID) {
            SettingsWindowView(navigator: navigator)
                .environment(settings)
                .environment(runtime)
                .onAppear { lifecycle.runtime = runtime }
        }
        .defaultSize(width: 715, height: 680)
        .windowResizability(.contentSize)
        .commands {
            SettingsCommands()
        }
    }

    private static var executableOverride: String? {
        let arguments = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        return arguments["PicoExecutable"] as? String
    }
}
