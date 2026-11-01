import SwiftUI

struct ProvidersPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .providers)

            Section {
                UnconnectedPicker(item: .provider)
                UnconnectedValueRow(item: .providerConnectionStatus)
            } header: {
                Text("Providers")
            } footer: {
                Text("Supported providers come from the engine; none are listed here.")
            }

            Section {
                UnconnectedPicker(item: .account)
                UnconnectedPicker(item: .credentialSource)
                UnconnectedValueRow(item: .credentialStatus)
            } header: {
                Text("Account")
            } footer: {
                Text("No account is read, imported, or signed in from this scaffold.")
            }
        }
        .formStyle(.grouped)
    }
}
