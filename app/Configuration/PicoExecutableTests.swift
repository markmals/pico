import Darwin
import Foundation
import Testing

@testable import Pico

@Suite("pico executable")
struct PicoExecutableTests {
    @Test("an explicit override is the executable, on its own")
    func usesTheOverride() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let override = try directory.script("my-pico", "exit 0")
        let candidate = try directory.script("pico", "exit 0")
        let resolved = try PicoExecutable.resolve(
            override: override.path,
            candidates: [candidate.path]
        )
        #expect(resolved.path == override.path)
    }

    @Test("an override that is not there is refused instead of falling back")
    func refusesAnOverrideThatIsNotThere() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let override = directory.file("my-pico")
        let candidate = try directory.script("pico", "exit 0")
        let failure = #expect(throws: PicoCommandError.self) {
            try PicoExecutable.resolve(override: override.path, candidates: [candidate.path])
        }
        #expect(failure?.message.contains(override.path) == true)
        #expect(failure?.message.contains(candidate.path) == false)
    }

    @Test("an override that cannot be run is refused instead of falling back")
    func refusesAnOverrideThatCannotBeRun() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let override = try directory.text("my-pico", "#!/bin/sh\nexit 0\n")
        let candidate = try directory.script("pico", "exit 0")
        let failure = #expect(throws: PicoCommandError.self) {
            try PicoExecutable.resolve(override: override.path, candidates: [candidate.path])
        }
        #expect(failure?.message.contains(override.path) == true)
    }

    @Test("a directory is not an executable")
    func refusesADirectoryOverride() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let failure = #expect(throws: PicoCommandError.self) {
            try PicoExecutable.resolve(override: directory.url.path, candidates: [])
        }
        #expect(failure?.message.contains(directory.url.path) == true)
    }

    @Test("an explicit empty path is refused instead of selecting another executable")
    func refusesAnEmptyOverride() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let candidate = try directory.script("pico", "exit 0")
        #expect(throws: PicoCommandError.self) {
            try PicoExecutable.resolve(override: "", candidates: [candidate.path])
        }
    }

    @Test("whitespace in an executable filename is not trimmed")
    func preservesTheExactPath() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let executable = try directory.script("pico ", "exit 0")
        let resolved = try PicoExecutable.resolve(override: executable.path, candidates: [])
        #expect(resolved.path == executable.path)
    }

    @Test("an executable FIFO is not a command file")
    func refusesAFIFO() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let fifo = directory.file("pico")
        try #require(mkfifo(fifo.path, 0o755) == 0)
        #expect(throws: PicoCommandError.self) {
            try PicoExecutable.resolve(override: fifo.path, candidates: [])
        }
    }

    @Test("the first candidate that can be run is the executable")
    func usesTheFirstCandidateThatCanBeRun() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let missing = directory.file("missing-pico")
        let unrunnable = try directory.text("plain-pico", "not executable")
        let installed = try directory.script("pico", "exit 0")
        let later = try directory.script("later-pico", "exit 0")
        let resolved = try PicoExecutable.resolve(
            override: nil,
            candidates: [missing.path, unrunnable.path, installed.path, later.path]
        )
        #expect(resolved.path == installed.path)
    }

    @Test("a candidate that is a link to an executable counts, as Homebrew installs it")
    func followsALinkedCandidate() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let installed = try directory.script("pico-real", "exit 0")
        let link = directory.file("pico")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: installed)
        let resolved = try PicoExecutable.resolve(override: nil, candidates: [link.path])
        #expect(resolved.path == link.path)
    }

    @Test("a link to nothing is not an executable")
    func refusesABrokenLink() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let link = directory.file("pico")
        try FileManager.default.createSymbolicLink(
            at: link,
            withDestinationURL: directory.file("gone")
        )
        #expect(throws: PicoCommandError.self) {
            try PicoExecutable.resolve(override: nil, candidates: [link.path])
        }
    }

    @Test("with nothing installed, the error says where Pico looked and how to install it")
    func reportsWhereItLooked() throws {
        let failure = #expect(throws: PicoCommandError.self) {
            try PicoExecutable.resolve(
                override: nil,
                candidates: ["/opt/nowhere/bin/pico", "/usr/nowhere/bin/pico"]
            )
        }
        let message = try #require(failure?.message)
        #expect(message.contains("/opt/nowhere/bin/pico"))
        #expect(message.contains("/usr/nowhere/bin/pico"))
        #expect(message.contains("Homebrew"))
    }
}
