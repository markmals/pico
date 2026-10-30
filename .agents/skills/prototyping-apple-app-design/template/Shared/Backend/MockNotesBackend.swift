import Foundation

/// In-memory stand-in for the real service. Deleted at production time.
///
/// It deliberately behaves badly on request: latency and failures are part of the
/// design surface, not accidents to be discovered after the app ships.
@MainActor
final class MockNotesBackend: NotesBackend {
    var condition: MockCondition
    private var storage: [Note]

    init(condition: MockCondition = .populated, notes: [Note] = Note.fixtures) {
        self.condition = condition
        self.storage = notes
    }

    func notes() async throws -> [Note] {
        try await simulateWork()
        return condition == .empty ? [] : storage
    }

    func setPinned(_ isPinned: Bool, for id: Note.ID) async throws {
        try await simulateWork()
        guard let index = storage.firstIndex(where: { $0.id == id }) else { return }
        storage[index].isPinned = isPinned
    }

    private func simulateWork() async throws {
        switch condition {
        case .populated, .empty:
            try? await Task.sleep(for: .milliseconds(120))
        case .slow:
            try? await Task.sleep(for: .seconds(2.5))
        case .failing:
            try? await Task.sleep(for: .milliseconds(400))
            throw BackendError.offline
        }
    }
}
