import SwiftUI

struct DiagnosticsPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .diagnostics)

            Section {
                AppIdentityRow()
                InstalledVersionRows(
                    app: .diagnosticsAppVersion,
                    pico: .diagnosticsPicoVersion,
                    omp: .diagnosticsOMPVersion
                )
            } header: {
                Text("About")
            } footer: {
                Text("`pico` and OMP are read from the command Pico runs, each time it checks it.")
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
