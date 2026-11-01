import SwiftUI

struct GeneralPane: View {
    var body: some View {
        Form {
            Section {
                UnconnectedValueRow(label: "Runtime status")
                UnconnectedValueRow(label: "Engine status")
            } header: {
                Text("Runtime")
            } footer: {
                Text("Readiness is not inspected while settings stay unconnected.")
            }

            Section {
                UnconnectedValueRow(label: "Pico app")
                UnconnectedValueRow(label: "Engine")
            } header: {
                Text("Versions")
            } footer: {
                Text("Installed app and engine versions are not read here.")
            }

            Section {
                UnconnectedValueRow(label: "Settings file")
            } header: {
                Text("Configuration")
            } footer: {
                Text("The settings location is not read and cannot be chosen yet.")
            }
        }
        .formStyle(.grouped)
    }
}
