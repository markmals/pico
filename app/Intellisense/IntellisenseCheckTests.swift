import Foundation
import Testing

@testable import Pico

@Suite("intellisense check documents")
struct IntellisenseCheckTests {
    @Test("a ready location carries where the program runs from and the version it reported")
    func readyLocation() throws {
        let document = try decode(
            #"{"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"ready","source":"settings","path":"/Users/mark/.cargo/bin/intellisense","version":"intellisense 0.2.0"}"#
        )
        #expect(
            document
                == .ready(
                    path: "/Users/mark/.cargo/bin/intellisense",
                    version: "intellisense 0.2.0"
                )
        )
    }

    @Test("nothing found keeps what was searched rather than becoming a usable location")
    func missingLocation() throws {
        let document = try decode(
            #"{"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"missing","source":"discovered","path":null,"searched":["/usr/bin","/bin"],"problem":"No intellisense executable in /usr/bin, /bin"}"#
        )
        #expect(document == .missing(problem: "No intellisense executable in /usr/bin, /bin"))
    }

    @Test("an unusable location keeps the path that cannot be used and why")
    func unusableLocation() throws {
        let document = try decode(
            #"{"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"unusable","source":"settings","path":"/opt/homebrew/bin/intellisense","problem":"/opt/homebrew/bin/intellisense does not exist"}"#
        )
        #expect(
            document
                == .unusable(
                    path: "/opt/homebrew/bin/intellisense",
                    problem: "/opt/homebrew/bin/intellisense does not exist"
                )
        )
    }

    @Test("an unknown status is not read as a usable location")
    func unknownStatus() {
        #expect(throws: (any Error).self) {
            try decode(
                #"{"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"future","source":"settings","path":"/usr/local/bin/intellisense"}"#
            )
        }
    }

    @Test("a ready location without a path is not read as one Pico can run")
    func readyWithoutAPath() {
        #expect(throws: (any Error).self) {
            try decode(
                #"{"apiVersion":1,"settingsFile":"/tmp/Pico/settings.json","status":"ready","source":"discovered","path":null,"version":"intellisense 0.2.0"}"#
            )
        }
    }

    private func decode(_ json: String) throws -> IntellisenseCheck {
        try JSONDecoder().decode(IntellisenseCheck.self, from: Data(json.utf8))
    }
}
