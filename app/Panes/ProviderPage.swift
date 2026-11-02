import SwiftUI

/// One provider's page in sample data: its account, credential source and status, and Remove.
struct ProviderPage: View {
    let provider: SampleProvider
    let settings: SampleSettings

    @Environment(SettingsNavigator.self) private var navigator

    var body: some View {
        Form {
            Section {
                HStack(alignment: .top, spacing: 12) {
                    ProviderTile(provider: provider, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: provider.name)
                            .font(.headline)
                        settings.statusLine(of: provider)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
            }

            Section {
                accountPicker
                credentialSourcePicker
                LabeledContent {
                    HStack(spacing: 12) {
                        SettingsValueText(value: credentialStatus)
                        signInButton
                    }
                } label: {
                    Text("Credential status")
                }
            } header: {
                Text("Account")
            } footer: {
                Text("Signing out here doesn't sign you out of OMP in Terminal.")
            }

            Section {
                Button("Remove Provider", role: .destructive) {
                    settings.remove(provider)
                    navigator.forgetProviderPage(provider.rawValue)
                }
            }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder private var accountPicker: some View {
        if settings.isSignedIn(provider) {
            Picker("Account", selection: account) {
                ForEach(provider.accounts, id: \.self) { account in
                    Text(verbatim: account).tag(Optional(account))
                }
            }
        } else {
            Picker("Account", selection: .constant(0)) {
                Text("Not signed in").tag(0)
            }
            .disabled(true)
        }
    }

    private var credentialSourcePicker: some View {
        Picker("Credential source", selection: credentialSource) {
            ForEach(CredentialSource.allCases) { source in
                Text(source.title).tag(source)
            }
        }
    }

    @ViewBuilder private var signInButton: some View {
        if settings.isSignedIn(provider) {
            Button("Sign Out") { settings.signOut(provider) }
        } else {
            Button("Sign In") { settings.signIn(provider) }
        }
    }

    private var credentialStatus: SettingsValue {
        guard settings.isSignedIn(provider) else { return .status("Not signed in", .attention) }
        return settings.credentialSource(of: provider) == .apiKey
            ? .status("Key in Keychain", .ready) : .status("Signed in", .ready)
    }

    private var account: Binding<String?> {
        Binding {
            settings.account(of: provider)
        } set: { account in
            settings.setAccount(account, of: provider)
        }
    }

    private var credentialSource: Binding<CredentialSource> {
        Binding {
            settings.credentialSource(of: provider)
        } set: { source in
            settings.setCredentialSource(source, of: provider)
        }
    }
}
