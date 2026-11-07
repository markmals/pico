import SwiftUI

struct RuntimeSection: View {
    @Environment(RuntimeReadiness.self) private var runtime
    @State private var isConfirming = false
    @State private var pendingAction: HomebrewAction?

    var body: some View {
        Section {
            RuntimeInstallationRow(state: runtime.installation) {
                recoveryButton(for: .installed)
            }
            RuntimeStartupRow(state: runtime.startup) {
                recoveryButton(for: .starts)
            }
            RuntimeUpdatesRow(state: runtime.updates) {
                recoveryButton(for: .upToDate)
            }
            if let message = runtime.actionFailure {
                VStack(alignment: .leading, spacing: 6) {
                    Label("The Homebrew action failed.", systemImage: "exclamationmark.triangle")
                    CommandErrorDetails(message: message)
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Homebrew action")
            }
            HStack {
                Button("Check Runtime") { runtime.check() }
                Button("Check for Updates") { runtime.checkForUpdates() }
                Spacer()
            }
            .disabled(runtime.isBusy)
            if let activity = runtime.activity {
                HStack {
                    RuntimeActivityStatus(activity: activity)
                        .controlSize(.small)
                    Spacer()
                    switch activity {
                    case .checking, .checkingUpdates:
                        Button("Cancel") { runtime.cancel() }
                    case .running, .stopping:
                        EmptyView()
                    }
                }
            }
        } header: {
            Text("Runtime")
        } footer: {
            Text(
                "Command startup checks Pico, not provider sign-in or a model turn. Homebrew is refreshed only when you check for updates."
            )
        }
        .confirmationDialog(
            Text(pendingAction?.confirmationTitle ?? "Confirm Action"),
            isPresented: $isConfirming,
            presenting: pendingAction
        ) { action in
            Button(action.title) { runtime.perform(action) }
            Button("Cancel", role: .cancel) {}
        } message: { action in
            Text(action.confirmation)
        }
    }

    @ViewBuilder
    private func recoveryButton(for item: SettingsItem) -> some View {
        if recoveryItem == item, let recovery = runtime.recovery {
            RuntimeRecoveryButton(recovery: recovery) { action in
                pendingAction = action
                isConfirming = true
            }
            .disabled(runtime.isBusy)
        }
    }

    private var recoveryItem: SettingsItem? {
        switch runtime.recovery {
        case .install:
            .installed
        case .reinstall:
            if case .missing = runtime.installation { .installed } else { .starts }
        case .installHomebrew:
            if case .missing = runtime.installation { .installed } else { .upToDate }
        case .upgrade, .trustTap:
            .upToDate
        case nil:
            nil
        }
    }
}
