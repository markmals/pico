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
                Text("Choosing or checking the intellisense program is not available here.")
            }
        }
        .formStyle(.grouped)
    }
}
