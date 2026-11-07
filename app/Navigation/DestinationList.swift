import SwiftUI

/// The sidebar's panes, in System Settings-style groups.
struct DestinationList: View {
    @Binding var selection: SettingsDestination

    var body: some View {
        List(selection: $selection) {
            ForEach(SettingsDestination.sidebarGroups, id: \.self) { group in
                Section {
                    ForEach(group) { destination in
                        DestinationRow(destination: destination)
                    }
                }
            }
        }
    }
}

private struct DestinationRow: View {
    let destination: SettingsDestination

    @Environment(ModelSettings.self) private var settings
    @Environment(\.sidebarRowSize) private var rowSize

    var body: some View {
        Label {
            Text(destination.title)
        } icon: {
            AppIconTile(destination: destination, size: rowSize.appIconTileSize)
        }
        .tag(destination)
        .badge(needsDefaultModel ? 1 : 0)
        .badgeProminence(.increased)
        .accessibilityValue(needsDefaultModel ? Text("Default model not set") : Text(""))
    }

    private var needsDefaultModel: Bool {
        destination == .models && settings.displayedDefaults.map { $0.defaultModel == nil } == true
    }
}
