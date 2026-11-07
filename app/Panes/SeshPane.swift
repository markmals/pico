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
                Text("Pico doesn’t look up its launch details here yet.")
            }

            // These rows name a connection or a status, so “Not connected” would read as a
            // verdict; Pico has checked nothing.
            Section {
                SettingsValueRow(item: .customAgent, value: .text("Not checked")) {
                    Button("Register") {}
                        .disabled(true)
                }
                SettingsValueRow(item: .seshConnectionStatus, value: .text("Not checked"))
            } header: {
                Text("Connection")
            } footer: {
                Text("Pico can’t check Sesh or its custom agents yet. Nothing is read from Sesh.")
            }

            Section {
                SettingsValueRow(item: .setupStatus, value: .text("Not checked"))
            } header: {
                Text("Setup")
            } footer: {
                Text("Guided setup through Sesh isn’t available yet.")
            }
        }
        .formStyle(.grouped)
    }
}
