import SwiftUI

struct ToolsPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .tools)

            ToolPolicySection()

            Section {
                UnconnectedValueRow(item: .intellisenseLocation)
            } header: {
                Text("Integrations")
            } footer: {
                Text("Choosing or checking the intellisense program is not available here.")
            }
        }
        .formStyle(.grouped)
    }
}
