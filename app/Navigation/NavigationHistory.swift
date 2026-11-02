import Foundation

/// The pages visited in this window, with browser back/forward rules.
struct NavigationHistory: Equatable {
    private(set) var current: SettingsPage
    private var backStack: [SettingsPage] = []
    private var forwardStack: [SettingsPage] = []

    init(start: SettingsPage) {
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

    mutating func navigate(to page: SettingsPage) {
        guard page != current else { return }
        backStack.append(current)
        forwardStack.removeAll()
        current = page
    }

    /// Removes every entry `shouldForget` matches. Neighbouring entries that become the same
    /// merge into one. If the current page is removed, the entry before it becomes current, or
    /// its destination's main page when there is none.
    mutating func forget(where shouldForget: (SettingsPage) -> Bool) {
        let timeline = backStack + [current] + forwardStack.reversed()
        let currentIndex = backStack.count
        var kept: [SettingsPage] = []
        var keptCurrentIndex: Int?
        for (index, page) in timeline.enumerated() where !shouldForget(page) {
            if index <= currentIndex { keptCurrentIndex = kept.count }
            kept.append(page)
        }
        if keptCurrentIndex == nil {
            kept.insert(.main(current.destination), at: 0)
            keptCurrentIndex = 0
        }
        let (merged, mergedCurrentIndex) = Self.mergingNeighbours(
            kept,
            current: keptCurrentIndex ?? 0
        )
        backStack = Array(merged[..<mergedCurrentIndex])
        current = merged[mergedCurrentIndex]
        forwardStack = merged[(mergedCurrentIndex + 1)...].reversed()
    }

    private static func mergingNeighbours(
        _ pages: [SettingsPage],
        current: Int
    ) -> (pages: [SettingsPage], current: Int) {
        var merged: [SettingsPage] = []
        var mergedCurrent = 0
        for (index, page) in pages.enumerated() {
            if merged.last != page { merged.append(page) }
            if index == current { mergedCurrent = merged.count - 1 }
        }
        return (merged, mergedCurrent)
    }
}
