import Foundation

/// The destinations visited in this window, with browser back/forward rules.
struct NavigationHistory: Equatable {
    private(set) var current: SettingsDestination
    private var backStack: [SettingsDestination] = []
    private var forwardStack: [SettingsDestination] = []

    init(start: SettingsDestination) {
        current = start
    }

    var canGoBack: Bool { !backStack.isEmpty }

    var canGoForward: Bool { !forwardStack.isEmpty }

    mutating func goBack() {
        guard let previous = backStack.popLast() else { return }
        forwardStack.append(current)
        current = previous
    }

    mutating func goForward() {
        guard let next = forwardStack.popLast() else { return }
        backStack.append(current)
        current = next
    }

    mutating func navigate(to destination: SettingsDestination) {
        guard destination != current else { return }
        backStack.append(current)
        forwardStack.removeAll()
        current = destination
    }
}
