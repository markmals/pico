import Foundation
import Testing

@testable import Pico

@Suite("Built-in tool policy search")
struct ToolPolicySearchTests {
    @Test(
        "the plan and background-job tools are reachable from search",
        arguments: [
            ("todo", "task-list"), ("plan", "task-list"),
            ("wait", "wait"), ("background jobs", "wait"),
        ]
    )
    func findsOperationalTools(query: String, slug: String) {
        let expected = SettingsItem(.tools, slug, title: "Unused test title")
        #expect(SettingsSearch.results(for: query)?.contains(.item(expected)) == true)
    }
}
