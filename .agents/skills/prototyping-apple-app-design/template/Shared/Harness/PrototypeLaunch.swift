import SwiftUI

/// Launch-time configuration for the prototype.
///
/// Every knob here exists so a screen can be rendered deterministically from a
/// script — `shoot.ts` drives these flags to capture screenshots. Running the app
/// with no flags opens the gallery, which is what a person gets from Xcode's Run.
enum PrototypeLaunch {
    private static let arguments = ProcessInfo.processInfo.arguments

    private static func value(for flag: String) -> String? {
        guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else {
            return nil
        }
        return arguments[index + 1]
    }

    /// Screen to open directly. Defaults to the gallery.
    static var screen: Screen {
        value(for: "-screen").flatMap(Screen.init(rawValue:)) ?? .gallery
    }

    /// Forces light or dark for appearance screenshots.
    static var colorScheme: ColorScheme? {
        switch value(for: "-appearance") {
        case "dark": .dark
        case "light": .light
        default: nil
        }
    }

    /// Forces a Dynamic Type size so accessibility layouts can be captured.
    static var dynamicTypeSize: DynamicTypeSize? {
        switch value(for: "-text-size") {
        case "xSmall": .xSmall
        case "large": .large
        case "xxxLarge": .xxxLarge
        case "accessibility1": .accessibility1
        case "accessibility3": .accessibility3
        case "accessibility5": .accessibility5
        default: nil
        }
    }

    /// Data condition the mock backend should simulate.
    static var condition: MockCondition {
        value(for: "-condition").flatMap(MockCondition.init(rawValue:)) ?? .populated
    }

    /// Which design direction to render.
    static var variant: Variant {
        value(for: "-variant").flatMap(Variant.init(rawValue:)) ?? .baseline
    }

    /// Path a capture script is watching for the readiness handshake (macOS only).
    static var readyFile: String? { value(for: "-ready") }

    /// True when the process was started by a capture script rather than a person.
    ///
    /// Always passed as `-capture 1`. Never introduce a valueless flag here: AppKit
    /// folds argv into the NSUserDefaults argument domain, where a flag with no value
    /// swallows the following argument, and the app then launches with a menu bar but
    /// no window at all — which looks exactly like a hung screenshot script.
    static var isCapturing: Bool { value(for: "-capture") == "1" }
}
