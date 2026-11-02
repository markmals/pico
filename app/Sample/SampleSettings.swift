import Foundation
import Observation

/// The in-memory state behind sample data. It lasts as long as the app and is never saved.
///
/// The default model is always one of `availableModels`, or `nil` when no model is available.
/// A provider is signed in only while it is added.
@MainActor
@Observable
final class SampleSettings {
    private(set) var defaultModel: SampleModel? = .claudeSonnet
    var reasoningLevel: ReasoningLevel = .auto
    var catalogQuery = ""
    private(set) var isRegisteredWithSesh = true

    private var providerStates = Dictionary(
        uniqueKeysWithValues: SampleProvider.allCases.map { ($0, $0.initialState) }
    )
    /// Added providers that are not popular, in the order they were added.
    private var addedOthers: [SampleProvider] = []

    /// The popular providers, then the others added, in the order they were added.
    var listedProviders: [SampleProvider] {
        SampleProvider.popular + addedOthers
    }

    /// The providers Add Provider… offers: the others not yet added.
    var providersToAdd: [SampleProvider] {
        SampleProvider.allCases.filter { !SampleProvider.popular.contains($0) && !isAdded($0) }
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

    func isAdded(_ provider: SampleProvider) -> Bool {
        state(of: provider).isAdded
    }

    func isSignedIn(_ provider: SampleProvider) -> Bool {
        state(of: provider).signInMethod != nil
    }

    /// How a provider is signed in, or `nil` when it is not.
    func signInMethod(of provider: SampleProvider) -> SignInMethod? {
        state(of: provider).signInMethod
    }

    /// Sets a provider up, needing sign-in.
    func add(_ provider: SampleProvider) {
        guard !isAdded(provider) else { return }
        providerStates[provider]?.isAdded = true
        if !SampleProvider.popular.contains(provider) {
            addedOthers.append(provider)
        }
    }

    /// Signs a provider out and takes it off the list; a popular provider stays listed.
    func remove(_ provider: SampleProvider) {
        signOut(provider)
        providerStates[provider]?.isAdded = false
        addedOthers.removeAll { $0 == provider }
    }

    /// Signs a set-up provider in with one of the ways it offers; otherwise changes nothing.
    func signIn(_ provider: SampleProvider, with method: SignInMethod) {
        guard isAdded(provider), provider.signInMethods.contains(method) else { return }
        providerStates[provider]?.signInMethod = method
        if defaultModel == nil, let model = availableModels.first {
            chooseDefaultModel(model)
        }
    }

    func signOut(_ provider: SampleProvider) {
        providerStates[provider]?.signInMethod = nil
        guard defaultModel?.provider == provider else { return }
        if let model = availableModels.first {
            chooseDefaultModel(model)
        } else {
            defaultModel = nil
        }
    }

    /// Makes `model` the default when its provider is signed in; otherwise changes nothing.
    func chooseDefaultModel(_ model: SampleModel) {
        guard isSignedIn(model.provider) else { return }
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
