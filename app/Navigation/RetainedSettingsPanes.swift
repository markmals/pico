import SwiftUI

struct RetainedSettingsPanes: View {
    let selection: SettingsDestination

    var body: some View {
        ZStack {
            ForEach(SettingsDestination.allCases) { destination in
                SettingsPane(destination: destination)
                    .opacity(selection == destination ? 1 : 0)
                    .allowsHitTesting(selection == destination)
                    .disabled(selection != destination)
                    .accessibilityHidden(selection != destination)
                    .zIndex(selection == destination ? 1 : 0)
            }
        }
    }
}
