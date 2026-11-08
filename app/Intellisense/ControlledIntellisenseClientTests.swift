import Foundation

@testable import Pico

/// A check whose answers are queued in advance and, while held, finish only when the test
/// releases them, so a test can order one check against another.
actor ControlledIntellisenseClient: IntellisenseChecking {
    private(set) var checkCount = 0

    private var answers: [Result<IntellisenseCheck, PicoCommandError>]
    private var isHolding = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    init(_ answers: [Result<IntellisenseCheck, PicoCommandError>]) {
        self.answers = answers
    }

    func check() async throws -> IntellisenseCheck {
        checkCount += 1
        let answer =
            answers.isEmpty
            ? .failure(PicoCommandError(message: "Unexpected check")) : answers.removeFirst()
        if isHolding {
            await withCheckedContinuation { waiting.append($0) }
        }
        return try answer.get()
    }

    func hold() {
        isHolding = true
    }

    func release() {
        isHolding = false
        let held = waiting
        waiting = []
        for continuation in held { continuation.resume() }
    }

    func waitForChecks(_ count: Int) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while checkCount < count {
            guard ContinuousClock.now < deadline else {
                throw PicoCommandError(message: "Check did not start")
            }
            try await Task.sleep(for: .milliseconds(5))
        }
    }
}
