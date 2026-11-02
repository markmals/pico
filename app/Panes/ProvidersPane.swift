import SwiftUI

/// Providers & Accounts: the provider list, or the page of the provider it opened.
struct ProvidersPane: View {
    @Environment(\.sampleSettings) private var sample
    @Environment(SettingsNavigator.self) private var navigator

    var body: some View {
        if let sample, let provider = openProvider, sample.isAdded(provider) {
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
                    AddProviderMenu(settings: settings)
                }
            }
        }
        .formStyle(.grouped)
    }
}

private struct ProviderListRow: View {
    let provider: SampleProvider
    let settings: SampleSettings

    @Environment(SettingsNavigator.self) private var navigator

    var body: some View {
        if settings.isAdded(provider) {
            Button {
                navigator.openProvider(provider.rawValue)
            } label: {
                HStack {
                    summary
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        } else {
            HStack {
                summary
                Spacer()
                Button("Set Up") {
                    settings.add(provider)
                    navigator.openProvider(provider.rawValue)
                }
            }
        }
    }

    private var summary: some View {
        HStack(spacing: 10) {
            ProviderTile(provider: provider, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: provider.name)
                settings.statusLine(of: provider)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Adds a provider that is not listed yet and opens its page; unavailable without sample data.
private struct AddProviderMenu: View {
    let settings: SampleSettings?

    @Environment(SettingsNavigator.self) private var navigator

    var body: some View {
        Menu("Add Provider…") {
            ForEach(settings?.providersToAdd ?? []) { provider in
                Button(provider.name) {
                    settings?.add(provider)
                    navigator.openProvider(provider.rawValue)
                }
            }
        }
        .fixedSize()
        .disabled(settings?.providersToAdd.isEmpty ?? true)
    }
}
