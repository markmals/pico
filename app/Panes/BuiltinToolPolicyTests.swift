import Foundation
import Testing

@testable import Pico

@Suite("Built-in tool policy coverage")
struct BuiltinToolPolicyTests {
    @Test("the displayed policy covers the engine's entire built-in roster exactly once")
    func coversEngineRoster() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let source = root.appendingPathComponent("adapter/engine/builtin-tools.json")
        let roster = try JSONDecoder().decode([String].self, from: Data(contentsOf: source))
        #expect(BuiltinToolPolicy.included.flatMap(\.tools).sorted() == roster.sorted())
    }
}
