import Foundation

extension HomebrewAction {
    var confirmationTitle: LocalizedStringResource {
        switch self {
        case .install: "Install Pico?"
        case .reinstall: "Reinstall Pico?"
        case .upgrade: "Update Pico?"
        case .trustTap: "Trust markmals/tap?"
        }
    }

    var progressTitle: LocalizedStringResource {
        switch self {
        case .install: "Installing Pico…"
        case .reinstall: "Reinstalling Pico…"
        case .upgrade: "Updating Pico…"
        case .trustTap: "Trusting markmals/tap…"
        }
    }

    var confirmation: LocalizedStringResource {
        switch self {
        case .install:
            "Homebrew will install markmals/tap/pico on this Mac. Keep Pico open until it finishes; closing Pico stops Homebrew. Pico checks the installed command afterward."
        case .reinstall:
            "Homebrew will reinstall markmals/tap/pico on this Mac. Stop sessions using this installation, and do not start another until it finishes. Keep Pico open until then; closing Pico stops Homebrew. Pico checks the command afterward."
        case .upgrade:
            "Homebrew will update markmals/tap/pico on this Mac. Automatic cleanup stays disabled so older installed versions remain available to running sessions. Keep Pico open until it finishes; closing Pico stops Homebrew."
        case .trustTap:
            "This lets Homebrew run formula code from markmals/tap on this Mac. Trust applies to the entire tap, not just Pico. Keep Pico open until Homebrew finishes; closing Pico stops it. Installing Pico still requires a separate confirmation."
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
