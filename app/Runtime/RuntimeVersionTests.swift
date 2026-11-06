import Foundation
import Testing

@testable import Pico

@Suite("runtime version")
struct RuntimeVersionTests {
    @Test("a release orders by number, not by text")
    func ordersByNumber() throws {
        let earlier = try #require(RuntimeVersion("0.1.9"))
        let later = try #require(RuntimeVersion("0.1.10"))

        #expect(earlier < later)
        #expect(later > earlier)
    }

    @Test("the same version is neither ahead nor behind")
    func ordersEqualVersions() throws {
        let one = try #require(RuntimeVersion("1.2.3"))
        let other = try #require(RuntimeVersion("1.2.3"))

        #expect(one == other)
        #expect(!(one < other))
        #expect(!(other < one))
    }

    @Test("a prerelease comes before the release it leads to")
    func ordersAPrerelease() throws {
        let prerelease = try #require(RuntimeVersion("0.2.0-beta.1"))
        let release = try #require(RuntimeVersion("0.2.0"))

        #expect(prerelease < release)
    }

    @Test(
        "prerelease identifiers follow numeric and lexical precedence",
        arguments: [
            ("0.2.0-rc.2", "0.2.0-rc.10"),
            ("0.2.0-alpha.9", "0.2.0-alpha.beta"),
            ("0.2.0-alpha", "0.2.0-alpha.1"),
            ("0.2.0-beta10", "0.2.0-beta2"),
        ]
    )
    func ordersPrereleaseIdentifiers(earlier: String, later: String) throws {
        #expect(try #require(RuntimeVersion(earlier)) < #require(RuntimeVersion(later)))
    }

    @Test("build metadata alone does not make a development command newer")
    func ignoresBuildMetadata() throws {
        #expect(
            try #require(RuntimeVersion("0.2.0+build.12"))
                == #require(RuntimeVersion("0.2.0+build.13"))
        )
    }

    @Test("Homebrew's revision suffix is read as a later package of the same version")
    func ordersARevision() throws {
        let plain = try #require(RuntimeVersion("0.1.0"))
        let revised = try #require(RuntimeVersion("0.1.0_1"))

        #expect(plain < revised)
    }

    @Test("a shorter version is read as it is written")
    func readsAShortVersion() throws {
        let short = try #require(RuntimeVersion("1.2"))
        let long = try #require(RuntimeVersion("1.2.1"))

        #expect(short < long)
    }

    @Test("text that is not a version has no order to report")
    func refusesTextThatIsNotAVersion() {
        #expect(RuntimeVersion("") == nil)
        #expect(RuntimeVersion("HEAD") == nil)
        #expect(RuntimeVersion("the latest") == nil)
    }
}
