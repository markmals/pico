import SwiftUI

/// A settings pane. The raw value is the pane's slug in `pico://settings` links, so it must
/// not change when the pane's title does.
enum SettingsDestination: String, CaseIterable, Hashable {
    case general
    case providers
    case models
    case tools
    case sesh
    case diagnostics

    /// The sidebar's groups, separated by space and in order.
    static let sidebarGroups: [[SettingsDestination]] = [
        [.general],
        [.providers, .models],
        [.tools, .sesh],
        [.diagnostics],
    ]

    /// The pane's settings items, in the order its rows appear.
    var items: [SettingsItem] {
        switch self {
        case .general:
            [
                .installed, .starts, .upToDate, .settingsFile, .generalAppVersion,
                .generalPicoVersion, .generalOMPVersion,
            ]
        case .providers:
            [.providerList]
        case .models:
            [.model, .reasoningLevel, .availableModels]
        case .tools:
            BuiltinToolPolicy.included.map(\.item)
                + [.eval, .builtInLSP, .nativeDelegation, .intellisenseLocation]
        case .sesh:
            [.helperLocation, .launchArguments, .customAgent, .seshConnectionStatus, .setupStatus]
        case .diagnostics:
            [
                .diagnosticsAppVersion, .diagnosticsPicoVersion, .diagnosticsOMPVersion,
                .recentErrors, .diagnosticReport,
            ]
        }
    }

    var summary: LocalizedStringResource {
        switch self {
        case .general: "Check the Pico command and find its settings file."
        case .providers: "Provider accounts, and where their credentials come from."
        case .models: "The default model and reasoning level for new sessions."
        case .tools:
            "Pico’s built-in tool policy is fixed. Sesh supplies additional tools for each session."
        case .sesh: "How Sesh launches Pico as a custom agent."
        case .diagnostics: "Versions, recent errors, and reports for troubleshooting."
        }
    }

    var symbol: String {
        switch self {
        case .general: "gearshape.fill"
        case .providers: "person.crop.circle.fill"
        case .models: "cube.fill"
        case .tools: "wrench.and.screwdriver.fill"
        case .sesh: "rectangle.connected.to.line.below"
        case .diagnostics: "stethoscope"
        }
    }

    var tileColor: Color {
        switch self {
        case .general: .gray
        case .providers: .blue
        case .models: .purple
        case .tools: .orange
        case .sesh: .green
        case .diagnostics: .indigo
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
