import SwiftUI

struct SettingsWindowView: View {
    static let sceneID = "settings"

    @Bindable var navigator: SettingsNavigator

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            SettingsSidebar(navigator: navigator)
                .navigationSplitViewColumnWidth(215)
        } detail: {
            RetainedSettingsPanes(selection: navigator.current)
                .navigationTitle(Text(navigator.current.title))
                .toolbar {
                    ToolbarItem(placement: .navigation) {
                        BackForwardControl(navigator: navigator)
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    ScaffoldNotice()
                }
                .environment(\.settingsReveal, reveal)
        }
        .frame(width: 715)
        .frame(minHeight: 520, idealHeight: 680, maxHeight: .infinity)
        .focusedSceneValue(
            \.settingsHistory,
            SettingsHistoryActions(
                canGoBack: navigator.canGoBack,
                canGoForward: navigator.canGoForward,
                navigator: navigator
            )
        )
        .onOpenURL { url in
            navigator.handle(url)
        }
        .alert(
            "Pico Can't Open This Link",
            isPresented: $navigator.isShowingRejectedLink,
            presenting: navigator.rejectedLink
        ) { _ in
            Button("OK") {}
        } message: { link in
            Text("“\(link.absoluteString)” doesn't name a pane or setting in Pico.")
        }
    }

    private var reveal: SettingsReveal? {
        navigator.revealedItem.map { SettingsReveal(item: $0, openCount: navigator.openCount) }
    }
}
