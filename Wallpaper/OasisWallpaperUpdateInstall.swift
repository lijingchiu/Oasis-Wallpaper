import Foundation
import Darwin

enum OasisWallpaperUpdateInstall {
    static let prefix = ".Oasis-Wallpaper-update-"
    static let bundleName = "Oasis Wallpaper.app"
    private static let identifier = "local.oasis.wallpaper"
    private static let readyKey = "OASIS_WALLPAPER_UPDATE_READY"
    private static let rollbackKey = "OASIS_WALLPAPER_ROLLBACK"

    private static func validStageName(_ name: String) -> Bool {
        name.count == prefix.count + 36 && name.hasPrefix(prefix) && UUID(uuidString: String(name.dropFirst(prefix.count))) != nil
    }

    // Only the trusted local main window calls this after its library and controls have mounted.
    static func acknowledgeStartup() {
        guard let raw = ProcessInfo.processInfo.environment[readyKey] else { return }
        let file = URL(fileURLWithPath: raw).standardizedFileURL
        let stage = file.deletingLastPathComponent()
        let target = Bundle.main.bundleURL.resolvingSymlinksInPath()
        guard file.lastPathComponent == "ready", validStageName(stage.lastPathComponent),
              stage.deletingLastPathComponent().path == target.deletingLastPathComponent().path,
              stage.resolvingSymlinksInPath().path == stage.path else { return }
        let descriptor = open(file.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        if descriptor >= 0 {
            // An atomic swap can preserve the old bundle date and leave Finder using its cached icon.
            // Refresh only this bundle, once the replacement has started successfully.
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: target.path)
            close(descriptor)
        }
    }

    static func validate(stage: URL, target: URL, version: OasisVersion) throws {
        let candidate = stage.appendingPathComponent(bundleName)
        func info(_ app: URL) throws -> [String: Any] {
            guard app.resolvingSymlinksInPath().path == app.path,
                  let plist = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist")) as? [String: Any],
                  plist["CFBundleIdentifier"] as? String == identifier,
                  plist["CFBundleExecutable"] as? String == "Oasis" else { throw OasisUpdateError.incompatible }
            return plist
        }
        let installed = try info(target), update = try info(candidate)
        guard let old = installed["CFBundleShortVersionString"] as? String, let oldVersion = OasisVersion(old), oldVersion < version,
              let raw = update["CFBundleShortVersionString"] as? String, OasisVersion(raw) == version,
              let minimum = update["LSMinimumSystemVersion"] as? String else { throw OasisUpdateError.incompatible }
        let parts = minimum.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...3).contains(parts.count), parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) && Int($0) != nil })
        else { throw OasisUpdateError.incompatible }
        let os = parts.compactMap { Int($0) } + [0, 0]
        guard ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: os[0], minorVersion: os[1], patchVersion: os[2])) else { throw OasisUpdateError.incompatible }
        for name in ["Oasis", "node"] {
            let executable = candidate.appendingPathComponent("Contents/MacOS/" + name)
            let architectures = CFBundleCopyExecutableArchitecturesForURL(executable as CFURL) as? [NSNumber] ?? []
            guard FileManager.default.isExecutableFile(atPath: executable.path),
                  Set(architectures.map(\.int32Value)).isSuperset(of: [CPU_TYPE_ARM64, CPU_TYPE_X86_64])
            else { throw OasisUpdateError.incompatible }
        }
        guard FileManager.default.fileExists(atPath: candidate.appendingPathComponent("Contents/Resources/OasisWallpaperServer.mjs").path)
        else { throw OasisUpdateError.incompatible }
        try OasisUpdaterCore.verifySignature(current: target, candidate: candidate)
    }

    private static func launch(_ target: URL, ready: URL? = nil, rolledBack: Bool = false) throws -> Process {
        let app = Process()
        app.executableURL = target.appendingPathComponent("Contents/MacOS/Oasis")
        var environment = ProcessInfo.processInfo.environment
        environment[readyKey] = ready?.path
        environment[rollbackKey] = rolledBack ? "1" : nil
        app.environment = environment
        app.standardInput = FileHandle.nullDevice
        app.standardOutput = FileHandle.nullDevice
        app.standardError = FileHandle.nullDevice
        try app.run()
        return app
    }

    private static func wait(seconds: TimeInterval, until condition: () -> Bool) -> Bool {
        let deadline = ProcessInfo.processInfo.systemUptime + seconds
        while !condition() && ProcessInfo.processInfo.systemUptime < deadline { Thread.sleep(forTimeInterval: 0.15) }
        return condition()
    }

    static func run(_ args: [String]) -> Int32 {
        guard args.count == 3, let parentPID = Int32(args[0]), parentPID > 1,
              // The parent can already have quit by the time macOS schedules this copy.
              (parentPID == getppid() || getppid() == 1 && kill(parentPID, 0) != 0 && errno == ESRCH),
              validStageName(args[1]), let version = OasisVersion(args[2]) else { return 1 }
        let target = Bundle.main.bundleURL.standardizedFileURL.resolvingSymlinksInPath()
        let stage = target.deletingLastPathComponent().appendingPathComponent(args[1], isDirectory: true)
        var details = stat()
        guard lstat(stage.path, &details) == 0, details.st_mode & S_IFMT == S_IFDIR,
              details.st_uid == getuid(), details.st_mode & 0o077 == 0 else { return 1 }
        let candidate = stage.appendingPathComponent(bundleName)
        let ready = stage.appendingPathComponent("ready")
        let manager = FileManager.default
        guard !manager.fileExists(atPath: ready.path) else { return 1 }
        let lock = open(target.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard lock >= 0 else { return 1 }
        defer { close(lock) }
        guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { return 1 }
        defer { flock(lock, LOCK_UN) }
        var keepBackup = false
        defer { if !keepBackup { try? manager.removeItem(at: stage) } }
        guard wait(seconds: 30, until: { kill(parentPID, 0) != 0 && errno == ESRCH }) else { return 1 }
        do {
            var locked = stat(), current = stat()
            guard fstat(lock, &locked) == 0, lstat(target.path, &current) == 0,
                  locked.st_dev == current.st_dev, locked.st_ino == current.st_ino else { return 1 }
            try validate(stage: stage, target: target, version: version)
            guard renamex_np(candidate.path, target.path, UInt32(RENAME_SWAP)) == 0 else { throw OasisUpdateError.install }
            keepBackup = true
            let child = try launch(target, ready: ready)
            _ = wait(seconds: 75) { !child.isRunning || manager.fileExists(atPath: ready.path) }
            if child.isRunning && manager.fileExists(atPath: ready.path) { keepBackup = false; return 0 }
            if child.isRunning {
                child.terminate()
                if !wait(seconds: 5, until: { !child.isRunning }) {
                    kill(child.processIdentifier, SIGKILL)
                    child.waitUntilExit()
                }
            }
            throw OasisUpdateError.install
        } catch {
            if keepBackup {
                guard renamex_np(candidate.path, target.path, UInt32(RENAME_SWAP)) == 0 else { return 1 }
                keepBackup = false
            }
            _ = try? launch(target, rolledBack: true)
            return 1
        }
    }
}
