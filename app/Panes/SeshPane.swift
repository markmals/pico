import SwiftUI

struct SeshPane: View {
    @Environment(\.sampleSettings) private var sample

    var body: some View {
        Form {
            PaneHeader(destination: .sesh)

            Section {
                SettingsValueRow(
                    item: .helperLocation,
                    value: sample == nil ? nil : .verbatim(SampleFacts.helperLocation)
                )
                SettingsValueRow(item: .launchArguments, value: sample == nil ? nil : .text("None"))
            } header: {
                Text("Launch details")
            } footer: {
                sample == nil
                    ? Text("The helper's location is not resolved while settings stay unconnected.")
                    : Text("Sesh starts Pico with these details.")
            }

            Section {
                SettingsValueRow(item: .customAgent, value: customAgent) {
                    SeshRegistrationButton(settings: sample)
                }
                SettingsValueRow(item: .seshConnectionStatus, value: connectionStatus)
            } header: {
                Text("Connection")
            } footer: {
                sample == nil
                    ? Text("Nothing is read from Sesh, and no registration is inspected.")
                    : Text("Registering adds Pico to Sesh as a custom agent.")
            }

            Section {
                SettingsValueRow(item: .setupStatus, value: setupStatus)
            } header: {
                Text("Setup")
            } footer: {
                sample == nil
                    ? Text("Guided setup through Sesh is not available from this scaffold.")
                    : Text("New Sesh sessions can use Pico once setup is complete.")
            }
        }
        .formStyle(.grouped)
    }

    private var customAgent: SettingsValue? {
        sample.map { $0.isRegisteredWithSesh ? .verbatim("Pico") : .text("Not registered") }
    }

    private var connectionStatus: SettingsValue? {
        sample.map {
            $0.isRegisteredWithSesh
                ? .status("Connected", .ready) : .status("Disconnected", .inactive)
        }
    }

    private var setupStatus: SettingsValue? {
        sample.map {
            $0.isRegisteredWithSesh
                ? .status("Complete", .ready) : .status("Not set up", .attention)
        }
    }
}

/// Registers or unregisters Pico with Sesh in sample data; unavailable without it.
private struct SeshRegistrationButton: View {
    let settings: SampleSettings?

    var body: some View {
        if let settings, settings.isRegisteredWithSesh {
            Button("Unregister") { settings.unregisterFromSesh() }
        } else {
            Button("Register") { settings?.registerWithSesh() }
                .disabled(settings == nil)
        }
    }
}
