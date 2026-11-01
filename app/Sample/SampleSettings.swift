import Foundation
import Observation

/// The in-memory state behind sample data. It lasts as long as the app and is never saved.
///
/// The default model is always one of `availableModels`, or `nil` when no model is available.
@MainActor
@Observable
final class SampleSettings {
    var shownProvider: SampleProvider = .anthropic
    private(set) var defaultModel: SampleModel? = .claudeSonnet
    var reasoningLevel: ReasoningLevel = .auto
    var catalogQuery = ""
    private(set) var isRegisteredWithSesh = true

    private var providerStates = Dictionary(
        uniqueKeysWithValues: SampleProvider.allCases.map { ($0, $0.initialState) }
    )

    var shownAccount: String? {
        get { state(of: shownProvider).account }
        set { providerStates[shownProvider]?.account = newValue }
    }

    var shownCredentialSource: CredentialSource {
        get { state(of: shownProvider).credentialSource }
        set { providerStates[shownProvider]?.credentialSource = newValue }
    }

    var availableModels: [SampleModel] {
        SampleModel.catalog.filter { isSignedIn($0.provider) }
    }

    var reasoningLevels: [ReasoningLevel] {
        defaultModel?.reasoningLevels ?? []
    }

    var catalogResults: [SampleModel] {
        guard !catalogQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return SampleModel.catalog
        }
        let queryWords = SettingsSearch.words(in: catalogQuery)
        guard !queryWords.isEmpty else { return [] }
        return SampleModel.catalog.filter { model in
            let modelWords = SettingsSearch.words(in: "\(model.name) \(model.provider.name)")
            return SettingsSearch.matches(queryWords, modelWords)
        }
    }

    func isSignedIn(_ provider: SampleProvider) -> Bool {
        state(of: provider).isSignedIn
    }

    func signIn(_ provider: SampleProvider) {
        providerStates[provider]?.isSignedIn = true
        providerStates[provider]?.account = provider.accounts.first
        if defaultModel == nil, let model = availableModels.first {
            chooseDefaultModel(model)
        }
    }

    func signOut(_ provider: SampleProvider) {
        providerStates[provider]?.isSignedIn = false
        providerStates[provider]?.account = nil
        guard defaultModel?.provider == provider else { return }
        if let model = availableModels.first {
            chooseDefaultModel(model)
        } else {
            defaultModel = nil
        }
    }

    func chooseDefaultModel(_ model: SampleModel) {
        defaultModel = model
        if !model.reasoningLevels.contains(reasoningLevel) {
            reasoningLevel = model.defaultReasoningLevel
        }
    }

    func registerWithSesh() {
        isRegisteredWithSesh = true
    }

    func unregisterFromSesh() {
        isRegisteredWithSesh = false
    }

    private func state(of provider: SampleProvider) -> SampleProviderState {
        providerStates[provider] ?? provider.initialState
    }
}
