import Foundation

// Domain models are plain values with no SwiftUI or persistence types in them.
// They survive the move to production unchanged, which is the point of keeping
// them separate from both the mock backend and the views.
//
// REPLACE THIS with the domain of the app being prototyped.

struct Note: Identifiable, Hashable, Sendable {
    let id: UUID
    var title: String
    var summary: String
    var updatedAt: Date
    var isPinned: Bool

    init(
        id: UUID = UUID(),
        title: String,
        summary: String,
        updatedAt: Date,
        isPinned: Bool = false
    ) {
        self.id = id
        self.title = title
        self.summary = summary
        self.updatedAt = updatedAt
        self.isPinned = isPinned
    }
}

extension Note {
    /// Fixtures read like real content, because lorem ipsum hides layout problems
    /// that only show up with realistic title lengths and dates.
    ///
    /// Offsets are relative to now so relative-date formatting keeps reading
    /// naturally instead of drifting into "last year" as the fixtures age.
    static var fixtures: [Note] {
        let now = Date.now
        return [
            Note(
                title: "Roasting notes — Ethiopia Guji",
                summary: "Pulled 18g in, 42g out, 27s. Still sharp on the finish; grind one step finer tomorrow.",
                updatedAt: now.addingTimeInterval(-1_800),
                isPinned: true
            ),
            Note(
                title: "Questions for the vet",
                summary: "Limping on the back left leg after long walks. Ask whether the joint supplement is still worth it.",
                updatedAt: now.addingTimeInterval(-86_400)
            ),
            Note(
                title: "Kitchen shelf measurements",
                summary: "Alcove is 82cm wide, 34cm deep. Brackets need to clear the pipe at 51cm from the left.",
                updatedAt: now.addingTimeInterval(-3 * 86_400)
            ),
            Note(
                title: "Books to find secondhand",
                summary: "Piranesi, The Dispossessed, A Pattern Language, anything by Le Guin I haven't read yet.",
                updatedAt: now.addingTimeInterval(-9 * 86_400)
            )
        ]
    }
}
