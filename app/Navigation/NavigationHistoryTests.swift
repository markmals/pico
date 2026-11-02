import Testing

@testable import Pico

@Suite("proposal.0005 navigation history")
struct NavigationHistoryTests {
    @Test("starts on its first page with nothing to go back or forward to")
    func startsEmpty() {
        let history = NavigationHistory(start: .main(.general))

        #expect(history.current == .main(.general))
        #expect(!history.canGoBack)
        #expect(!history.canGoForward)
    }

    @Test("navigating to another page makes the previous one the back target")
    func navigatingPushesBack() {
        var history = NavigationHistory(start: .main(.general))

        history.navigate(to: .main(.models))
        #expect(history.current == .main(.models))
        #expect(history.canGoBack)
        #expect(!history.canGoForward)

        history.goBack()
        #expect(history.current == .main(.general))
        #expect(!history.canGoBack)
    }

    @Test("navigating to the current page changes no history")
    func navigatingToCurrentIsNoOp() {
        var history = NavigationHistory(start: .main(.general))
        history.navigate(to: .main(.models))
        history.goBack()

        history.navigate(to: .main(.general))

        #expect(history.current == .main(.general))
        #expect(!history.canGoBack)
        #expect(history.canGoForward)
    }

    @Test("back then forward returns through the visited pages in order")
    func backAndForwardRetraceVisits() {
        var history = NavigationHistory(start: .main(.general))
        history.navigate(to: .main(.providers))
        history.navigate(to: .main(.tools))

        history.goBack()
        #expect(history.current == .main(.providers))
        history.goBack()
        #expect(history.current == .main(.general))
        #expect(!history.canGoBack)
        #expect(history.canGoForward)

        history.goForward()
        #expect(history.current == .main(.providers))
        history.goForward()
        #expect(history.current == .main(.tools))
        #expect(!history.canGoForward)
        #expect(history.canGoBack)
    }

    @Test("navigating after going back discards the forward history")
    func navigatingClearsForward() {
        var history = NavigationHistory(start: .main(.general))
        history.navigate(to: .main(.models))
        history.navigate(to: .main(.sesh))
        history.goBack()

        history.navigate(to: .main(.diagnostics))

        #expect(!history.canGoForward)
        history.goBack()
        #expect(history.current == .main(.models))
    }

    @Test("back and forward do nothing when there is nowhere to go")
    func emptyDirectionsAreNoOps() {
        var history = NavigationHistory(start: .main(.sesh))

        history.goBack()
        history.goForward()

        #expect(history.current == .main(.sesh))
        #expect(!history.canGoBack)
        #expect(!history.canGoForward)
    }

    @Test("a provider page is a history step after its list")
    func providerPageIsAHistoryStep() {
        var history = NavigationHistory(start: .main(.providers))

        history.navigate(to: .provider("anthropic"))
        #expect(history.current == .provider("anthropic"))
        #expect(history.current.destination == .providers)

        history.goBack()
        #expect(history.current == .main(.providers))
        #expect(history.canGoForward)
    }

    @Test("forgetting the current page returns to the entry before it")
    func forgettingCurrentReturnsToPrevious() {
        var history = NavigationHistory(start: .main(.general))
        history.navigate(to: .main(.providers))
        history.navigate(to: .provider("anthropic"))

        history.forget { $0 == .provider("anthropic") }

        #expect(history.current == .main(.providers))
        #expect(!history.canGoForward)
        history.goBack()
        #expect(history.current == .main(.general))
    }

    @Test("forgetting a page merges neighbouring entries that become the same")
    func forgettingMergesNeighbours() {
        var history = NavigationHistory(start: .main(.general))
        history.navigate(to: .main(.providers))
        history.navigate(to: .provider("anthropic"))
        history.navigate(to: .main(.providers))
        history.navigate(to: .main(.models))

        history.forget { $0 == .provider("anthropic") }

        #expect(history.current == .main(.models))
        history.goBack()
        #expect(history.current == .main(.providers))
        history.goBack()
        #expect(history.current == .main(.general))
        #expect(!history.canGoBack)
    }

    @Test("forgetting a page removes it from the forward history too")
    func forgettingClearsForwardEntries() {
        var history = NavigationHistory(start: .main(.providers))
        history.navigate(to: .provider("openAI"))
        history.goBack()

        history.forget { $0 == .provider("openAI") }

        #expect(history.current == .main(.providers))
        #expect(!history.canGoForward)
    }

    @Test("forgetting the only page falls back to its destination's main page")
    func forgettingOnlyPageFallsBack() {
        var history = NavigationHistory(start: .provider("google"))

        history.forget { $0 == .provider("google") }

        #expect(history.current == .main(.providers))
        #expect(!history.canGoBack)
        #expect(!history.canGoForward)
    }
}
