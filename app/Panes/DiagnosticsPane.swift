import SwiftUI

struct DiagnosticsPane: View {
    @Environment(\.sampleSettings) private var sample

    var body: some View {
        Form {
            PaneHeader(destination: .diagnostics)

            Section {
                AppIdentityRow()
                SettingsValueRow(
                    item: .diagnosticsAppVersion,
                    value: sampleValue(.verbatim(SampleFacts.appVersion))
                )
                SettingsValueRow(
                    item: .diagnosticsEngineVersion,
                    value: sampleValue(.verbatim(SampleFacts.engineVersion))
                )
            } header: {
                Text("About")
            } footer: {
                sample == nil
                    ? Text("Installed versions are not read while settings stay unconnected.")
                    : Text("Include these versions when you report a problem.")
            }

            Section {
                SettingsValueRow(item: .recentErrors, value: sampleValue(.text("None")))
                SettingsValueRow(item: .diagnosticReport, value: sampleValue(.text("Not created")))
            } header: {
                Text("Diagnostics")
            } footer: {
                sample == nil
                    ? Text("No diagnostics are collected, redacted, or exported here.")
                    : Text(
                        "Recent errors from Pico's sessions appear here as they happen."
                    )
            }
        }
        .formStyle(.grouped)
    }

    private func sampleValue(_ value: SettingsValue) -> SettingsValue? {
        sample == nil ? nil : value
    }
}
