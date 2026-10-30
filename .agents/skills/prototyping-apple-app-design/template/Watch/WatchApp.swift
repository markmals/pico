import SwiftUI

@main
struct PrototypeWatchApp: App {
    var body: some Scene {
        WindowGroup {
            WatchRoot()
        }
    }
}

struct WatchRoot: View {
    var body: some View {
        NavigationStack {
            List(Note.fixtures) { note in
                VStack(alignment: .leading) {
                    Text(note.title).font(.headline).lineLimit(2)
                    Text(note.updatedAt, format: .relative(presentation: .named))
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Notes")
        }
    }
}

#Preview { WatchRoot() }
