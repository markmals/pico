import SwiftUI

struct SeshPane: View {
    @Environment(RuntimeReadiness.self) private var runtime

    var body: some View {
        Form {
            PaneHeader(destination: .sesh)

            Section {
                PicoLocationRow(installation: runtime.installation)
                SettingsValueRow(item: .launchArguments, value: .text("None"))
            } header: {
                Text("Launch details")
            } footer: {
                Text("Sesh starts Pico by running this file, with no arguments.")
            }

            Section {
                SeshCustomAgentRow()
            } header: {
                Text("Add Pico to Sesh")
            } footer: {
                Text(
                    "In Sesh, choose **Settings › Machines** and click **Details…** next to this Mac. Click **Add an Agent…**, then **Custom…**, name the agent Pico, enter the `pico` location above as its program, leave its interpreter empty, and click **Add**. Pico can’t tell whether Sesh already has it."
                )
            }
        }
        .formStyle(.grouped)
    }
}
