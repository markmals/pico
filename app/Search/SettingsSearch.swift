import Foundation

/// Finds panes and settings by the words of their localized titles and keywords.
enum SettingsSearch {
    /// The locations matching `query` in sidebar order, or `nil` when the query is empty after
    /// trimming whitespace and so is not a search.
    static func results(for query: String) -> [SettingsLocation]? {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let queryWords = words(in: query)
        guard !queryWords.isEmpty else { return [] }
        return SettingsLocation.allInSidebarOrder.filter { location in
            let candidateWords = searchableWords(of: location)
            return queryWords.allSatisfy { queryWord in
                candidateWords.contains { $0.hasPrefix(queryWord) }
            }
        }
    }

    private static func searchableWords(of location: SettingsLocation) -> [String] {
        switch location {
        case .destination(let destination):
            words(in: String(localized: destination.title))
        case .item(let item):
            ([item.title] + item.keywords).flatMap { words(in: String(localized: $0)) }
        }
    }

    private static func words(in text: String) -> [String] {
        text.folding(
            options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
            locale: .current
        )
        .split { !$0.isLetter && !$0.isNumber }
        .map(String.init)
    }
}
