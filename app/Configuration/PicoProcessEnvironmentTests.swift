import Foundation
import Testing

@testable import Pico

@Suite("Command launch environment")
struct PicoProcessEnvironmentTests {
    @Test("ordinary pico commands inherit the app's launch environment")
    func inheritsLaunchEnvironment() async throws {
        let home = try #require(ProcessInfo.processInfo.environment["HOME"])
        let outcome = try await PicoProcessRun(
            executable: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: [],
            timeout: 5
        ).run()
        let environment = String(decoding: outcome.standardOutput, as: UTF8.self)
            .split(separator: "\n")
        #expect(outcome.status == 0)
        #expect(environment.contains(Substring("HOME=\(home)")))
    }

    @Test("a package command's explicit environment excludes ambient variables")
    func replacesLaunchEnvironment() async throws {
        let outcome = try await PicoProcessRun(
            executable: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: [],
            environment: ["PICO_PROCESS_TEST": "isolated"],
            timeout: 5
        ).run()
        let environment = String(decoding: outcome.standardOutput, as: UTF8.self)
            .split(separator: "\n")
        #expect(environment.contains("PICO_PROCESS_TEST=isolated"))
        #expect(!environment.contains { $0.hasPrefix("HOME=") })
    }
}
