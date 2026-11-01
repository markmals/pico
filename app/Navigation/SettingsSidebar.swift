import SwiftUI

struct SettingsSidebar: View {
    @Binding var selection: SettingsDestination

    var body: some View {
        List(SettingsDestination.allCases, selection: $selection) { destination in
            Label {
                Text(destination.title)
            } icon: {
                Image(systemName: destination.symbol)
            }
            .tag(destination)
        }
        .listStyle(.sidebar)
        .navigationTitle("Pico")
    }
}
