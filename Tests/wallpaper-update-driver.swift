// Test app only. The release app never accepts a configurable feed or a test startup mode.
import AppKit

@main
struct WallpaperUpdateDriver {
    @MainActor static func main() {
        let arguments = CommandLine.arguments
        if arguments.dropFirst().first == "--install-wallpaper-update" {
            exit(OasisWallpaperUpdateInstall.run(Array(arguments.dropFirst(2))))
        }
        if Bundle.main.object(forInfoDictionaryKey: "WallpaperTestFailLaunch") as? Bool == true { exit(41) }
        let env = ProcessInfo.processInfo.environment
        let log = URL(fileURLWithPath: env["WALLPAPER_TEST_LOG"]!)
        func record(_ text: String) {
            let line = Data((text + "\n").utf8)
            let handle = try! FileHandle(forWritingTo: log)
            defer { try? handle.close() }
            _ = try! handle.seekToEnd()
            try! handle.write(contentsOf: line)
        }
        if env["OASIS_WALLPAPER_ROLLBACK"] == "1" { record("rolled back and reopened"); return }
        let host = URL(string: env["WALLPAPER_TEST_FEED"]!)!
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let updater = OasisWallpaperUpdater(releases: host.appendingPathComponent("releases"), downloads: host,
            reserveRestart: { reserve in record("reserve \(reserve)") },
            changed: { state in
                record("\(state["phase"]!) \(state["progress"]!) \(state["message"]!)")
            })
        Task { @MainActor in
            async let first: Void = updater.check()
            async let second: Void = updater.check()
            _ = await (first, second)
            if !updater.busy { app.terminate(nil) }
        }
        app.run()
    }
}
