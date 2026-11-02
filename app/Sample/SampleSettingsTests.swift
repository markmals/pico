import Testing

@testable import Pico

@MainActor
@Suite("proposal.0005 sample data")
struct SampleSettingsTests {
    @Test("signing in records the chosen way for that provider alone")
    func signInRecordsTheChosenWay() throws {
        let settings = SampleSettings()
        let (first, second) = (SampleProvider.popular[0], SampleProvider.popular[1])
        let secondBefore = settings.signInMethod(of: second)
        let method = try #require(
            first.signInMethods.last { $0 != settings.signInMethod(of: first) }
        )

        settings.signIn(first, with: method)

        #expect(settings.isSignedIn(first))
        #expect(settings.signInMethod(of: first) == method)
        #expect(settings.signInMethod(of: second) == secondBefore)
    }

    @Test("a way the provider does not offer cannot sign it in")
    func unofferedWayCannotSignIn() throws {
        let settings = SampleSettings()
        let provider = try #require(
            SampleProvider.allCases.first {
                !settings.isSignedIn($0) && $0.signInMethods.count < SignInMethod.allCases.count
            }
        )
        let unoffered = try #require(
            SignInMethod.allCases.first { !provider.signInMethods.contains($0) }
        )

        settings.signIn(provider, with: unoffered)

        #expect(!settings.isSignedIn(provider))
        #expect(settings.signInMethod(of: provider) == nil)
    }

    @Test("every provider offers at least one way to sign in")
    func everyProviderOffersAWay() {
        for provider in SampleProvider.allCases {
            #expect(!provider.signInMethods.isEmpty, "\(provider.name)")
        }
    }

    @Test(
        "each way a provider offers shows its own account",
        arguments: SampleProvider.allCases
    )
    func eachWayShowsItsOwnAccount(provider: SampleProvider) {
        let accounts = provider.signInMethods.map {
            String(localized: provider.accountLabel(for: $0))
        }

        #expect(Set(accounts).count == accounts.count, "\(provider.name): \(accounts)")
    }

    @Test("the default-model choices are the catalog models of signed-in providers")
    func availableModelsExcludeProvidersNeedingSignIn() throws {
        let settings = SampleSettings()
        try #require(SampleProvider.allCases.contains { !settings.isSignedIn($0) })

        #expect(!settings.availableModels.isEmpty)
        #expect(
            settings.availableModels
                == SampleModel.catalog.filter { settings.isSignedIn($0.provider) }
        )
    }

    @Test("changing the model keeps a reasoning level the new model supports")
    func supportedReasoningLevelIsKept() throws {
        let settings = SampleSettings()
        settings.reasoningLevel = .high
        let model = try #require(
            settings.availableModels.first {
                $0 != settings.defaultModel && $0.reasoningLevels.contains(.high)
            }
        )

        settings.chooseDefaultModel(model)

        #expect(settings.defaultModel == model)
        #expect(settings.reasoningLevel == .high)
        #expect(settings.reasoningLevels == model.reasoningLevels)
    }

    @Test("changing the model switches an unsupported reasoning level to the model's default")
    func unsupportedReasoningLevelSwitchesToDefault() throws {
        let settings = SampleSettings()
        let model = try #require(
            settings.availableModels.first { !$0.reasoningLevels.contains(settings.reasoningLevel) }
        )

        settings.chooseDefaultModel(model)

        #expect(settings.defaultModel == model)
        #expect(settings.reasoningLevel == model.defaultReasoningLevel)
    }

    @Test("a model whose provider needs sign-in cannot become the default")
    func unavailableModelIsNotChosen() throws {
        let settings = SampleSettings()
        let original = settings.defaultModel
        let unavailable = try #require(
            SampleModel.catalog.first { !settings.isSignedIn($0.provider) }
        )

        settings.chooseDefaultModel(unavailable)

        #expect(settings.defaultModel == original)
    }

    @Test("signing out the default model's provider moves the default to the first available model")
    func signingOutMovesTheDefaultModel() throws {
        let settings = SampleSettings()
        let provider = try #require(settings.defaultModel?.provider)

        settings.signOut(provider)

        #expect(!settings.isSignedIn(provider))
        #expect(!settings.availableModels.contains { $0.provider == provider })
        #expect(settings.defaultModel != nil)
        #expect(settings.defaultModel == settings.availableModels.first)
        #expect(settings.defaultModel?.reasoningLevels.contains(settings.reasoningLevel) == true)
    }

    @Test("signing out another provider keeps the default model")
    func signingOutAnotherProviderKeepsTheDefault() throws {
        let settings = SampleSettings()
        let model = try #require(settings.defaultModel)
        let other = try #require(
            SampleProvider.allCases.first { $0 != model.provider && settings.isSignedIn($0) }
        )

        settings.signOut(other)

        #expect(settings.defaultModel == model)
    }

    @Test("with no provider signed in, no model can be chosen")
    func noSignedInProviderMeansNoModel() {
        let settings = SampleSettings()

        for provider in SampleProvider.allCases {
            settings.signOut(provider)
        }

        #expect(settings.availableModels.isEmpty)
        #expect(settings.defaultModel == nil)
        #expect(settings.reasoningLevels.isEmpty)
    }

    @Test("signing in makes the provider's models available")
    func signingInMakesModelsAvailable() throws {
        let settings = SampleSettings()
        let provider = try #require(
            SampleProvider.allCases.first { candidate in
                !settings.isSignedIn(candidate)
                    && SampleModel.catalog.contains { $0.provider == candidate }
            }
        )
        let method = try #require(provider.signInMethods.first)

        settings.signIn(provider, with: method)

        #expect(settings.isSignedIn(provider))
        #expect(settings.availableModels.contains { $0.provider == provider })
    }

    @Test("signing in when no model is available makes its first model the default")
    func signingInRestoresADefaultModel() throws {
        let settings = SampleSettings()
        for provider in SampleProvider.allCases {
            settings.signOut(provider)
        }

        settings.signIn(.openAI, with: try #require(SampleProvider.openAI.signInMethods.first))

        let model = try #require(settings.defaultModel)
        #expect(model == settings.availableModels.first)
        #expect(model.reasoningLevels.contains(settings.reasoningLevel))
    }

    @Test("unregistering and registering switch Pico's sample Sesh registration")
    func seshRegistrationSwitches() {
        let settings = SampleSettings()
        #expect(settings.isRegisteredWithSesh)

        settings.unregisterFromSesh()
        #expect(!settings.isRegisteredWithSesh)

        settings.registerWithSesh()
        #expect(settings.isRegisteredWithSesh)
    }

    @Test("the list shows the popular providers, then others while they are signed in, in order")
    func listedProvidersFollowSignIn() throws {
        let settings = SampleSettings()
        let others = SampleProvider.allCases.filter { !SampleProvider.popular.contains($0) }
        try #require(others.count >= 2)
        #expect(settings.listedProviders == SampleProvider.popular)

        settings.signIn(others[1], with: try #require(others[1].signInMethods.first))
        settings.signIn(others[0], with: try #require(others[0].signInMethods.first))
        #expect(settings.listedProviders == SampleProvider.popular + [others[1], others[0]])

        settings.signOut(others[1])
        #expect(settings.listedProviders == SampleProvider.popular + [others[0]])
    }

    @Test("signing a popular provider out keeps it listed")
    func popularProvidersStayListed() throws {
        let settings = SampleSettings()
        let provider = try #require(SampleProvider.popular.first(where: settings.isSignedIn))

        settings.signOut(provider)

        #expect(settings.listedProviders == SampleProvider.popular)
    }

    @Test("signing in again lists a provider once")
    func signingInAgainListsOnce() throws {
        let settings = SampleSettings()
        let provider = try #require(
            SampleProvider.allCases.first {
                !SampleProvider.popular.contains($0) && $0.signInMethods.count == 1
            }
        )
        let method = try #require(provider.signInMethods.first)

        settings.signIn(provider, with: method)
        settings.signIn(provider, with: method)

        #expect(settings.listedProviders.filter { $0 == provider }.count == 1)
    }
}
