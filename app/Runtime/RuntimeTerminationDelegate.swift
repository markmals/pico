import AppKit

@MainActor
final class RuntimeTerminationDelegate: NSObject {
    var runtime: RuntimeReadiness?
    private var termination: Task<Void, Never>?
}

extension RuntimeTerminationDelegate: NSApplicationDelegate {
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let runtime else { return .terminateNow }
        if termination == nil {
            termination = Task {
                await runtime.cancelAndWait()
                sender.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
