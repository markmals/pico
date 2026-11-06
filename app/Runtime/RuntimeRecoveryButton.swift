import SwiftUI

struct RuntimeRecoveryButton: View {
    let recovery: RuntimeReadiness.Recovery
    let request: (HomebrewAction) -> Void

    var body: some View {
        switch recovery {
        case .installHomebrew:
            Link(
                "Open Homebrew Installer",
                destination: URL(string: "https://github.com/Homebrew/brew/releases/latest")!
            )
        case .install:
            Button("Install Pico…") { request(.install) }
        case .reinstall:
            Button("Reinstall Pico…") { request(.reinstall) }
        case .upgrade:
            Button("Update Pico…") { request(.upgrade) }
        case .trustTap:
            Button("Trust markmals/tap…") { request(.trustTap) }
        }
    }
}
