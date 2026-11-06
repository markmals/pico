import Foundation

extension HomebrewAction {
    var confirmation: LocalizedStringResource {
        switch self {
        case .install:
            "Homebrew will install markmals/tap/pico on this Mac. Pico checks the installed command afterward."
        case .reinstall:
            "Homebrew will reinstall markmals/tap/pico on this Mac. Stop sessions using this installation, and do not start another until it finishes. Pico checks the command afterward."
        case .upgrade:
            "Homebrew will update markmals/tap/pico on this Mac. Automatic cleanup stays disabled so older installed versions remain available to running sessions."
        case .trustTap:
            "Trust markmals/tap to run its Homebrew formula code on this Mac? This grants trust to the tap, not just this installation. Checking readiness never grants trust automatically."
        }
    }

    var title: LocalizedStringResource {
        switch self {
        case .install: "Install Pico"
        case .reinstall: "Reinstall Pico"
        case .upgrade: "Update Pico"
        case .trustTap: "Trust markmals/tap"
        }
    }
}
