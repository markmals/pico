import SwiftUI

/// One provider's page in sample data, laid out like Sesh's agent page: what the provider
/// requires, how it is signed in with a menu of ways to sign in, its privacy terms, and Remove.
struct ProviderPage: View {
    let provider: SampleProvider
    let settings: SampleSettings

    @Environment(SettingsNavigator.self) private var navigator

    var body: some View {
        Form {
            Section {
                LabeledContent {
                    Text(provider.requirement)
                        .foregroundStyle(.secondary)
                } label: {
                    HStack(spacing: 12) {
                        ProviderTile(provider: provider, size: 32)
                        Text(verbatim: provider.name)
                            .accessibilityAddTraits(.isHeader)
                    }
                }
            }

            Section {
                LabeledContent {
                    HStack(spacing: 8) {
                        accountValue
                            .foregroundStyle(.secondary)
                        SignInMenu(provider: provider, settings: settings)
                    }
                } label: {
                    Text("Account")
                }
                Text(terms)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } footer: {
                Button("Remove Provider", role: .destructive) {
                    settings.remove(provider)
                    navigator.forgetProviderPage(provider.rawValue)
                }
                .buttonStyle(.bordered)
                .tint(.red)
                .padding(.top, 8)
            }
        }
        .formStyle(.grouped)
    }

    private var accountValue: Text {
        guard let method = settings.signInMethod(of: provider) else {
            return Text("Not Signed In")
        }
        // Verbatim, so the account's address is not turned into a mail link.
        return Text(verbatim: String(localized: provider.accountLabel(for: method)))
    }
    /// How to sign in, and the provider's privacy policy and terms, linked to its own pages.
    private var terms: AttributedString {
        let name = provider.name
        let privacy = provider.privacyPolicy.absoluteString
        let terms = provider.legalTerms.absoluteString
        if provider.signInMethods.contains(.apiKey) && provider.signInMethods.count == 1 {
            return AttributedString(
                localized:
                    "Provide an API key to use \(name)'s models in Pico's sessions. Your requests are subject to \(name)'s [privacy policy](\(privacy)) and [terms](\(terms))."
            )
        }
        return AttributedString(
            localized:
                "Sign in or provide an API key to use \(name)'s models in Pico's sessions. Your requests are subject to \(name)'s [privacy policy](\(privacy)) and [terms](\(terms))."
        )
    }
}

/// The ⋯ menu on a provider's Account row: each way the provider offers to sign in, then
/// Sign Out…, which is unavailable while it is signed out.
private struct SignInMenu: View {
    let provider: SampleProvider
    let settings: SampleSettings

    var body: some View {
        Menu {
            ForEach(provider.signInMethods) { method in
                Button {
                    settings.signIn(provider, with: method)
                } label: {
                    Text(provider.menuTitle(for: method))
                }
            }
            Divider()
            Button("Sign Out…") {
                settings.signOut(provider)
            }
            .disabled(!settings.isSignedIn(provider))
        } label: {
            Label {
                Text("Sign-in options for \(provider.name)")
            } icon: {
                Image(systemName: "ellipsis")
            }
            .labelStyle(.iconOnly)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }
}
