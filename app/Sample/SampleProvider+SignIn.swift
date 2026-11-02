import Foundation

// What each sample provider offers for signing in, and the words and links its page shows.
// The policy links are each provider's published pages.
extension SampleProvider {
    /// The ways the provider can be signed in to, in the order its sign-in menu lists them.
    var signInMethods: [SignInMethod] {
        switch self {
        case .anthropic: [.account, .consoleAccount, .apiKey]
        case .openAI, .google, .openRouter: [.account, .apiKey]
        case .xAI, .mistral, .groq: [.apiKey]
        }
    }

    /// What the provider's page says it needs, beside its name.
    var requirement: LocalizedStringResource {
        switch self {
        case .anthropic: "Requires a Claude account or API key"
        case .openAI: "Requires a ChatGPT account or API key"
        case .google: "Requires a Google account or API key"
        case .openRouter: "Requires an OpenRouter account or API key"
        case .xAI, .mistral, .groq: "Requires an API key"
        }
    }

    var privacyPolicy: URL {
        switch self {
        case .anthropic: URL(string: "https://www.anthropic.com/legal/privacy")!
        case .openAI: URL(string: "https://openai.com/policies/privacy-policy/")!
        case .google: URL(string: "https://policies.google.com/privacy")!
        case .openRouter: URL(string: "https://openrouter.ai/privacy")!
        case .xAI: URL(string: "https://x.ai/legal/privacy-policy")!
        case .mistral: URL(string: "https://legal.mistral.ai/terms/privacy-policy")!
        case .groq: URL(string: "https://groq.com/privacy-policy")!
        }
    }

    var termsOfService: URL {
        switch self {
        case .anthropic: URL(string: "https://www.anthropic.com/legal/consumer-terms")!
        case .openAI: URL(string: "https://openai.com/policies/terms-of-use/")!
        case .google: URL(string: "https://ai.google.dev/gemini-api/terms")!
        case .openRouter: URL(string: "https://openrouter.ai/terms")!
        case .xAI: URL(string: "https://x.ai/legal/terms-of-service")!
        case .mistral: URL(string: "https://legal.mistral.ai/terms")!
        case .groq: URL(string: "https://groq.com/terms-of-use")!
        }
    }

    /// The sign-in menu's item for `method`.
    func menuTitle(for method: SignInMethod) -> LocalizedStringResource {
        switch (self, method) {
        case (.anthropic, .account): "Sign In With a Claude Account…"
        case (.anthropic, .consoleAccount): "Sign In With an Anthropic Console Account…"
        case (.anthropic, _): "Provide an Anthropic API Key…"
        case (.openAI, .account): "Sign In With a ChatGPT Account…"
        case (.openAI, _): "Provide an OpenAI API Key…"
        case (.google, .account): "Sign In With a Google Account…"
        case (.google, _): "Provide a Gemini API Key…"
        case (.openRouter, .account): "Sign In With OpenRouter…"
        case (.openRouter, _): "Provide an OpenRouter API Key…"
        case (.xAI, _): "Provide an xAI API Key…"
        case (.mistral, _): "Provide a Mistral API Key…"
        case (.groq, _): "Provide a Groq API Key…"
        }
    }

    /// The sample account a sign-in with `method` shows.
    func accountLabel(for method: SignInMethod) -> LocalizedStringResource {
        switch (self, method) {
        case (_, .apiKey): "API Key"
        case (.anthropic, .consoleAccount): "Anthropic Console · mark@example.com"
        case (.anthropic, _): "Claude Max · mark@example.com"
        case (.openAI, _): "ChatGPT Pro · mark@example.com"
        default: "mark@example.com"
        }
    }
}
