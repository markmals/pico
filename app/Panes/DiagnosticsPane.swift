import SwiftUI

struct DiagnosticsPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .diagnostics)

            Section {
                AppIdentityRow()
                SettingsValueRow(item: .diagnosticsAppVersion, value: nil)
                SettingsValueRow(item: .diagnosticsPicoVersion, value: nil)
                SettingsValueRow(item: .diagnosticsOMPVersion, value: nil)
            } header: {
                Text("About")
            } footer: {
                Text("Installed versions are not read while settings stay unconnected.")
            }

            Section {
                SettingsValueRow(item: .recentErrors, value: nil)
                SettingsValueRow(item: .diagnosticReport, value: nil)
            } header: {
                Text("Diagnostics")
            } footer: {
                Text("No diagnostics are collected, redacted, or exported here.")
            }
        }
        .formStyle(.grouped)
    }
}
