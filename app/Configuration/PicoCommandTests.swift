import Darwin
import Foundation
import Testing

@testable import Pico

@Suite("pico command")
struct PicoCommandTests {
    @Test("a successful command returns the document it printed")
    func returnsTheDocumentOfASuccessfulCommand() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script("pico", #"printf '{"apiVersion":1,"items":["one"]}'"#)
        let output = try await PicoCommand(executable: pico).run(["models", "list"])
        #expect(String(decoding: output, as: UTF8.self) == #"{"apiVersion":1,"items":["one"]}"#)
    }

    @Test("the command reads no standard input")
    func closesStandardInput() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script(
            "pico",
            #"""
            input=$(cat)
            printf '{"apiVersion":1,"got":"%s"}' "$input"
            """#
        )
        let output = try await PicoCommand(executable: pico, timeout: 10).run(["settings", "get"])
        let got = try value(forKey: "got", in: output)
        #expect(got == "")
    }

    @Test("an unsupported API version on success is refused and names the executable")
    func refusesAnUnsupportedApiVersion() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script("pico", #"printf '{"apiVersion":2,"items":[]}'"#)
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: pico).run(["models", "list"])
        }
        #expect(failure?.code == nil)
        #expect(failure?.message.contains(pico.path) == true)
        #expect(failure?.message.contains("2") == true)
    }

    @Test("a document without an API version is refused")
    func refusesAMissingApiVersion() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script("pico", #"printf '{"items":[]}'"#)
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: pico).run(["models", "list"])
        }
        #expect(failure?.message.contains(pico.path) == true)
    }

    @Test("output that is not a document is reported, never read as an empty one")
    func refusesOutputThatIsNotADocument() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script("pico", "printf 'pico: not a document'")
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: pico).run(["models", "list"])
        }
        #expect(failure?.message.contains(pico.path) == true)
    }

    @Test("a command that succeeds without printing anything is reported")
    func refusesEmptyOutput() async throws {
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: URL(fileURLWithPath: "/usr/bin/true")).run(["x"])
        }
        #expect(failure?.message.contains("/usr/bin/true") == true)
    }

    @Test("the error document on the last line of standard error is reported as it is")
    func reportsTheReportedError() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script(
            "pico",
            #"""
            echo 'pico: chatter nobody should read as an error' >&2
            printf '%s\n' '{"apiVersion":1,"error":{"code":"NOT_FOUND","message":"No credential is selected for anthropic.","retryable":false,"details":{}}}' >&2
            printf '\n' >&2
            exit 1
            """#
        )
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: pico).run(["models", "list"])
        }
        #expect(failure?.code == "NOT_FOUND")
        #expect(failure?.message == "No credential is selected for anthropic.")
    }

    @Test("an error document with an unsupported API version is refused and names the executable")
    func refusesAnUnsupportedApiVersionInAnErrorDocument() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script(
            "pico",
            #"""
            printf '%s\n' '{"apiVersion":7,"error":{"code":"NOT_FOUND","message":"Nope."}}' >&2
            exit 1
            """#
        )
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: pico).run(["models", "list"])
        }
        #expect(failure?.code == nil)
        #expect(failure?.message.contains(pico.path) == true)
        #expect(failure?.message.contains("7") == true)
    }

    @Test("a failure without an error document reports what the command printed")
    func reportsStandardErrorWhenThereIsNoDocument() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script(
            "pico",
            """
            echo 'pico: the engine stopped unexpectedly' >&2
            exit 3
            """
        )
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: pico).run(["models", "list"])
        }
        #expect(failure?.code == nil)
        #expect(failure?.message.contains("the engine stopped unexpectedly") == true)
        #expect(failure?.message.contains(pico.path) == true)
    }

    @Test("a failure that prints nothing reports its exit status")
    func reportsTheExitStatusWhenNothingIsPrinted() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script("pico", "exit 7")
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: pico).run(["models", "list"])
        }
        #expect(failure?.message.contains("7") == true)
        #expect(failure?.message.contains(pico.path) == true)
    }

    @Test("output far larger than a pipe's buffer on both streams finishes")
    func readsLargeOutputFromBothStreams() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let document = #"{"apiVersion":1,"pad":"\#(String(repeating: "x", count: 400_000))"}"#
        let documentFile = try directory.text("document.json", document)
        let noiseFile = try directory.text("noise.txt", String(repeating: "e", count: 400_000))
        let pico = try directory.script(
            "pico",
            """
            cat "\(noiseFile.path)" >&2
            cat "\(documentFile.path)"
            """
        )
        let output = try await PicoCommand(executable: pico, timeout: 20).run(["models", "list"])
        #expect(output.count == document.utf8.count)
        #expect(String(decoding: output, as: UTF8.self) == document)
    }

    @Test("a command that outlives its timeout is stopped and reported")
    func stopsACommandThatRunsPastItsTimeout() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let identifierFile = directory.file("identifier")
        let pico = try directory.script(
            "pico",
            """
            echo $$ > "\(identifierFile.path)"
            exec sleep 30
            """
        )
        let clock = ContinuousClock()
        let started = clock.now
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: pico, timeout: 0.3).run(["models", "list"])
        }
        #expect(clock.now - started < .seconds(10))
        #expect(failure?.message.contains(pico.path) == true)
        let recorded = await recordedProcessIdentifier(at: identifierFile)
        let identifier = try #require(recorded)
        let stopped = await hasStopped(identifier)
        #expect(stopped)
    }

    @Test("cancelling the task stops the command")
    func cancellationStopsTheCommand() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let identifierFile = directory.file("identifier")
        let pico = try directory.script(
            "pico",
            """
            echo $$ > "\(identifierFile.path)"
            exec sleep 30
            """
        )
        let command = PicoCommand(executable: pico, timeout: 60)
        let running = Task { try await command.run(["models", "list"]) }
        let recorded = await recordedProcessIdentifier(at: identifierFile)
        let identifier = try #require(recorded)
        running.cancel()
        await #expect(throws: CancellationError.self) { try await running.value }
        let stopped = await hasStopped(identifier)
        #expect(stopped)
    }

    @Test("a command whose own child keeps the pipe open still finishes at once")
    func finishesWhileAChildOfTheCommandHoldsThePipe() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let identifierFile = directory.file("child-identifier")
        defer {
            if let text = try? String(contentsOf: identifierFile, encoding: .utf8),
                let identifier = pid_t(text.trimmingCharacters(in: .whitespacesAndNewlines))
            {
                kill(identifier, SIGKILL)
            }
        }
        let pico = try directory.script(
            "pico",
            """
            sleep 20 &
            echo $! > "\(identifierFile.path)"
            printf '{"apiVersion":1,"items":[]}'
            exit 0
            """
        )
        let clock = ContinuousClock()
        let started = clock.now
        let output = try await PicoCommand(executable: pico, timeout: 60).run(["models", "list"])
        #expect(clock.now - started < .seconds(10))
        #expect(String(decoding: output, as: UTF8.self) == #"{"apiVersion":1,"items":[]}"#)
    }

    @Test("an executable that cannot be started is reported")
    func reportsACommandThatCannotStart() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let missing = directory.file("pico")
        let failure = await #expect(throws: PicoCommandError.self) {
            try await PicoCommand(executable: missing).run(["models", "list"])
        }
        #expect(failure?.message.contains(missing.path) == true)
    }

    @Test("commands running at the same time keep their own output")
    func runsCommandsConcurrently() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script("pico", #"printf '{"apiVersion":1,"got":"%s"}' "$*""#)
        let command = PicoCommand(executable: pico, timeout: 20)
        async let settings = command.run(["settings", "get"])
        async let models = command.run(["models", "list"])
        let outputs = try await (settings, models)
        let fromSettings = try value(forKey: "got", in: outputs.0)
        let fromModels = try value(forKey: "got", in: outputs.1)
        #expect(fromSettings == "settings get")
        #expect(fromModels == "models list")
    }

    private func value(forKey key: String, in output: Data) throws -> String {
        let document = try JSONSerialization.jsonObject(with: output) as? [String: Any]
        return try #require(document?[key] as? String)
    }
}

/// A directory of stand-ins for the `pico` executable. Tests make one, fill it with scripts
/// that answer the way one real command would, and remove it when they finish.
struct TemporaryTestDirectory {
    let url: URL

    init() throws {
        url = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("pico-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    /// The location of a file in this directory, whether or not anything is written there.
    func file(_ name: String) -> URL {
        url.appendingPathComponent(name, isDirectory: false)
    }

    func remove() {
        try? FileManager.default.removeItem(at: url)
    }

    /// An executable shell script named `name` that runs `body`.
    @discardableResult
    func script(_ name: String, _ body: String) throws -> URL {
        let script = file(name)
        try "#!/bin/sh\n\(body)\n".write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: script.path
        )
        return script
    }

    /// A file that is not executable, such as a payload a script prints.
    @discardableResult
    func text(_ name: String, _ contents: String) throws -> URL {
        let text = file(name)
        try contents.write(to: text, atomically: true, encoding: .utf8)
        return text
    }
}

/// Waits for a script to record its process id, so a test can watch that process afterwards.
func recordedProcessIdentifier(at url: URL) async -> pid_t? {
    for _ in 0..<500 {
        let recorded = try? String(contentsOf: url, encoding: .utf8)
        if let identifier = pid_t(recorded?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") {
            return identifier
        }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return nil
}

/// Waits for a process to stop existing, which is how a test tells that a command was really
/// stopped and reaped rather than left running.
func hasStopped(_ identifier: pid_t) async -> Bool {
    for _ in 0..<500 {
        if kill(identifier, 0) == -1 && errno == ESRCH { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return false
}
