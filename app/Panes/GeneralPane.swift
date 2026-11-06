import SwiftUI

struct GeneralPane: View {
    @Environment(ModelSettings.self) private var settings

    var body: some View {
        Form {
            PaneHeader(destination: .general)

            RuntimeSection()

            Section {
                SettingsValueRow(item: .generalAppVersion, value: nil)
                SettingsValueRow(item: .generalPicoVersion, value: nil)
                SettingsValueRow(item: .generalOMPVersion, value: nil)
            } header: {
                Text("Versions")
            } footer: {
                Text("Installed versions are not read here.")
            }

            Section {
                SettingsFileRow(settings: settings)
            } header: {
                Text("Configuration")
            } footer: {
                Text("Pico keeps its settings here, apart from your OMP configuration.")
            }
        }
        .formStyle(.grouped)
    }
}
