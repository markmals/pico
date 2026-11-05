import Foundation

extension PicoModel.ThinkingChoice {
    var displayName: LocalizedStringResource {
        Self.displayName(for: value) ?? "\(name)"
    }

    static func displayName(for value: String) -> LocalizedStringResource? {
        switch value {
        case "off": "Off"
        case "auto": "Auto"
        case "minimal": "Minimal"
        case "low": "Low"
        case "medium": "Medium"
        case "high": "High"
        case "xhigh": "Extra High"
        case "max": "Maximum"
        default: nil
        }
    }
}
