import SwiftUI

struct DiagnosticsPane: View {
    var body: some View {
        Form {
            Section {
                AppIdentityRow()
                UnconnectedValueRow(label: "App version")
                UnconnectedValueRow(label: "Engine version")
            } header: {
                Text("About")
            } footer: {
                Text("Installed versions are not read while settings stay unconnected.")
            }

            Section {
                UnconnectedValueRow(label: "Recent errors")
                UnconnectedValueRow(label: "Diagnostic report")
            } header: {
                Text("Diagnostics")
            } footer: {
                Text("No diagnostics are collected, redacted, or exported here.")
            }
        }
        .formStyle(.grouped)
    }
}
