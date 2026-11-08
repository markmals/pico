import Foundation
import Testing

@testable import Pico

@Suite("Pico settings command documents")
struct PicoSettingsReadTests {
    @Test("a missing file preserves the difference between saved and effective defaults")
    func missingFile() throws {
        let document = try decode(
            #"{"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"missing","revision":"none","item":{"defaultModel":null,"defaultThinking":null,"autoBackground":null,"providerCredentials":{}},"effective":{"defaultModel":"provider/model","defaultThinking":"high","source":"built-in","available":true,"autoBackground":true}}"#
        )
        guard case .ready(let path, let revision, let item, let effective) = document else {
            Issue.record("A missing settings file is usable, not a failure")
            return
        }
        #expect(path == "/tmp/Pico/settings.json")
        #expect(revision == "none")
        #expect(item.defaultModel == nil)
        #expect(effective.defaultModel == "provider/model")
    }

    @Test(
        "an invalid settings document retains its path and problem without becoming empty defaults",
        arguments: ["invalid", "unsupported"]
    )
    func invalidFile(status: String) throws {
        let document = try decode(
            """
            {"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"\(status)","revision":"sha256:abc","item":null,"effective":null,"problem":"Cannot read this version"}
            """
        )
        #expect(
            document
                == .invalid(
                    .init(
                        settingsFile: "/tmp/Pico/settings.json",
                        message: "Cannot read this version"
                    )
                )
        )
    }

    @Test(
        "a saved intellisense location is read, and a file without one is left to discovery",
        arguments: [
            (
                #""intellisensePath":"/Users/mark/.cargo/bin/intellisense","#,
                "/Users/mark/.cargo/bin/intellisense"
            ),
            (#""intellisensePath":null,"#, nil),
            ("", nil),
        ] as [(String, String?)]
    )
    func intellisenseLocation(member: String, path: String?) throws {
        let document = try decode(
            """
            {"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"valid","revision":"sha256:abc","item":{\(member)"defaultModel":"provider/model","defaultThinking":"high"},"effective":{"defaultModel":"provider/model","defaultThinking":"high","source":"settings","available":true}}
            """
        )
        guard case .ready(_, _, let item, _) = document else {
            Issue.record("A valid settings file is readable")
            return
        }
        #expect(item.intellisensePath == path)
    }

    @Test("a valid-status response missing its item is rejected")
    func incompleteValidDocument() {
        #expect(throws: (any Error).self) {
            try decode(
                #"{"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"valid","revision":"sha256:abc","item":null,"effective":null}"#
            )
        }
    }

    @Test("an unknown status does not silently become a missing settings file")
    func unknownStatus() {
        #expect(throws: (any Error).self) {
            try decode(
                #"{"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"future","revision":"none"}"#
            )
        }
    }

    @Test("a preview receipt cannot be shown as a completed save")
    func dryRunReceipt() {
        let json =
            #"{"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","dryRun":true,"changed":true,"after":{"revision":"after","item":{"defaultModel":"provider/model","defaultThinking":"off"}}}"#
        #expect(throws: (any Error).self) {
            try JSONDecoder().decode(PicoSettingsReceipt.self, from: Data(json.utf8))
        }
    }

    private func decode(_ json: String) throws -> PicoSettingsRead {
        try JSONDecoder().decode(PicoSettingsRead.self, from: Data(json.utf8))
    }
}
