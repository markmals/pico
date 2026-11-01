import SwiftUI

struct ProviderPickerRow: View {
    let settings: SampleSettings?

    var body: some View {
        if let settings {
            @Bindable var settings = settings
            Picker(selection: $settings.shownProvider) {
                ForEach(SampleProvider.allCases) { provider in
                    Text(verbatim: provider.name).tag(provider)
                }
            } label: {
                Text(SettingsItem.provider.title)
            }
            .accessibilityLabel(Text(SettingsItem.provider.title))
            .settingsRow(.provider)
        } else {
            UnavailablePicker(item: .provider)
        }
    }
}

struct AccountPickerRow: View {
    let settings: SampleSettings?

    var body: some View {
        if let settings, settings.isSignedIn(settings.shownProvider) {
            @Bindable var settings = settings
            Picker(selection: $settings.shownAccount) {
                ForEach(settings.shownProvider.accounts, id: \.self) { account in
                    Text(verbatim: account).tag(Optional(account))
                }
            } label: {
                Text(SettingsItem.account.title)
            }
            .accessibilityLabel(Text(SettingsItem.account.title))
            .settingsRow(.account)
        } else if settings != nil {
            UnavailablePicker(item: .account, reason: "Not signed in")
        } else {
            UnavailablePicker(item: .account)
        }
    }
}

struct CredentialSourcePickerRow: View {
    let settings: SampleSettings?

    var body: some View {
        if let settings {
            @Bindable var settings = settings
            Picker(selection: $settings.shownCredentialSource) {
                ForEach(CredentialSource.allCases) { source in
                    Text(source.title).tag(source)
                }
            } label: {
                Text(SettingsItem.credentialSource.title)
            }
            .accessibilityLabel(Text(SettingsItem.credentialSource.title))
            .settingsRow(.credentialSource)
        } else {
            UnavailablePicker(item: .credentialSource)
        }
    }
}

/// Signs the shown provider in or out in sample data; unavailable without it.
struct SignInButton: View {
    let settings: SampleSettings?

    var body: some View {
        if let settings, settings.isSignedIn(settings.shownProvider) {
            Button("Sign Out") { settings.signOut(settings.shownProvider) }
        } else {
            Button("Sign In") {
                guard let settings else { return }
                settings.signIn(settings.shownProvider)
            }
            .disabled(settings == nil)
        }
    }
}

extension SampleSettings {
    var shownConnectionStatus: SettingsValue {
        isSignedIn(shownProvider)
            ? .status("Connected", .ready) : .status("Needs sign-in", .attention)
    }

    var shownCredentialStatus: SettingsValue {
        guard isSignedIn(shownProvider) else { return .status("Not signed in", .attention) }
        return shownCredentialSource == .apiKey
            ? .status("Key in Keychain", .ready) : .status("Signed in", .ready)
    }
}
