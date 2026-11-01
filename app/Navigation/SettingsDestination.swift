import Foundation

enum SettingsDestination: CaseIterable, Hashable {
    case general
    case providers
    case models
    case tools
    case sesh
    case diagnostics

    var symbol: String {
        switch self {
        case .general: "gearshape"
        case .providers: "person.crop.circle"
        case .models: "cube"
        case .tools: "wrench.and.screwdriver"
        case .sesh: "rectangle.connected.to.line.below"
        case .diagnostics: "info.circle"
        }
    }

    var title: LocalizedStringResource {
        switch self {
        case .general: "General"
        case .providers: "Providers & Accounts"
        case .models: "Models"
        case .tools: "Tools & Integrations"
        case .sesh: "Sesh"
        case .diagnostics: "Diagnostics & About"
        }
    }
}

extension SettingsDestination: Identifiable {
    var id: Self { self }
}
