import Testing

@testable import Pico

@MainActor
@Suite("proposal.0005 sample data")
struct SampleSettingsTests {
    @Test("signing in records the chosen way for that provider alone")
    func signInRecordsTheChosenWay() throws {
        let settings = SampleSettings()
        let added = SampleProvider.allCases.filter(settings.isAdded)
        try #require(added.count >= 2)
        let (first, second) = (added[0], added[1])
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
            SampleProvider.allCases.first { settings.isAdded($0) && !settings.isSignedIn($0) }
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
            SampleProvider.allCases.first { settings.isAdded($0) && !settings.isSignedIn($0) }
        )
        let method = try #require(provider.signInMethods.first)

        settings.signIn(provider, with: method)

        #expect(settings.isSignedIn(provider))
        #expect(settings.availableModels.contains { $0.provider == provider })
    }

    @Test("a provider that is not set up cannot be signed in")
    func signingInNeedsSetUp() throws {
        let settings = SampleSettings()
        let provider = try #require(SampleProvider.allCases.first { !settings.isAdded($0) })

        settings.signIn(provider, with: try #require(provider.signInMethods.first))

        #expect(!settings.isSignedIn(provider))
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

    @Test("the popular providers are always listed, then the others in the order added")
    func listedProvidersKeepTheirOrder() throws {
        let settings = SampleSettings()
        let others = settings.providersToAdd
        try #require(others.count >= 2)

        #expect(settings.listedProviders == SampleProvider.popular)
        #expect(Set(others) == Set(SampleProvider.allCases).subtracting(SampleProvider.popular))

        settings.add(others[1])
        settings.add(others[0])

        #expect(settings.listedProviders == SampleProvider.popular + [others[1], others[0]])
        #expect(!settings.providersToAdd.contains(others[0]))
        #expect(!settings.providersToAdd.contains(others[1]))
    }

    @Test("setting up or adding a provider leaves it needing sign-in")
    func addedProvidersNeedSignIn() throws {
        let settings = SampleSettings()
        let notSetUp = SampleProvider.allCases.filter { !settings.isAdded($0) }
        try #require(notSetUp.contains { SampleProvider.popular.contains($0) })
        try #require(notSetUp.contains { !SampleProvider.popular.contains($0) })

        for provider in notSetUp {
            settings.add(provider)

            #expect(settings.isAdded(provider))
            #expect(!settings.isSignedIn(provider))
            #expect(settings.signInMethod(of: provider) == nil)
            #expect(settings.listedProviders.contains(provider))
        }
    }

    @Test("removing a provider signs it out and unlists it unless it is popular")
    func removingAProvider() throws {
        let settings = SampleSettings()
        let other = try #require(settings.providersToAdd.first)
        let popular = try #require(SampleProvider.popular.first { settings.isSignedIn($0) })
        settings.add(other)

        settings.remove(other)
        settings.remove(popular)

        #expect(!settings.isAdded(other))
        #expect(!settings.listedProviders.contains(other))
        #expect(settings.providersToAdd.contains(other))
        #expect(!settings.isAdded(popular))
        #expect(!settings.isSignedIn(popular))
        #expect(settings.listedProviders.contains(popular))
    }

    @Test("removing the default model's provider moves the default as signing out does")
    func removingMovesTheDefaultModel() throws {
        let settings = SampleSettings()
        let provider = try #require(settings.defaultModel?.provider)

        settings.remove(provider)

        #expect(settings.defaultModel != nil)
        #expect(settings.defaultModel == settings.availableModels.first)
        #expect(settings.defaultModel?.provider != provider)
    }

    @Test("a blank catalog query shows the whole catalog", arguments: ["", "  "])
    func blankCatalogQueryShowsEverything(query: String) {
        let settings = SampleSettings()

        settings.catalogQuery = query

        #expect(settings.catalogResults == SampleModel.catalog)
    }

    @Test(
        "the catalog filter finds every model by each word of its name",
        arguments: SampleModel.catalog
    )
    func catalogFindsEachModelByName(model: SampleModel) {
        let settings = SampleSettings()

        for word in model.name.split(separator: " ") {
            settings.catalogQuery = word.uppercased()
            #expect(settings.catalogResults.contains(model), "“\(word)” did not find \(model.id)")
        }
    }

    @Test("a provider's name filters the catalog to its models", arguments: SampleProvider.allCases)
    func catalogFiltersByProvider(provider: SampleProvider) {
        let settings = SampleSettings()

        settings.catalogQuery = provider.name.lowercased()

        #expect(settings.catalogResults == SampleModel.catalog.filter { $0.provider == provider })
    }

    @Test("a catalog query must start a word, not appear inside one")
    func catalogMatchesWordPrefixesOnly() throws {
        let settings = SampleSettings()
        let model = try #require(SampleModel.catalog.first)
        let word = try #require(model.name.split(separator: " ").first { $0.count > 2 })

        settings.catalogQuery = String(word.dropFirst())

        #expect(!settings.catalogResults.contains(model))
    }

    @Test(
        "a catalog query with no match, or of only punctuation, shows no results",
        arguments: ["zzzz", "?"]
    )
    func unmatchedCatalogQueryShowsNothing(query: String) {
        let settings = SampleSettings()

        settings.catalogQuery = query

        #expect(settings.catalogResults.isEmpty)
    }
}
