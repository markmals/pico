import SwiftUI

/// Providers & Accounts: the provider list, or the page of the provider it opened.
struct ProvidersPane: View {
    @Environment(\.sampleSettings) private var sample
    @Environment(SettingsNavigator.self) private var navigator

    var body: some View {
        if let sample, let provider = openProvider {
            ProviderPage(provider: provider, settings: sample)
        } else {
            ProviderList(settings: sample)
        }
    }

    private var openProvider: SampleProvider? {
        guard case .provider(let slug) = navigator.page else { return nil }
        return SampleProvider(rawValue: slug)
    }
}

private struct ProviderList: View {
    let settings: SampleSettings?

    @State private var isAddingProvider = false

    var body: some View {
        Form {
            PaneHeader(destination: .providers)

            Section {
                if let settings {
                    ForEach(settings.listedProviders) { provider in
                        ProviderListRow(provider: provider, settings: settings)
                    }
                } else {
                    SettingsValueRow(item: .providerList, value: nil)
                }
            } header: {
                if settings == nil {
                    Text(SettingsItem.providerList.displayTitle)
                } else {
                    Text(SettingsItem.providerList.displayTitle)
                        .settingsRow(.providerList)
                }
            } footer: {
                HStack(alignment: .firstTextBaseline) {
                    settings == nil
                        ? Text("Supported providers come from the engine; none are listed here.")
                        : Text("Pico's sessions can use the models of every signed-in provider.")
                    Spacer()
                    Button("Add Provider…") { isAddingProvider = true }
                        .disabled(settings == nil)
                }
            }
        }
        .formStyle(.grouped)
        .sheet(isPresented: $isAddingProvider) {
            if let settings {
                AddProviderSheet(settings: settings)
            }
        }
        .onChange(of: settings == nil) { _, sampleDataIsOff in
            if sampleDataIsOff { isAddingProvider = false }
        }
    }
}

/// A provider's row: its logo, name, and how it is signed in. Choosing it opens its page.
private struct ProviderListRow: View {
    let provider: SampleProvider
    let settings: SampleSettings

    @Environment(SettingsNavigator.self) private var navigator

    var body: some View {
        Button {
            navigator.openProvider(provider.rawValue)
        } label: {
            HStack {
                ProviderSummary(provider: provider, subtitle: settings.statusLine(of: provider))
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// A provider's logo tile beside its name and a secondary line.
private struct ProviderSummary: View {
    let provider: SampleProvider
    let subtitle: Text

    var body: some View {
        HStack(spacing: 10) {
            ProviderTile(provider: provider, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: provider.name)
                subtitle
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Every provider, to choose one and open its page. Choosing closes the sheet.
private struct AddProviderSheet: View {
    let settings: SampleSettings

    @Environment(\.dismiss) private var dismiss
    @Environment(SettingsNavigator.self) private var navigator

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    ForEach(SampleProvider.allCases) { provider in
                        Button {
                            dismiss()
                            navigator.openProvider(provider.rawValue)
                        } label: {
                            HStack {
                                ProviderSummary(
                                    provider: provider,
                                    subtitle: Text(provider.requirement)
                                )
                                Spacer()
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Choose a Provider")
                }
            }
            .formStyle(.grouped)

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(20)
        }
        .frame(width: 480, height: 520)
    }
}
