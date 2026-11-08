import SwiftUI

/// The app's, `pico`'s and its engine's versions. The app's comes from its own bundle; the
/// other two are what the last runtime check read from the command Pico runs.
struct InstalledVersionRows: View {
    @Environment(RuntimeReadiness.self) private var runtime
    let app: SettingsItem
    let pico: SettingsItem
    let omp: SettingsItem

    var body: some View {
        SettingsValueRow(item: app, value: Self.appVersion)
        SettingsValueRow(item: pico, value: value(of: \.pico))
        SettingsValueRow(item: omp, value: value(of: \.omp))
        if case .failed(let message) = runtime.versions {
            VStack(alignment: .leading, spacing: 6) {
                CautionLabel("Pico couldn’t read the installed versions.")
                CommandErrorDetails(message: message)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Installed versions")
        }
    }

    private static var appVersion: SettingsValue {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
        guard let version = version as? String, !version.isEmpty else {
            return .text("Not in the app bundle")
        }
        return .verbatim(version)
    }

    private func value(of component: KeyPath<InstalledVersions, String>) -> SettingsValue {
        switch runtime.versions {
        case .unknown: .text("Not checked")
        case .checking: .text("Checking…")
        case .read(let versions): .verbatim(versions[keyPath: component])
        case .failed: .text("Couldn’t read")
        }
    }
}
