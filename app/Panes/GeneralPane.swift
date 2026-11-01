import SwiftUI

struct GeneralPane: View {
    @Environment(\.sampleSettings) private var sample

    var body: some View {
        Form {
            PaneHeader(destination: .general)

            Section {
                SettingsValueRow(
                    item: .runtimeStatus,
                    value: sampleValue(.status("Installed", .ready))
                )
                SettingsValueRow(item: .engineStatus, value: sampleValue(.status("Ready", .ready)))
            } header: {
                Text("Runtime")
            } footer: {
                sample == nil
                    ? Text("Readiness is not inspected while settings stay unconnected.")
                    : Text("The runtime and engine that Sesh launches for Pico sessions.")
            }

            Section {
                SettingsValueRow(
                    item: .generalAppVersion,
                    value: sampleValue(.verbatim(SampleFacts.appVersion))
                )
                SettingsValueRow(
                    item: .generalEngineVersion,
                    value: sampleValue(.verbatim(SampleFacts.engineVersion))
                )
            } header: {
                Text("Versions")
            } footer: {
                sample == nil
                    ? Text("Installed app and engine versions are not read here.")
                    : Text("Pico's sessions use this engine version.")
            }

            Section {
                SettingsValueRow(
                    item: .settingsFile,
                    value: sampleValue(.verbatim(SampleFacts.settingsFile))
                )
            } header: {
                Text("Configuration")
            } footer: {
                sample == nil
                    ? Text("The settings location is not read and cannot be chosen yet.")
                    : Text("Pico keeps its settings here, apart from your OMP configuration.")
            }
        }
        .formStyle(.grouped)
    }

    private func sampleValue(_ value: SettingsValue) -> SettingsValue? {
        sample == nil ? nil : value
    }
}
