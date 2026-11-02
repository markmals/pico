import Foundation

/// A provider shown with sample data. Real providers come from the engine once settings connect.
enum SampleProvider: String, CaseIterable, Identifiable {
    case anthropic
    case openAI
    case google
    case openRouter
    case xAI
    case mistral
    case groq

    /// The providers the list always shows, set up or not; the rest are added from a menu.
    static let popular: [SampleProvider] = [.anthropic, .openAI, .google, .openRouter]

    var id: Self { self }

    /// The provider's brand name, which is not localized.
    var name: String {
        switch self {
        case .anthropic: "Anthropic"
        case .openAI: "OpenAI"
        case .google: "Google"
        case .openRouter: "OpenRouter"
        case .xAI: "xAI"
        case .mistral: "Mistral"
        case .groq: "Groq"
        }
    }

    var accounts: [String] {
        switch self {
        case .anthropic: ["mark@example.com", "work@example.com"]
        default: ["mark@example.com"]
        }
    }

    var initialState: SampleProviderState {
        switch self {
        case .anthropic:
            SampleProviderState(
                isAdded: true,
                isSignedIn: true,
                account: accounts.first,
                credentialSource: .existingOMPAccount
            )
        case .openAI:
            SampleProviderState(
                isAdded: true,
                isSignedIn: true,
                account: accounts.first,
                credentialSource: .apiKey
            )
        case .google:
            SampleProviderState(
                isAdded: true,
                isSignedIn: false,
                account: nil,
                credentialSource: .browserSignIn
            )
        default:
            SampleProviderState(
                isAdded: false,
                isSignedIn: false,
                account: nil,
                credentialSource: .apiKey
            )
        }
    }
}

/// One provider's sample configuration. A provider is signed in only while it is added.
struct SampleProviderState: Equatable {
    var isAdded: Bool
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
