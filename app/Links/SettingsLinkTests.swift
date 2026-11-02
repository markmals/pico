import Foundation
import Testing

@testable import Pico

@Suite("proposal.0005 pico:// links")
struct SettingsLinkTests {
    @Test("links name destinations and items by their slugs")
    func linkFormat() {
        #expect(
            SettingsLink.url(for: .destination(.models)).absoluteString == "pico://settings/models"
        )
        #expect(
            SettingsLink.url(for: .item(.reasoningLevel)).absoluteString
                == "pico://settings/models/reasoning-level"
        )
        #expect(
            SettingsLink.url(for: .item(.providerList)).absoluteString
                == "pico://settings/providers/provider-list"
        )
    }

    @Test(
        "every settings location round-trips through its link",
        arguments: SettingsLocation.allInSidebarOrder
    )
    func everyLocationRoundTrips(location: SettingsLocation) throws {
        #expect(try SettingsLink.location(from: SettingsLink.url(for: location)) == location)
    }

    @Test(
        "the settings root brings Pico forward without a location",
        arguments: [
            "pico://settings", "pico://settings/", "PICO://SETTINGS",
        ]
    )
    func rootHasNoLocation(link: String) throws {
        #expect(try SettingsLink.location(from: Self.url(link)) == nil)
    }

    @Test("a single trailing slash and a differently cased scheme or host are accepted")
    func lenientForms() throws {
        #expect(
            try SettingsLink.location(from: Self.url("pico://settings/models/"))
                == .destination(.models)
        )
        #expect(
            try SettingsLink.location(from: Self.url("Pico://Settings/models/reasoning-level/"))
                == .item(.reasoningLevel)
        )
    }

    @Test("an item slug is resolved within the named destination")
    func itemSlugsAreScopedToTheirDestination() throws {
        #expect(
            try SettingsLink.location(from: Self.url("pico://settings/general/pico-version"))
                == .item(.generalPicoVersion)
        )
        #expect(
            try SettingsLink.location(from: Self.url("pico://settings/diagnostics/pico-version"))
                == .item(.diagnosticsPicoVersion)
        )
    }

    @Test(
        "links Pico does not recognize are rejected",
        arguments: [
            "https://settings/models",
            "pico://preferences/models",
            "pico://settings/unknown",
            "pico://settings/Models",
            "pico://settings/models/unknown",
            "pico://settings/models/shell",
            "pico://settings/models/model/extra",
            "pico://settings/models?pane=1",
            "pico://settings/models#model",
            "pico://settings//models",
            "pico://settings/models//",
            "pico://user@settings/models",
            "pico://settings:8080/models",
            "pico://settings/mod%65ls",
            "pico://settings/general/runtime-status",
            "pico://settings/general/engine-status",
            "pico://settings/general/engine-version",
            "pico://settings/providers/provider",
            "pico://settings/providers/connection-status",
            "pico://settings/providers/account",
            "pico://settings/providers/credential-status",
            "pico://settings/providers/credential-source",
            "pico://settings/diagnostics/engine-version",
        ]
    )
    func invalidLinksAreRejected(link: String) throws {
        #expect(throws: SettingsLinkError.self) {
            try SettingsLink.location(from: Self.url(link))
        }
    }

    @Test(
        "item slugs are lowercase, kebab-case, and unique within their destination",
        arguments: SettingsDestination.allCases
    )
    func slugsAreWellFormed(destination: SettingsDestination) {
        let slugs = destination.items.map(\.slug)

        #expect(Set(slugs).count == slugs.count)
        for slug in slugs {
            let words = slug.split(separator: "-", omittingEmptySubsequences: false)
            let isKebabCase = words.allSatisfy { word in
                !word.isEmpty
                    && word.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) }
            }
            #expect(isKebabCase, "\(slug)")
        }
    }

    private static func url(_ string: String) throws -> URL {
        try #require(URL(string: string))
    }
}
