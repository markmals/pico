import SwiftUI

struct ToolsPane: View {
    @Environment(IntellisenseStatus.self) private var intellisense
    @Environment(ModelSettings.self) private var settings

    var body: some View {
        Form {
            PaneHeader(destination: .tools)

            ToolPolicySection()

            Section {
                IntellisenseLocationRow(settings: settings, status: intellisense)
            } header: {
                Text("Integrations")
            } footer: {
                Text(
                    "New sessions run `intellisense` from this location. Pico finds it on `PATH` and in common install folders unless you choose one."
                )
            }
        }
        .formStyle(.grouped)
        .onChange(of: confirmedLocation) { _, location in
            guard let location else { return }
            intellisense.check(ifChangedTo: location)
        }
    }

    /// The saved location once Pico has read its settings, so a reload on its way to the same
    /// location is not seen as a change.
    private var confirmedLocation: String?? {
        settings.snapshot.map(\.item.intellisensePath)
    }
}
