import SwiftUI

/// Providers & Accounts: the provider list, which is not connected yet.
struct ProvidersPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .providers)

            Section {
                SettingsValueRow(item: .providerList, value: nil) {
                    Button("Add Provider…") {}
                        .disabled(true)
                }
            } footer: {
                Text(
                    "Pico doesn’t show provider accounts here yet. Connect and manage them with `pico`’s commands."
                )
            }
        }
        .formStyle(.grouped)
    }
}
