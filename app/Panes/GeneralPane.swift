import SwiftUI

struct GeneralPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .general)

            Section {
                UnconnectedValueRow(item: .runtimeStatus)
                UnconnectedValueRow(item: .engineStatus)
            } header: {
                Text("Runtime")
            } footer: {
                Text("Readiness is not inspected while settings stay unconnected.")
            }

            Section {
                UnconnectedValueRow(item: .generalAppVersion)
                UnconnectedValueRow(item: .generalEngineVersion)
            } header: {
                Text("Versions")
            } footer: {
                Text("Installed app and engine versions are not read here.")
            }

            Section {
                UnconnectedValueRow(item: .settingsFile)
            } header: {
                Text("Configuration")
            } footer: {
                Text("The settings location is not read and cannot be chosen yet.")
            }
        }
        .formStyle(.grouped)
    }
}
