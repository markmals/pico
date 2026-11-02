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

    /// How the provider is signed in when sample data starts, or `nil` when it is signed out.
    var initialSignInMethod: SignInMethod? {
        switch self {
        case .anthropic: .account
        case .openAI: .apiKey
        default: nil
        }
    }
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
