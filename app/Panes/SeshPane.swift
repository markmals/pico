import SwiftUI

struct SeshPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .sesh)

            Section {
                UnconnectedValueRow(item: .helperLocation)
                UnconnectedValueRow(item: .launchArguments)
            } header: {
                Text("Launch details")
            } footer: {
                Text("The helper's location is not resolved while settings stay unconnected.")
            }

            Section {
                UnconnectedValueRow(item: .customAgent)
                UnconnectedValueRow(item: .seshConnectionStatus)
            } header: {
                Text("Connection")
            } footer: {
                Text("Nothing is read from Sesh, and no registration is inspected.")
            }

            Section {
                UnconnectedValueRow(item: .setupStatus)
            } header: {
                Text("Setup")
            } footer: {
                Text("Guided setup through Sesh is not available from this scaffold.")
            }
        }
        .formStyle(.grouped)
    }
}
