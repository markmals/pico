import SwiftUI

/// Every screen in the prototype, in one list.
///
/// This is the file to edit when adding a screen. Registering a case here is what
/// makes the screen reachable from the gallery *and* capturable by `shoot.ts`.
/// An unregistered screen is invisible to both.
enum Screen: String, CaseIterable, Identifiable {
    case gallery
    case noteList
    case noteDetail

    var id: String { rawValue }

    var title: String {
        switch self {
        case .gallery: "All Screens"
        case .noteList: "Notes"
        case .noteDetail: "Note Detail"
        }
    }

    /// Short description shown in the gallery so the list is navigable at a glance.
    var subtitle: String {
        switch self {
        case .gallery: "Index of every screen in this prototype"
        case .noteList: "Primary list with pinning and swipe actions"
        case .noteDetail: "Single note, reading-focused"
        }
    }

    /// Screens the gallery offers. The gallery never lists itself.
    static var browsable: [Screen] {
        allCases.filter { $0 != .gallery }
    }

    @MainActor
    @ViewBuilder
    var content: some View {
        switch self {
        case .gallery:
            GalleryScreen()
        case .noteList:
            NoteListScreen()
        case .noteDetail:
            NoteDetailScreen(note: Note.fixtures[0])
        }
    }
}
