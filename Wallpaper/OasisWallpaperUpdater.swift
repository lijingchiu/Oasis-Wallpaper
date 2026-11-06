import AppKit

@MainActor
final class OasisWallpaperUpdater {
    private let releases: URL
    private let downloads: URL
    private let installed: URL
    private let version: String
    private let reserveRestart: (Bool) async throws -> Void
    private let changed: ([String: Any]) -> Void
    private var phase = "idle"
    private var message = ""
    private var progress = 0.0
    private(set) var busy = false

    init(releases: URL = URL(string: "https://api.github.com/repos/lijingchiu/Oasis-Wallpaper/releases?per_page=100")!,
         downloads: URL = URL(string: "https://github.com/lijingchiu/Oasis-Wallpaper/releases/download/")!,
         reserveRestart: @escaping (Bool) async throws -> Void, changed: @escaping ([String: Any]) -> Void) {
        self.releases = releases
        self.downloads = downloads
        installed = Bundle.main.bundleURL.standardizedFileURL.resolvingSymlinksInPath()
        version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        self.reserveRestart = reserveRestart
        self.changed = changed
        if ProcessInfo.processInfo.environment["OASIS_WALLPAPER_ROLLBACK"] == "1" {
            phase = "error"
            message = "新版啟動失敗，已恢復版本 \(version)。"
        }
    }

    var state: [String: Any] {
        ["phase": phase, "message": message, "progress": progress, "version": version, "busy": busy]
    }

    private func report(_ phase: String, _ message: String, progress: Double = 0) {
        self.phase = phase
        self.message = message
        self.progress = progress
        changed(state)
    }

    func check() async {
        guard !busy else { return }
        busy = true
        report("checking", "正在檢查更新…")
        var staging: URL?
        var handedOff = false
        defer {
            if !handedOff {
                if let staging { try? FileManager.default.removeItem(at: staging) }
                busy = false
                changed(state)
            }
        }
        do {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpCookieStorage = nil
            configuration.urlCache = nil
            configuration.timeoutIntervalForRequest = 40
            configuration.timeoutIntervalForResource = 1800
            configuration.httpAdditionalHeaders = ["User-Agent": "Oasis-Wallpaper-Updater/\(version)"]
            let metadataDelegate = OasisUpdateDownloadDelegate(maximum: OasisUpdaterCore.maxArchive) { _ in }
            let session = URLSession(configuration: configuration, delegate: metadataDelegate, delegateQueue: nil)
            defer { session.invalidateAndCancel() }
            var request = URLRequest(url: releases)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw OasisUpdateError.download }
            if [403, 429].contains(http.statusCode), http.value(forHTTPHeaderField: "X-RateLimit-Remaining") == "0" {
                report("error", "GitHub 暫時限制了檢查次數，請稍後重試。")
                return
            }
            guard http.statusCode == 200 else { throw OasisUpdateError.download }
            guard let release = try OasisUpdaterCore.latest(data, installed: version, assetPrefix: "Oasis-Wallpaper") else {
                report("current", "目前已是最新版（\(version)）。")
                return
            }
            let downloadRoot = downloads.appendingPathComponent("v" + release.version.text)
            var checksum = release.asset.digest
            if checksum == nil, let file = release.checksum {
                let (data, response) = try await session.data(from: downloadRoot.appendingPathComponent(file.name))
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw OasisUpdateError.missingChecksum }
                checksum = OasisUpdaterCore.checksum(data, filename: release.asset.name)
            }
            guard let checksum else { throw OasisUpdateError.missingChecksum }
            let parent = installed.deletingLastPathComponent()
            guard FileManager.default.isWritableFile(atPath: parent.path), !installed.pathComponents.contains("AppTranslocation")
            else { throw OasisUpdateError.permission }
            try Self.requireSpace(at: parent, bytes: release.asset.size + 256 * 1024 * 1024)
            let stage = parent.appendingPathComponent(OasisWallpaperUpdateInstall.prefix + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            staging = stage
            let label = "正在下載 Oasis Wallpaper \(release.version.text)"
            report("downloading", label + "… 0%")
            let delegate = OasisUpdateDownloadDelegate(maximum: release.asset.size) { [weak self] fraction in
                Task { @MainActor in
                    guard let self, self.phase == "downloading", fraction > self.progress else { return }
                    self.report("downloading", "\(label)… \(Int(fraction * 100))%", progress: fraction)
                }
            }
            let downloads = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
            defer { downloads.invalidateAndCancel() }
            let url = downloadRoot.appendingPathComponent(release.asset.name)
            let (archive, reply) = try await delegate.download(downloads, request: URLRequest(url: url), root: stage)
            guard (reply as? HTTPURLResponse)?.statusCode == 200,
                  (try archive.resourceValues(forKeys: [.fileSizeKey])).fileSize == Int(release.asset.size)
            else { throw OasisUpdateError.download }
            report("verifying", "下載完成，正在驗證更新包…", progress: 1)
            let target = installed
            try await Task.detached(priority: .utility) {
                guard try OasisUpdaterCore.sha256(archive) == checksum else { throw OasisUpdateError.checksum }
                let size = try OasisUpdaterCore.validateArchive(archive, bundleName: OasisWallpaperUpdateInstall.bundleName)
                try Self.requireSpace(at: parent, bytes: size + 128 * 1024 * 1024)
                let unpack = Process()
                unpack.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                unpack.arguments = ["-x", "-k", archive.path, stage.path]
                try unpack.run()
                unpack.waitUntilExit()
                guard unpack.terminationStatus == 0 else { throw OasisUpdateError.unsafeArchive }
                try OasisWallpaperUpdateInstall.validate(stage: stage, target: target, version: release.version)
            }.value
            try await reserveRestart(true)
            do {
                let installer = Process()
                installer.executableURL = Bundle.main.executableURL
                installer.arguments = ["--install-wallpaper-update", String(getpid()), stage.lastPathComponent, release.version.text]
                installer.standardInput = FileHandle.nullDevice
                installer.standardOutput = FileHandle.nullDevice
                installer.standardError = FileHandle.nullDevice
                installer.terminationHandler = { [weak self] process in
                    guard process.terminationStatus != 0 else { return }
                    Task { @MainActor in
                        guard let self, self.phase == "installing" else { return }
                        try? await self.reserveRestart(false)
                        self.busy = false
                        self.report("error", "App 尚未重新啟動，請再按一次檢查更新。")
                    }
                }
                try installer.run()
            } catch {
                try? await reserveRestart(false)
                throw OasisUpdateError.install
            }
            handedOff = true
            report("installing", "正在安裝並重新啟動 Oasis Wallpaper…", progress: 1)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { NSApp.terminate(nil) }
        } catch {
            let detail = (error as? OasisUpdateError)?.errorDescription
            report("error", detail ?? (error is URLError ? "無法連接 GitHub，請檢查網路後重試。" : "更新未完成，請稍後重試。"))
        }
    }

    private nonisolated static func requireSpace(at folder: URL, bytes: Int64) throws {
        let attributes = try FileManager.default.attributesOfFileSystem(forPath: folder.path)
        guard let free = attributes[.systemFreeSize] as? NSNumber, free.int64Value > bytes else {
            throw OasisUpdateError.insufficientSpace
        }
    }
}
