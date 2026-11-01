import SwiftUI

struct ToolsPane: View {
    @Environment(\.sampleSettings) private var sample

    var body: some View {
        Form {
            PaneHeader(destination: .tools)

            ToolPolicySection()

            Section {
                SettingsValueRow(
                    item: .intellisenseLocation,
                    value: sample == nil ? nil : .verbatim(SampleFacts.intellisenseLocation)
                )
            } header: {
                Text("Integrations")
            } footer: {
                sample == nil
                    ? Text("Choosing or checking the intellisense program is not available here.")
                    : Text(
                        "Pico's sessions run intellisense through the shell for code intelligence."
                    )
            }
        }
        .formStyle(.grouped)
    }
}
