import Testing

@testable import Pico

@MainActor
@Suite("intellisense location status", .timeLimit(.minutes(1)))
struct IntellisenseStatusTests {
    @Test("a changed location is checked again and the answer for the old one is discarded")
    func rechecksAChangedLocation() async throws {
        let client = ControlledIntellisenseClient([
            .success(.missing(problem: "No intellisense executable in /usr/bin, /bin")),
            .success(.ready(path: "/Users/mark/.cargo/bin/intellisense", version: "0.2.0")),
        ])
        let status = IntellisenseStatus(client: client)
        await client.hold()
        let discovery = status.check(for: nil)
        try await client.waitForChecks(1)
        let chosen = status.check(for: "/Users/mark/.cargo/bin/intellisense")
        #expect(status.isChecking)
        await client.release()
        await discovery.value
        await chosen.value
        #expect(await client.checkCount == 2)
        #expect(
            status.outcome
                == .checked(.ready(path: "/Users/mark/.cargo/bin/intellisense", version: "0.2.0"))
        )
        #expect(!status.isChecking)
    }

    @Test("a check already running for the same location is joined rather than started again")
    func joinsARunningCheck() async throws {
        let client = ControlledIntellisenseClient([
            .success(.ready(path: "/usr/local/bin/intellisense", version: "0.1.0"))
        ])
        let status = IntellisenseStatus(client: client)
        await client.hold()
        let running = status.check(for: "/usr/local/bin/intellisense")
        try await client.waitForChecks(1)
        #expect(status.check(for: "/usr/local/bin/intellisense") == running)
        await client.release()
        await running.value
        #expect(await client.checkCount == 1)
    }

    @Test("checking the same location once it settles runs the command again")
    func checksAgainAfterSettling() async throws {
        let client = ControlledIntellisenseClient([
            .success(.ready(path: "/usr/local/bin/intellisense", version: "0.1.0")),
            .success(.ready(path: "/usr/local/bin/intellisense", version: "0.2.0")),
        ])
        let status = IntellisenseStatus(client: client)
        await status.check(for: nil).value
        await status.check(for: nil).value
        #expect(await client.checkCount == 2)
        #expect(
            status.outcome
                == .checked(.ready(path: "/usr/local/bin/intellisense", version: "0.2.0"))
        )
    }

    @Test("a check that fails reports its cause instead of a location")
    func reportsAFailure() async {
        let client = ControlledIntellisenseClient([
            .failure(PicoCommandError(message: "Pico couldn't find the pico command."))
        ])
        let status = IntellisenseStatus(client: client)
        await status.check(for: nil).value
        #expect(status.outcome == .failed("Pico couldn't find the pico command."))
        #expect(!status.isChecking)
    }

    @Test("cancelling a check keeps the location Pico last observed")
    func cancellationKeepsTheLastAnswer() async throws {
        let client = ControlledIntellisenseClient([
            .success(.ready(path: "/usr/local/bin/intellisense", version: "0.1.0")),
            .success(.ready(path: "/usr/local/bin/intellisense", version: "0.2.0")),
        ])
        let status = IntellisenseStatus(client: client)
        await status.check(for: nil).value
        await client.hold()
        let running = status.check(for: nil)
        try await client.waitForChecks(2)
        status.cancel()
        #expect(!status.isChecking)
        await client.release()
        await running.value
        #expect(
            status.outcome
                == .checked(.ready(path: "/usr/local/bin/intellisense", version: "0.1.0"))
        )
    }
}
