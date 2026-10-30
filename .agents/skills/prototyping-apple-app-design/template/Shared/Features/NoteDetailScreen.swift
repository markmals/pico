import SwiftUI

struct NoteDetailScreen: View {
    let note: Note

    @Environment(NotesModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Design.Space.roomy) {
                Text(note.summary)
                    .font(.body)

                Divider()

                LabeledContent("Last edited") {
                    Text(note.updatedAt, format: .dateTime.weekday(.wide).hour().minute())
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Design.Space.roomy)
        }
        .navigationTitle(note.title)
        #if os(iOS) || os(visionOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem {
                Button {
                    Task { await model.togglePin(note) }
                } label: {
                    Label(
                        note.isPinned ? "Unpin" : "Pin",
                        systemImage: note.isPinned ? "pin.fill" : "pin"
                    )
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        NoteDetailScreen(note: Note.fixtures[0])
    }
    .prototypePreview()
}

#Preview("Long Title") {
    NavigationStack {
        NoteDetailScreen(note: Note.fixtures[3])
    }
    .prototypePreview()
    .dynamicTypeSize(.accessibility3)
}
