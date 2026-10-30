import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// THE SEAM
//
// This protocol is the entire contract between the prototype's UI and the outside
// world. Nothing above it knows whether data came from a fixture array, CloudKit,
// SwiftData, or a REST call.
//
// Going to production means: write one new type that conforms to this protocol,
// inject it instead of the mock, and delete the Mock* files. No view changes.
// If a view ever reaches around this protocol, the seam is broken — fix the view.
// ─────────────────────────────────────────────────────────────────────────────

@MainActor
protocol NotesBackend: AnyObject {
    func notes() async throws -> [Note]
    func setPinned(_ isPinned: Bool, for id: Note.ID) async throws
}

/// Which situation the mock should reproduce. Real backends ignore this entirely —
/// it exists so every state in the design can be seen on demand instead of only
/// the happy path that fixtures happen to produce.
enum MockCondition: String, CaseIterable, Identifiable {
    case populated
    case empty
    case slow
    case failing

    var id: String { rawValue }

    var label: String {
        switch self {
        case .populated: "Populated"
        case .empty: "Empty"
        case .slow: "Slow"
        case .failing: "Failing"
        }
    }
}

/// Forces every screen to have a designed answer for all four outcomes.
/// A prototype that only renders `.loaded` is an unfinished design.
enum LoadPhase<Value> {
    case loading
    case empty
    case loaded(Value)
    case failed(String)
}

struct BackendError: LocalizedError {
    let errorDescription: String?

    static var offline: BackendError {
        BackendError(errorDescription: "Can't reach your notes right now.")
    }
}
