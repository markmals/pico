import SwiftUI

struct ProvidersPane: View {
    var body: some View {
        Form {
            Section {
                UnconnectedPicker(label: "Provider")
                UnconnectedValueRow(label: "Connection status")
            } header: {
                Text("Providers")
            } footer: {
                Text("Supported providers come from the engine; none are listed here.")
            }

            Section {
                UnconnectedPicker(label: "Account")
                UnconnectedPicker(label: "Credential source")
                UnconnectedValueRow(label: "Credential status")
            } header: {
                Text("Account")
            } footer: {
                Text("No account is read, imported, or signed in from this scaffold.")
            }
        }
        .formStyle(.grouped)
    }
}
