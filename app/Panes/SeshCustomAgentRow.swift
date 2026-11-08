import AppKit
import SwiftUI

/// Sesh offers no supported way for another app to add an agent to it or to tell which agent
/// runs a given executable, so Pico registers nothing and reports no registration state: it
/// opens Sesh, where the user adds Pico with the steps the pane gives.
struct SeshCustomAgentRow: View {
    private static let seshBundleIdentifier = "codes.sesh.Sesh"

    /// Looked up again whenever Pico becomes active, so installing or removing Sesh while the
    /// pane is open shows the next time the user returns to Pico.
    @State private var sesh = Self.locateSesh()

    @State private var openFailure: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent {
                if let sesh {
                    Button("Open Sesh") { open(sesh) }
                        .fixedSize()
                } else {
                    RowStatus(text: "Sesh isn’t installed", needsAttention: true)
                }
            } label: {
                Text(SettingsItem.customAgent.displayTitle)
            }
            if let openFailure {
                CommandErrorDetails(message: openFailure)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SettingsItem.customAgent.plainTitle))
        .settingsRow(.customAgent)
        .onReceive(
            NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
        ) { _ in
            sesh = Self.locateSesh()
        }
    }

    private static func locateSesh() -> URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: seshBundleIdentifier)
    }

    private func open(_ sesh: URL) {
        openFailure = nil
        Task {
            do {
                _ = try await NSWorkspace.shared.openApplication(
                    at: sesh,
                    configuration: NSWorkspace.OpenConfiguration()
                )
            } catch {
                openFailure = String(
                    localized: "Pico couldn’t open Sesh: \(error.localizedDescription)"
                )
            }
        }
    }
}
