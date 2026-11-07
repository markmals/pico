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
                Text("Pico doesn’t read installed versions here yet.")
            }

            Section {
                SettingsValueRow(item: .recentErrors, value: nil)
                SettingsValueRow(item: .diagnosticReport, value: nil)
            } header: {
                Text("Diagnostics")
            } footer: {
                Text("Pico doesn’t collect, redact, or export diagnostics yet.")
            }
        }
        .formStyle(.grouped)
    }
}
