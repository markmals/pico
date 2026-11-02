import Foundation
import Testing

@testable import Pico

@Suite("proposal.0005 settings search")
struct SettingsSearchTests {
    @Test("an empty or whitespace-only query is not a search", arguments: ["", "   ", "\n\t "])
    func blankQueryIsNotASearch(query: String) {
        #expect(SettingsSearch.results(for: query) == nil)
    }

    @Test("a query with no match returns an empty result list")
    func unmatchedQueryHasNoResults() {
        #expect(SettingsSearch.results(for: "zzzz") == [])
    }

    @Test("a query of only punctuation is a search with no results", arguments: ["?", " - ", "…"])
    func punctuationQueryHasNoResults(query: String) {
        #expect(SettingsSearch.results(for: query) == [])
    }

    @Test("each query word must start a word of the title")
    func matchesWordPrefixes() throws {
        let results = try #require(SettingsSearch.results(for: "reas lev"))

        #expect(results.contains(.item(.reasoningLevel)))
        #expect(SettingsSearch.results(for: "soning")?.contains(.item(.reasoningLevel)) == false)
        #expect(SettingsSearch.results(for: "reasoning zzzz") == [])
    }

    @Test("matching ignores case, diacritics, and character width")
    func matchingIsNormalized() throws {
        let results = try #require(SettingsSearch.results(for: "RÉASONING"))
        let fullWidth = try #require(SettingsSearch.results(for: "ＲＥＡＳＯＮＩＮＧ"))

        #expect(results.contains(.item(.reasoningLevel)))
        #expect(fullWidth.contains(.item(.reasoningLevel)))
    }

    @Test("keywords find a setting by an alternative term")
    func keywordsMatch() {
        #expect(SettingsSearch.results(for: "thinking")?.contains(.item(.reasoningLevel)) == true)
        #expect(SettingsSearch.results(for: "terminal")?.contains(.item(.shell)) == true)
    }

    @Test(
        "account and credential terms find the provider list",
        arguments: ["API key", "sign in", "credential", "OAuth", "Keychain"]
    )
    func credentialTermsFindProviders(query: String) {
        #expect(SettingsSearch.results(for: query)?.contains(.item(.providerList)) == true)
    }

    @Test("a destination's title finds the destination")
    func destinationsMatch() {
        #expect(SettingsSearch.results(for: "diagnostics")?.first == .destination(.diagnostics))
    }

    @Test(
        "results follow sidebar order, each destination before its items",
        arguments: ["s", "c", "n", "e", "a", "models", "status"]
    )
    func resultsFollowSidebarOrder(query: String) throws {
        let results = try #require(SettingsSearch.results(for: query))
        let order = SettingsLocation.allInSidebarOrder

        let positions = results.compactMap { order.firstIndex(of: $0) }

        #expect(positions.count == results.count)
        #expect(positions == positions.sorted())
        #expect(Set(results).count == results.count)
    }

    @Test(
        "every settings item is found by each word of its own title",
        arguments: SettingsDestination.allCases.flatMap(\.items)
    )
    func everyItemFindsItself(item: SettingsItem) {
        for word in Self.words(in: String(localized: item.title)) {
            #expect(
                SettingsSearch.results(for: word)?.contains(.item(item)) == true,
                "“\(word)” did not find \(item.destination.rawValue)/\(item.slug)"
            )
        }
    }

    @Test(
        "every destination is found by each word of its own title",
        arguments: SettingsDestination.allCases
    )
    func everyDestinationFindsItself(destination: SettingsDestination) {
        for word in Self.words(in: String(localized: destination.title)) {
            #expect(SettingsSearch.results(for: word)?.contains(.destination(destination)) == true)
        }
    }

    private static func words(in text: String) -> [String] {
        text.split { !$0.isLetter && !$0.isNumber }.map(String.init)
    }
}
