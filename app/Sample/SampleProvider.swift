import Foundation

/// A provider shown with sample data. Real providers come from the engine once settings connect.
enum SampleProvider: String, CaseIterable, Identifiable {
    case anthropic
    case openAI
    case google

    var id: Self { self }

    /// The provider's brand name, which is not localized.
    var name: String {
        switch self {
        case .anthropic: "Anthropic"
        case .openAI: "OpenAI"
        case .google: "Google"
        }
    }

    var accounts: [String] {
        switch self {
        case .anthropic: ["mark@example.com", "work@example.com"]
        case .openAI, .google: ["mark@example.com"]
        }
    }

    var initialState: SampleProviderState {
        switch self {
        case .anthropic:
            SampleProviderState(
                isSignedIn: true,
                account: accounts.first,
                credentialSource: .existingOMPAccount
            )
        case .openAI:
            SampleProviderState(
                isSignedIn: true,
                account: accounts.first,
                credentialSource: .apiKey
            )
        case .google:
            SampleProviderState(isSignedIn: false, account: nil, credentialSource: .browserSignIn)
        }
    }
}

struct SampleProviderState: Equatable {
    var isSignedIn: Bool
    var account: String?
    var credentialSource: CredentialSource
}

enum CredentialSource: CaseIterable, Identifiable {
    case existingOMPAccount
    case apiKey
    case browserSignIn

    var id: Self { self }

    var title: LocalizedStringResource {
        switch self {
        case .existingOMPAccount: "Existing OMP account"
        case .apiKey: "API key"
        case .browserSignIn: "Browser sign-in"
        }
    }
}
