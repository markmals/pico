import Foundation
import Observation

/// The in-memory state behind sample data. It lasts as long as the app and is never saved.
///
/// The default model is always one of `availableModels`, or `nil` when no model is available.
@MainActor
@Observable
final class SampleSettings {
    private(set) var defaultModel: SampleModel? = .claudeSonnet
    var reasoningLevel: ReasoningLevel = .auto
    private(set) var isRegisteredWithSesh = true

    /// How each signed-in provider is signed in; a provider without an entry is signed out.
    private var signIns: [SampleProvider: SignInMethod] = Dictionary(
        uniqueKeysWithValues: SampleProvider.allCases.compactMap { provider in
            provider.initialSignInMethod.map { (provider, $0) }
        }
    )
    /// Signed-in providers that are not popular, in the order they were signed in to.
    private var signedInOthers: [SampleProvider] = []

    /// The popular providers, then any other provider while it is signed in.
    var listedProviders: [SampleProvider] {
        SampleProvider.popular + signedInOthers
    }

    var availableModels: [SampleModel] {
        SampleModel.catalog.filter { isSignedIn($0.provider) }
    }

    var reasoningLevels: [ReasoningLevel] {
        defaultModel?.reasoningLevels ?? []
    }

    func isSignedIn(_ provider: SampleProvider) -> Bool {
        signIns[provider] != nil
    }

    /// How a provider is signed in, or `nil` when it is not.
    func signInMethod(of provider: SampleProvider) -> SignInMethod? {
        signIns[provider]
    }

    /// Signs a provider in with one of the ways it offers; otherwise changes nothing.
    func signIn(_ provider: SampleProvider, with method: SignInMethod) {
        guard provider.signInMethods.contains(method) else { return }
        signIns[provider] = method
        if !SampleProvider.popular.contains(provider), !signedInOthers.contains(provider) {
            signedInOthers.append(provider)
        }
        if defaultModel == nil, let model = availableModels.first {
            chooseDefaultModel(model)
        }
    }

    func signOut(_ provider: SampleProvider) {
        signIns[provider] = nil
        signedInOthers.removeAll { $0 == provider }
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
}
