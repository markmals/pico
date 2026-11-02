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

    var initialState: SampleProviderState {
        switch self {
        case .anthropic: SampleProviderState(isAdded: true, signInMethod: .account)
        case .openAI: SampleProviderState(isAdded: true, signInMethod: .apiKey)
        case .google: SampleProviderState(isAdded: true, signInMethod: nil)
        default: SampleProviderState(isAdded: false, signInMethod: nil)
        }
    }
}

/// One provider's sample configuration. A provider is signed in only while it is added.
struct SampleProviderState: Equatable {
    var isAdded: Bool
    /// How the provider is signed in, or `nil` when it is not.
    var signInMethod: SignInMethod?
}

/// A way to sign in to a provider. Which ways a provider offers, and what each is called for
/// that provider, are in `SampleProvider+SignIn.swift`.
enum SignInMethod: CaseIterable, Identifiable {
    /// The provider's consumer account, such as a Claude or ChatGPT subscription.
    case account
    /// A developer console account, offered by providers that have one.
    case consoleAccount
    case apiKey

    var id: Self { self }
}
