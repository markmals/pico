import Testing

@testable import Pico

@MainActor
@Suite("proposal.0005 sample data")
struct SampleSettingsTests {
    @Test("each provider keeps its own account and credential-source choices")
    func providersKeepTheirOwnChoices() throws {
        let settings = SampleSettings()
        let signedIn = SampleProvider.allCases.filter(settings.isSignedIn)
        try #require(signedIn.count >= 2)
        let (first, second) = (signedIn[0], signedIn[1])

        settings.shownProvider = first
        let otherAccount = try #require(first.accounts.first { $0 != settings.shownAccount })
        settings.shownAccount = otherAccount
        settings.shownCredentialSource = .browserSignIn
        settings.shownProvider = second
        settings.shownCredentialSource = .apiKey
        settings.shownProvider = first

        #expect(settings.shownAccount == otherAccount)
        #expect(settings.shownCredentialSource == .browserSignIn)
        settings.shownProvider = second
        #expect(settings.shownCredentialSource == .apiKey)
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

    @Test("signing in makes the provider's models available with its first account")
    func signingInMakesModelsAvailable() throws {
        let settings = SampleSettings()
        let provider = try #require(SampleProvider.allCases.first { !settings.isSignedIn($0) })

        settings.signIn(provider)
        settings.shownProvider = provider

        #expect(settings.isSignedIn(provider))
        #expect(settings.availableModels.contains { $0.provider == provider })
        #expect(settings.shownAccount == provider.accounts.first)
    }

    @Test("signing in when no model is available makes its first model the default")
    func signingInRestoresADefaultModel() throws {
        let settings = SampleSettings()
        for provider in SampleProvider.allCases {
            settings.signOut(provider)
        }

        settings.signIn(.openAI)

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
