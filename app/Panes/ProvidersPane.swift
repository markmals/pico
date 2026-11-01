import SwiftUI

struct ProvidersPane: View {
    @Environment(\.sampleSettings) private var sample

    var body: some View {
        Form {
            PaneHeader(destination: .providers)

            Section {
                ProviderPickerRow(settings: sample)
                SettingsValueRow(
                    item: .providerConnectionStatus,
                    value: sample?.shownConnectionStatus
                )
            } header: {
                Text("Providers")
            } footer: {
                sample == nil
                    ? Text("Supported providers come from the engine; none are listed here.")
                    : Text("Pico's sessions can use the models of every connected provider.")
            }

            Section {
                AccountPickerRow(settings: sample)
                CredentialSourcePickerRow(settings: sample)
                SettingsValueRow(item: .credentialStatus, value: sample?.shownCredentialStatus) {
                    SignInButton(settings: sample)
                }
            } header: {
                Text("Account")
            } footer: {
                sample == nil
                    ? Text("No account is read, imported, or signed in from this scaffold.")
                    : Text("Signing out here doesn't sign you out of OMP in Terminal.")
            }
        }
        .formStyle(.grouped)
    }
}
