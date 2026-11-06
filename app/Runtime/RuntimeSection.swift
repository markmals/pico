import SwiftUI

struct RuntimeSection: View {
    @Environment(RuntimeReadiness.self) private var runtime
    @State private var isConfirming = false
    @State private var pendingAction: HomebrewAction?

    var body: some View {
        Section {
            RuntimeInstallationRow(state: runtime.installation)
            RuntimeStartupRow(state: runtime.startup)
            RuntimeUpdatesRow(state: runtime.updates)
            if let message = runtime.actionFailure {
                Text(verbatim: message)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Button("Retry") { runtime.check() }
                Button("Check for Updates") { runtime.checkForUpdates() }
                Spacer()
            }
            .disabled(runtime.isBusy)
            if let recovery = runtime.recovery {
                RuntimeRecoveryButton(recovery: recovery) { action in
                    pendingAction = action
                    isConfirming = true
                }
                .disabled(runtime.isBusy)
            }
            if let activity = runtime.activity {
                RuntimeActivityStatus(activity: activity)
                    .controlSize(.small)
            }
        } header: {
            Text("Runtime")
        } footer: {
            Text(
                "Starts checks the command, not provider sign-in or a model turn. Update checks refresh Homebrew only when requested."
            )
        }
        .confirmationDialog(
            "Change Pico's Installation?",
            isPresented: $isConfirming,
            presenting: pendingAction
        ) { action in
            Button(action.title) { runtime.perform(action) }
            Button("Cancel", role: .cancel) {}
        } message: { action in
            Text(action.confirmation)
        }
    }
}
