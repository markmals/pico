import SwiftUI

struct DiagnosticsPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .diagnostics)

            Section {
                AppIdentityRow()
                UnconnectedValueRow(item: .diagnosticsAppVersion)
                UnconnectedValueRow(item: .diagnosticsEngineVersion)
            } header: {
                Text("About")
            } footer: {
                Text("Installed versions are not read while settings stay unconnected.")
            }

            Section {
                UnconnectedValueRow(item: .recentErrors)
                UnconnectedValueRow(item: .diagnosticReport)
            } header: {
                Text("Diagnostics")
            } footer: {
                Text("No diagnostics are collected, redacted, or exported here.")
            }
        }
        .formStyle(.grouped)
    }
}
