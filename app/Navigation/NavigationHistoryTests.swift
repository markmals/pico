import Testing

@testable import Pico

@Suite("proposal.0005 navigation history")
struct NavigationHistoryTests {
    @Test("starts on its first destination with nothing to go back or forward to")
    func startsEmpty() {
        let history = NavigationHistory(start: .general)

        #expect(history.current == .general)
        #expect(!history.canGoBack)
        #expect(!history.canGoForward)
    }

    @Test("navigating to another destination makes the previous one the back target")
    func navigatingPushesBack() {
        var history = NavigationHistory(start: .general)

        history.navigate(to: .models)
        #expect(history.current == .models)
        #expect(history.canGoBack)
        #expect(!history.canGoForward)

        history.goBack()
        #expect(history.current == .general)
        #expect(!history.canGoBack)
    }

    @Test("navigating to the current destination changes no history")
    func navigatingToCurrentIsNoOp() {
        var history = NavigationHistory(start: .general)
        history.navigate(to: .models)
        history.goBack()

        history.navigate(to: .general)

        #expect(history.current == .general)
        #expect(!history.canGoBack)
        #expect(history.canGoForward)
    }

    @Test("back then forward returns through the visited destinations in order")
    func backAndForwardRetraceVisits() {
        var history = NavigationHistory(start: .general)
        history.navigate(to: .providers)
        history.navigate(to: .tools)

        history.goBack()
        #expect(history.current == .providers)
        history.goBack()
        #expect(history.current == .general)
        #expect(!history.canGoBack)
        #expect(history.canGoForward)

        history.goForward()
        #expect(history.current == .providers)
        history.goForward()
        #expect(history.current == .tools)
        #expect(!history.canGoForward)
        #expect(history.canGoBack)
    }

    @Test("navigating after going back discards the forward history")
    func navigatingClearsForward() {
        var history = NavigationHistory(start: .general)
        history.navigate(to: .models)
        history.navigate(to: .sesh)
        history.goBack()

        history.navigate(to: .diagnostics)

        #expect(!history.canGoForward)
        history.goBack()
        #expect(history.current == .models)
    }

    @Test("back and forward do nothing when there is nowhere to go")
    func emptyDirectionsAreNoOps() {
        var history = NavigationHistory(start: .sesh)

        history.goBack()
        history.goForward()

        #expect(history.current == .sesh)
        #expect(!history.canGoBack)
        #expect(!history.canGoForward)
    }
}
