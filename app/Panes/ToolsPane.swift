import SwiftUI

struct ToolsPane: View {
    var body: some View {
        Form {
            ToolPolicySection()

            Section {
                UnconnectedValueRow(label: "intellisense location")
            } header: {
                Text("Integrations")
            } footer: {
                Text("Choosing or checking the intellisense program is not available here.")
            }
        }
        .formStyle(.grouped)
    }
}
