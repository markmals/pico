import SwiftUI

struct GeneralPane: View {
    @Environment(\.sampleSettings) private var sample

    var body: some View {
        Form {
            PaneHeader(destination: .general)

            Section {
                SettingsValueRow(
                    item: .installed,
                    value: sampleValue(.status("\(SampleFacts.helperLocation)", .ready))
                )
                SettingsValueRow(
                    item: .starts,
                    value: sampleValue(.status("Checked just now", .ready))
                )
                SettingsValueRow(
                    item: .upToDate,
                    value: sampleValue(.status("\(SampleFacts.picoVersion) is the latest", .ready))
                )
            } header: {
                Text("Runtime")
            } footer: {
                sample == nil
                    ? Text("Readiness is not inspected while settings stay unconnected.")
                    : Text("Sesh launches `pico` for every Pico session.")
            }

            Section {
                SettingsValueRow(
                    item: .generalAppVersion,
                    value: sampleValue(.verbatim(SampleFacts.appVersion))
                )
                SettingsValueRow(
                    item: .generalPicoVersion,
                    value: sampleValue(.verbatim(SampleFacts.picoVersion))
                )
                SettingsValueRow(
                    item: .generalOMPVersion,
                    value: sampleValue(.verbatim(SampleFacts.ompVersion))
                )
            } header: {
                Text("Versions")
            } footer: {
                sample == nil
                    ? Text("Installed versions are not read here.")
                    : Text(
                        "`pico` is built on this version of OMP; each has its own version number."
                    )
            }

            Section {
                SettingsFileRow(path: sample == nil ? nil : SampleFacts.settingsFile)
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
