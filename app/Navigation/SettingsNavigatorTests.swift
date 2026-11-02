import Foundation
import Testing

@testable import Pico

@MainActor
@Suite("proposal.0005 opening settings locations")
struct SettingsNavigatorTests {
    @Test("Pico starts on General with nothing revealed or rejected")
    func startsOnGeneral() {
        let navigator = SettingsNavigator()

        #expect(navigator.page == .main(.general))
        #expect(navigator.revealedItem == nil)
        #expect(navigator.rejectedLink == nil)
        #expect(!navigator.canGoBack)
        #expect(!navigator.canGoForward)
    }

    @Test("choosing a sidebar destination is a navigation")
    func sidebarSelectionNavigates() {
        let navigator = SettingsNavigator()

        navigator.selectedDestination = .sesh
        navigator.goBack()

        #expect(navigator.destination == .general)
        #expect(navigator.canGoForward)
    }

    @Test("opening an item navigates to its destination and reveals it")
    func openingAnItemRevealsIt() {
        let navigator = SettingsNavigator()

        navigator.open(.item(.reasoningLevel))

        #expect(navigator.page == .main(.models))
        #expect(navigator.revealedItem == .reasoningLevel)
        #expect(navigator.openedLocation == .item(.reasoningLevel))
        #expect(navigator.canGoBack)
    }

    @Test("revealing another item on the same destination is not a history entry")
    func revealingOnSameDestinationKeepsHistory() {
        let navigator = SettingsNavigator()
        navigator.open(.item(.reasoningLevel))

        navigator.open(.item(.model))
        #expect(navigator.destination == .models)
        #expect(navigator.revealedItem == .model)

        navigator.goBack()
        #expect(navigator.destination == .general)
        #expect(!navigator.canGoBack)
    }

    @Test("the next navigation of any kind clears the revealed item")
    func revealedItemIsTransient() {
        let navigator = SettingsNavigator()

        navigator.open(.item(.shell))
        navigator.selectedDestination = .models
        #expect(navigator.revealedItem == nil)
        #expect(navigator.openedLocation == nil)

        navigator.open(.item(.reasoningLevel))
        navigator.goBack()
        #expect(navigator.revealedItem == nil)

        navigator.open(.item(.shell))
        navigator.open(.destination(.tools))
        #expect(navigator.revealedItem == nil)
        #expect(navigator.openedLocation == .destination(.tools))

        navigator.open(.item(.providerList))
        navigator.openProvider("anthropic")
        #expect(navigator.revealedItem == nil)
    }

    @Test("choosing a search result opens its location")
    func searchSelectionOpens() {
        let navigator = SettingsNavigator()

        navigator.searchSelection = .item(.providerList)

        #expect(navigator.page == .main(.providers))
        #expect(navigator.revealedItem == .providerList)
        #expect(navigator.searchSelection == .item(.providerList))
    }

    @Test("opening a provider page is a history step that back returns from")
    func providerPageIsAHistoryStep() {
        let navigator = SettingsNavigator()
        navigator.selectedDestination = .providers

        navigator.openProvider("anthropic")
        #expect(navigator.page == .provider("anthropic"))
        #expect(navigator.destination == .providers)
        #expect(navigator.selectedDestination == .providers)

        navigator.goBack()
        #expect(navigator.page == .main(.providers))
    }

    @Test("choosing the current destination in the sidebar keeps a provider page open")
    func sidebarCurrentDestinationKeepsProviderPage() {
        let navigator = SettingsNavigator()
        navigator.selectedDestination = .providers
        navigator.openProvider("openAI")

        navigator.selectedDestination = .providers

        #expect(navigator.page == .provider("openAI"))
    }

    @Test("opening an item from a provider page goes to its destination's main page")
    func openingAnItemLeavesTheProviderPage() {
        let navigator = SettingsNavigator()
        navigator.selectedDestination = .providers
        navigator.openProvider("google")

        navigator.open(.item(.providerList))

        #expect(navigator.page == .main(.providers))
        #expect(navigator.revealedItem == .providerList)
        navigator.goBack()
        #expect(navigator.page == .provider("google"))
    }

    @Test("forgetting a provider's page returns to the provider list")
    func forgettingAProviderPage() {
        let navigator = SettingsNavigator()
        navigator.selectedDestination = .providers
        navigator.openProvider("anthropic")

        navigator.forgetProviderPage("anthropic")

        #expect(navigator.page == .main(.providers))
        #expect(!navigator.canGoForward)
    }

    @Test("forgetting every provider page keeps the other pages")
    func forgettingAllProviderPages() {
        let navigator = SettingsNavigator()
        navigator.selectedDestination = .providers
        navigator.openProvider("anthropic")
        navigator.goBack()
        navigator.openProvider("openAI")

        navigator.forgetProviderPages()

        #expect(navigator.page == .main(.providers))
        navigator.goBack()
        #expect(navigator.page == .main(.general))
        #expect(!navigator.canGoBack)
    }

    @Test("a valid link opens its location")
    func validLinkOpens() throws {
        let navigator = SettingsNavigator()

        navigator.handle(try #require(URL(string: "pico://settings/tools/shell")))

        #expect(navigator.destination == .tools)
        #expect(navigator.revealedItem == .shell)
        #expect(navigator.rejectedLink == nil)
    }

    @Test("the settings root link changes nothing")
    func rootLinkChangesNothing() throws {
        let navigator = SettingsNavigator()
        navigator.selectedDestination = .models

        navigator.handle(try #require(URL(string: "pico://settings")))

        #expect(navigator.destination == .models)
        #expect(navigator.rejectedLink == nil)
        navigator.goBack()
        #expect(navigator.destination == .general)
    }

    @Test("an invalid link is rejected without changing the pane or history")
    func invalidLinkIsRejected() throws {
        let navigator = SettingsNavigator()
        navigator.open(.item(.reasoningLevel))
        let link = try #require(URL(string: "pico://settings/models/shell"))

        navigator.handle(link)

        #expect(navigator.rejectedLink == link)
        #expect(navigator.destination == .models)
        #expect(navigator.revealedItem == .reasoningLevel)
        navigator.goBack()
        #expect(navigator.destination == .general)
    }

    @Test("a link that opens a location clears an earlier rejected link")
    func validLinkClearsRejection() throws {
        let navigator = SettingsNavigator()
        navigator.handle(try #require(URL(string: "pico://settings/unknown")))

        navigator.handle(try #require(URL(string: "pico://settings/tools/shell")))

        #expect(navigator.rejectedLink == nil)
        #expect(navigator.destination == .tools)
    }
}
