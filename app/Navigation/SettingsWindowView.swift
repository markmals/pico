import SwiftUI

struct SettingsWindowView: View {
    static let sceneID = "settings"

    @State private var selection = SettingsDestination.general

    var body: some View {
        NavigationSplitView {
            SettingsSidebar(selection: $selection)
                .navigationSplitViewColumnWidth(min: 220, ideal: 240, max: 320)
        } detail: {
            RetainedSettingsPanes(selection: selection)
                .navigationTitle(Text(selection.title))
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    ScaffoldNotice()
                }
        }
        .frame(minWidth: 760, minHeight: 520)
    }
}
