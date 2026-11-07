import SwiftUI

struct GeneralPane: View {
    @Environment(ModelSettings.self) private var settings

    var body: some View {
        Form {
            PaneHeader(destination: .general)

            RuntimeSection()

            Section {
                SettingsFileRow(settings: settings)
            } header: {
                Text("Configuration")
            } footer: {
                Text("Pico’s settings are separate from your OMP configuration.")
            }

            Section {
                SettingsValueRow(item: .generalAppVersion, value: nil)
                SettingsValueRow(item: .generalPicoVersion, value: nil)
                SettingsValueRow(item: .generalOMPVersion, value: nil)
            } header: {
                Text("Versions")
            } footer: {
                Text("Pico doesn’t read installed versions here yet.")
            }
        }
        .formStyle(.grouped)
    }
}
