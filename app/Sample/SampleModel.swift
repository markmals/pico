import Foundation

/// A model in the sample catalog, named like the providers' public models so that lengths and
/// truncation look real.
struct SampleModel: Identifiable, Hashable {
    let id: String
    let name: String
    let provider: SampleProvider
    let reasoningLevels: [ReasoningLevel]
    let defaultReasoningLevel: ReasoningLevel
}

enum ReasoningLevel: CaseIterable, Identifiable {
    case off
    case auto
    case low
    case medium
    case high

    var id: Self { self }

    var title: LocalizedStringResource {
        switch self {
        case .off: "Off"
        case .auto: "Auto"
        case .low: "Low"
        case .medium: "Medium"
        case .high: "High"
        }
    }
}

extension SampleModel {
    static let claudeSonnet = SampleModel(
        id: "anthropic/claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        provider: .anthropic,
        reasoningLevels: ReasoningLevel.allCases,
        defaultReasoningLevel: .auto
    )

    /// Every sample model, in catalog order.
    static let catalog: [SampleModel] = [
        SampleModel(
            id: "anthropic/claude-opus-4-1",
            name: "Claude Opus 4.1",
            provider: .anthropic,
            reasoningLevels: ReasoningLevel.allCases,
            defaultReasoningLevel: .auto
        ),
        claudeSonnet,
        SampleModel(
            id: "anthropic/claude-haiku-4-5",
            name: "Claude Haiku 4.5",
            provider: .anthropic,
            reasoningLevels: ReasoningLevel.allCases,
            defaultReasoningLevel: .off
        ),
        SampleModel(
            id: "openai/gpt-5",
            name: "GPT-5",
            provider: .openAI,
            reasoningLevels: [.low, .medium, .high],
            defaultReasoningLevel: .medium
        ),
        SampleModel(
            id: "openai/gpt-5-mini",
            name: "GPT-5 mini",
            provider: .openAI,
            reasoningLevels: [.low, .medium, .high],
            defaultReasoningLevel: .medium
        ),
        SampleModel(
            id: "openai/gpt-4.1",
            name: "GPT-4.1",
            provider: .openAI,
            reasoningLevels: [.off],
            defaultReasoningLevel: .off
        ),
        SampleModel(
            id: "google/gemini-2.5-pro",
            name: "Gemini 2.5 Pro",
            provider: .google,
            reasoningLevels: [.auto, .low, .high],
            defaultReasoningLevel: .auto
        ),
        SampleModel(
            id: "google/gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            provider: .google,
            reasoningLevels: [.off, .auto, .low, .high],
            defaultReasoningLevel: .auto
        ),
    ]
}
