import Foundation
import Testing

@testable import Pico

@MainActor
@Suite("proposal.0005 opening settings locations")
struct SettingsNavigatorTests {
    @Test("Pico starts on General with nothing revealed or rejected")
    func startsOnGeneral() {
        let navigator = SettingsNavigator()

        #expect(navigator.current == .general)
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

        #expect(navigator.current == .general)
        #expect(navigator.canGoForward)
    }

    @Test("opening an item navigates to its destination and reveals it")
    func openingAnItemRevealsIt() {
        let navigator = SettingsNavigator()

        navigator.open(.item(.reasoningLevel))

        #expect(navigator.current == .models)
        #expect(navigator.revealedItem == .reasoningLevel)
        #expect(navigator.openedLocation == .item(.reasoningLevel))
        #expect(navigator.canGoBack)
    }

    @Test("revealing another item on the same destination is not a history entry")
    func revealingOnSameDestinationKeepsHistory() {
        let navigator = SettingsNavigator()
        navigator.open(.item(.reasoningLevel))

        navigator.open(.item(.model))
        #expect(navigator.current == .models)
        #expect(navigator.revealedItem == .model)

        navigator.goBack()
        #expect(navigator.current == .general)
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
    }

    @Test("choosing a search result opens its location")
    func searchSelectionOpens() {
        let navigator = SettingsNavigator()

        navigator.searchSelection = .item(.credentialSource)

        #expect(navigator.current == .providers)
        #expect(navigator.revealedItem == .credentialSource)
        #expect(navigator.searchSelection == .item(.credentialSource))
    }

    @Test("a valid link opens its location")
    func validLinkOpens() throws {
        let navigator = SettingsNavigator()

        navigator.handle(try #require(URL(string: "pico://settings/tools/shell")))

        #expect(navigator.current == .tools)
        #expect(navigator.revealedItem == .shell)
        #expect(navigator.rejectedLink == nil)
    }

    @Test("the settings root link changes nothing")
    func rootLinkChangesNothing() throws {
        let navigator = SettingsNavigator()
        navigator.selectedDestination = .models

        navigator.handle(try #require(URL(string: "pico://settings")))

        #expect(navigator.current == .models)
        #expect(navigator.rejectedLink == nil)
        navigator.goBack()
        #expect(navigator.current == .general)
    }

    @Test("an invalid link is rejected without changing the pane or history")
    func invalidLinkIsRejected() throws {
        let navigator = SettingsNavigator()
        navigator.open(.item(.reasoningLevel))
        let link = try #require(URL(string: "pico://settings/models/shell"))

        navigator.handle(link)

        #expect(navigator.rejectedLink == link)
        #expect(navigator.current == .models)
        #expect(navigator.revealedItem == .reasoningLevel)
        navigator.goBack()
        #expect(navigator.current == .general)
    }
}
