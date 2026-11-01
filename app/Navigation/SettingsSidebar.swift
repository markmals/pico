import SwiftUI

/// The fixed sidebar: a search field above either the pane list or, while searching, the
/// search results.
struct SettingsSidebar: View {
    @Bindable var navigator: SettingsNavigator

    @State private var query = ""
    @State private var results: [SettingsLocation]?

    var body: some View {
        VStack {
            if let results {
                SearchResultsList(results: results, selection: $navigator.searchSelection)
            } else {
                DestinationList(selection: $navigator.selectedDestination)
            }
        }
        .searchable(text: $query, placement: .sidebar, prompt: Text("Search"))
        .onChange(of: query) { _, query in
            results = SettingsSearch.results(for: query)
        }
        .toolbar(removing: .sidebarToggle)
    }
}
