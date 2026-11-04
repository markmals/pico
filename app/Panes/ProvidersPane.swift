import SwiftUI

/// Providers & Accounts: the provider list, which is not connected yet.
struct ProvidersPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .providers)

            Section {
                SettingsValueRow(item: .providerList, value: nil)
            } header: {
                Text(SettingsItem.providerList.displayTitle)
            } footer: {
                HStack(alignment: .firstTextBaseline) {
                    Text("Supported providers come from the engine; none are listed here.")
                    Spacer()
                    Button("Add Provider…") {}
                        .disabled(true)
                }
            }
        }
        .formStyle(.grouped)
    }
}
