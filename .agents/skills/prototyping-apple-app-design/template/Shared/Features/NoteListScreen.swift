import SwiftUI

/// Reference screen for the house style: system components, every phase designed,
/// and a preview per state. Replace it with the real design; keep the shape.
struct NoteListScreen: View {
    @Environment(NotesModel.self) private var model

    var body: some View {
        NavigationStack {
            phaseContent
                .navigationTitle("Notes")
                .toolbar {
                    ToolbarItem {
                        Button("New Note", systemImage: "square.and.pencil") {}
                    }
                }
        }
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch model.phase {
        case .loading:
            loadingList
        case .empty:
            ContentUnavailableView(
                "No Notes",
                systemImage: "note.text",
                description: Text("Notes you write will appear here.")
            )
        case .failed(let message):
            ContentUnavailableView {
                Label("Can't Load Notes", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") { Task { await model.load() } }
                    .buttonStyle(.borderedProminent)
            }
        case .loaded(let notes):
            List(notes) { note in
                NavigationLink {
                    NoteDetailScreen(note: note)
                } label: {
                    NoteRow(note: note)
                }
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button {
                        Task { await model.togglePin(note) }
                    } label: {
                        Label(
                            note.isPinned ? "Unpin" : "Pin",
                            systemImage: note.isPinned ? "pin.slash" : "pin"
                        )
                    }
                    .tint(.orange)
                }
            }
        }
    }

    /// A redacted copy of the real rows reads as "this is arriving" far better than a
    /// centred spinner, and it proves the loaded layout doesn't jump on arrival.
    private var loadingList: some View {
        List(Note.fixtures) { note in
            NoteRow(note: note)
        }
        .redacted(reason: .placeholder)
        .allowsHitTesting(false)
    }
}

private struct NoteRow: View {
    let note: Note

    var body: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            HStack(spacing: Design.Space.snug) {
                if note.isPinned {
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                        .accessibilityLabel("Pinned")
                }
                Text(note.title)
                    .font(.headline)
                    .lineLimit(1)
            }

            Text(note.summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            Text(note.updatedAt, format: .relative(presentation: .named))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, Design.Space.hairline)
    }
}

#Preview("Populated") {
    NoteListScreen().prototypePreview()
}

#Preview("Empty") {
    NoteListScreen().prototypePreview(.empty)
}

#Preview("Loading") {
    NoteListScreen().prototypePreview(.slow)
}

#Preview("Failed") {
    NoteListScreen().prototypePreview(.failing)
}

#Preview("Dark") {
    NoteListScreen().prototypePreview().preferredColorScheme(.dark)
}

#Preview("Accessibility Text") {
    NoteListScreen().prototypePreview().dynamicTypeSize(.accessibility3)
}
