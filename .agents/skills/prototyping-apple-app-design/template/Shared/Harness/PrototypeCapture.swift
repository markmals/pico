import SwiftUI

#if os(macOS)
import AppKit
#endif

/// The readiness handshake that makes screenshots deterministic.
///
/// Sleeping for a fixed number of seconds after `simctl launch` races the launch
/// screen and silently captures blank frames. Instead the app announces that it has
/// actually rendered, and the capture script waits for that announcement.
@MainActor
enum PrototypeCapture {

    /// Call once the requested screen has appeared.
    static func signalReady(screen: Screen) {
        #if os(macOS)
        parkWindowAndReportFrame()
        #else
        writeSimulatorMarker(screen: screen)
        #endif
    }

    #if !os(macOS)
    /// Simulator platforms: drop a marker in the app container. The capture script
    /// resolves the container with `simctl get_app_container` and polls for this file,
    /// so it also confirms that the *requested* screen is the one on screen.
    private static func writeSimulatorMarker(screen: Screen) {
        guard let documents = FileManager.default.urls(
            for: .documentDirectory, in: .userDomainMask
        ).first else { return }
        try? screen.rawValue.write(
            to: documents.appendingPathComponent("prototype-ready.txt"),
            atomically: true,
            encoding: .utf8
        )
    }
    #endif

    #if os(macOS)
    /// macOS: there is no `simctl io screenshot`. Park the window at a known size and
    /// report its rect in top-left screen coordinates so the script can capture exactly
    /// this window with `screencapture -R`, which needs no Accessibility permission.
    private static func parkWindowAndReportFrame() {
        guard let path = PrototypeLaunch.readyFile else { return }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            guard let window = NSApp.windows.first(where: \.isVisible),
                  let screen = window.screen ?? NSScreen.main else { return }

            let size = NSSize(width: 1180, height: 800)
            let origin = NSPoint(
                x: screen.frame.minX + 60,
                y: screen.frame.maxY - size.height - 60
            )
            window.setFrame(NSRect(origin: origin, size: size), display: true)
            NSApp.activate(ignoringOtherApps: true)

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                let frame = window.frame
                let topLeftY = screen.frame.maxY - frame.maxY
                let rect = "\(Int(frame.minX)),\(Int(topLeftY)),\(Int(frame.width)),\(Int(frame.height))"
                try? rect.write(toFile: path, atomically: true, encoding: .utf8)
            }
        }
    }
    #endif
}
