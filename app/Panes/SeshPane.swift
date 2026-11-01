import SwiftUI

struct SeshPane: View {
    var body: some View {
        Form {
            Section {
                UnconnectedValueRow(label: "Helper location")
                UnconnectedValueRow(label: "Launch arguments")
            } header: {
                Text("Launch details")
            } footer: {
                Text("The helper's location is not resolved while settings stay unconnected.")
            }

            Section {
                UnconnectedValueRow(label: "Sesh custom agent")
                UnconnectedValueRow(label: "Connection status")
            } header: {
                Text("Connection")
            } footer: {
                Text("Nothing is read from Sesh, and no registration is inspected.")
            }

            Section {
                UnconnectedValueRow(label: "Setup status")
            } header: {
                Text("Setup")
            } footer: {
                Text("Guided setup through Sesh is not available from this scaffold.")
            }
        }
        .formStyle(.grouped)
    }
}
