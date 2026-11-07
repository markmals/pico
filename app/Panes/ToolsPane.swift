import SwiftUI

struct ToolsPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .tools)

            ToolPolicySection()

            Section {
                SettingsValueRow(item: .intellisenseLocation, value: nil)
            } header: {
                Text("Integrations")
            } footer: {
                Text("Pico doesn’t choose or check the `intellisense` program here yet.")
            }
        }
        .formStyle(.grouped)
    }
}
