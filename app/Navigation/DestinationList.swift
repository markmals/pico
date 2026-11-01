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

    var body: some View {
        Label {
            Text(destination.title)
        } icon: {
            AppIconTile(destination: destination, size: 20)
        }
        .tag(destination)
    }
}
