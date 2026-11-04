import SwiftUI

struct GeneralPane: View {
    @Environment(ModelSettings.self) private var settings

    var body: some View {
        Form {
            PaneHeader(destination: .general)

            Section {
                SettingsValueRow(item: .installed, value: nil)
                SettingsValueRow(item: .starts, value: nil)
                SettingsValueRow(item: .upToDate, value: nil)
            } header: {
                Text("Runtime")
            } footer: {
                Text("Readiness is not inspected while settings stay unconnected.")
            }

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
                SettingsFileRow(path: settings.settingsFile, isLoading: settings.state == .loading)
            } header: {
                Text("Configuration")
            } footer: {
                Text("Pico keeps its settings here, apart from your OMP configuration.")
            }
        }
        .formStyle(.grouped)
    }
}
