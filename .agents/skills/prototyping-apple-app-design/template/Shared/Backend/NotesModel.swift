import Observation

/// View-facing state. Owns the backend behind the protocol so no view ever names a
/// concrete implementation, and holds the phase so every screen can render loading,
/// empty, failure, and content from one source.
@MainActor
@Observable
final class NotesModel {
    private(set) var phase: LoadPhase<[Note]> = .loading

    private let backend: any NotesBackend

    init(backend: any NotesBackend) {
        self.backend = backend
    }

    func load() async {
        phase = .loading
        do {
            let notes = try await backend.notes()
            phase = notes.isEmpty ? .empty : .loaded(sorted(notes))
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func togglePin(_ note: Note) async {
        guard case .loaded(var notes) = phase,
              let index = notes.firstIndex(where: { $0.id == note.id })
        else { return }

        // Optimistic update: prototypes should feel as immediate as the real app.
        notes[index].isPinned.toggle()
        phase = .loaded(sorted(notes))

        do {
            try await backend.setPinned(notes[index].isPinned, for: note.id)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func sorted(_ notes: [Note]) -> [Note] {
        notes.sorted { left, right in
            left.isPinned == right.isPinned
                ? left.updatedAt > right.updatedAt
                : left.isPinned
        }
    }
}

extension NotesModel {
    /// Convenience for `#Preview` blocks and the capture harness.
    static func preview(_ condition: MockCondition = .populated) -> NotesModel {
        NotesModel(backend: MockNotesBackend(condition: condition))
    }
}
