import Testing

@testable import Pico

@Suite("Pico settings change arguments")
struct PicoSettingsChangeTests {
    @Test("a chosen intellisense location is sent exactly as it was chosen")
    func chosenIntellisenseLocation() {
        #expect(
            PicoSettingsChange.intellisensePath("/Users/mark/.cargo/bin/intellisense").arguments
                == ["--intellisense-path", "/Users/mark/.cargo/bin/intellisense"]
        )
    }

    @Test("returning to automatic discovery removes the saved location")
    func automaticIntellisenseLocation() {
        #expect(
            PicoSettingsChange.intellisensePath(nil).arguments == ["--intellisense-path", "auto"]
        )
    }
}
