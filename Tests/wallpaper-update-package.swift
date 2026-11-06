// Compile with OasisUpdaterCore.swift; pass an official universal Wallpaper ZIP and its SHA-256.
import Foundation

@main
enum WallpaperUpdatePackageChecks {
    static func main() throws {
        let arguments = CommandLine.arguments
        precondition(arguments.count == 3)
        let archive = URL(fileURLWithPath: arguments[1])
        let digest = try OasisUpdaterCore.sha256(archive)
        precondition(digest == arguments[2])
        let size = try OasisUpdaterCore.validateArchive(archive, bundleName: "Oasis Wallpaper.app")
        precondition(size > 0)
        do {
            _ = try OasisUpdaterCore.validateArchive(archive, bundleName: "Oasis.app")
            fatalError("The full Oasis app must reject a Wallpaper archive")
        } catch OasisUpdateError.unsafeArchive {}

        func release(_ version: String, name: String, draft: Bool = false, preview: Bool = false) -> [String: Any] {
            ["tag_name": "v" + version, "draft": draft, "prerelease": preview, "assets": [
                ["id": 12, "name": name, "size": 1000, "state": "uploaded", "digest": "sha256:" + digest]
            ]]
        }
        let assets = [release("1.0.12", name: "Oasis-Wallpaper-v1.0.12-macOS-universal.zip"),
                      release("2.0.0", name: "preview.zip", preview: true),
                      release("3.0.0", name: "draft.zip", draft: true)]
        let data = try JSONSerialization.data(withJSONObject: assets)
        let next = try OasisUpdaterCore.latest(data, installed: "1.0.9", assetPrefix: "Oasis-Wallpaper")
        precondition(next?.version.text == "1.0.12")
        let current = try OasisUpdaterCore.latest(data, installed: "1.0.12", assetPrefix: "Oasis-Wallpaper")
        let ahead = try OasisUpdaterCore.latest(data, installed: "1.0.13", assetPrefix: "Oasis-Wallpaper")
        precondition(current == nil && ahead == nil)
        let wrong = try JSONSerialization.data(withJSONObject: [release("1.0.12", name: "Oasis-v1.0.12-universal.zip")])
        do {
            _ = try OasisUpdaterCore.latest(wrong, installed: "1.0.9", assetPrefix: "Oasis-Wallpaper")
            fatalError("Wallpaper must reject a full Oasis release")
        } catch OasisUpdateError.invalidRelease {}
        print("Passed release selection, version ordering, product isolation, ZIP validation and checksum")
    }
}
