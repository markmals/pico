import SwiftUI

struct SeshPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .sesh)

            Section {
                SettingsValueRow(item: .helperLocation, value: nil)
                SettingsValueRow(item: .launchArguments, value: nil)
            } header: {
                Text("Launch details")
            } footer: {
                Text("The helper's location is not resolved while settings stay unconnected.")
            }

            Section {
                SettingsValueRow(item: .customAgent, value: nil) {
                    Button("Register") {}
                        .disabled(true)
                }
                SettingsValueRow(item: .seshConnectionStatus, value: nil)
            } header: {
                Text("Connection")
            } footer: {
                Text("Nothing is read from Sesh, and no registration is inspected.")
            }

            Section {
                SettingsValueRow(item: .setupStatus, value: nil)
            } header: {
                Text("Setup")
            } footer: {
                Text("Guided setup through Sesh is not available from this scaffold.")
            }
        }
        .formStyle(.grouped)
    }
}
