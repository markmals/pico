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
                InstalledVersionRows(
                    app: .generalAppVersion,
                    pico: .generalPicoVersion,
                    omp: .generalOMPVersion
                )
            } header: {
                Text("Versions")
            } footer: {
                Text("`pico` and OMP are read from the command Pico runs, each time it checks it.")
            }
        }
        .formStyle(.grouped)
    }
}
