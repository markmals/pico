import SwiftUI

/// Search results shown in place of the pane list, as System Settings does.
struct SearchResultsList: View {
    let results: [SettingsLocation]
    @Binding var selection: SettingsLocation?

    var body: some View {
        List(results, selection: $selection) { location in
            SearchResultRow(location: location)
                .tag(location)
        }
        .overlay {
            if results.isEmpty {
                Text("No Results")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct SearchResultRow: View {
    let location: SettingsLocation

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            AppIconTile(destination: location.destination, size: 20)
            VStack(alignment: .leading, spacing: 1) {
                switch location {
                case .destination(let destination):
                    Text(destination.title)
                case .item(let item):
                    Text(item.displayTitle)
                    Text(item.destination.title)
                        .foregroundStyle(.secondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}
