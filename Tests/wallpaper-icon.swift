// swift -O Tests/wallpaper-icon.swift "/path/to/Oasis Wallpaper.app"
import Foundation
import CoreGraphics
import ImageIO

enum IconError: Error { case arguments, bundle, command(String), pixels(String), mismatch(String) }

func run(_ executable: String, _ arguments: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/" + executable)
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw IconError.command(executable) }
}

func pixels(_ file: URL, size: Int) throws -> [UInt8] {
    guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          image.width == size, image.height == size,
          let space = CGColorSpace(name: CGColorSpace.sRGB) else { throw IconError.pixels(file.lastPathComponent) }
    var bytes = [UInt8](repeating: 0, count: size * size * 4)
    try bytes.withUnsafeMutableBytes { buffer in
        guard let context = CGContext(data: buffer.baseAddress, width: size, height: size,
            bitsPerComponent: 8, bytesPerRow: size * 4, space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
        else { throw IconError.pixels(file.lastPathComponent) }
        context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
    }
    return bytes
}

func check() throws {
    guard CommandLine.arguments.count == 2 else { throw IconError.arguments }
    let app = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let bundle = Bundle(url: app), let resources = bundle.resourceURL,
          let name = bundle.object(forInfoDictionaryKey: "CFBundleIconFile") as? String else { throw IconError.bundle }
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    let artwork = root.appendingPathComponent("Wallpaper/Resources/OasisWallpaperIcon.png")
    let manager = FileManager.default
    let work = manager.temporaryDirectory.appendingPathComponent("oasis-icon-test-" + UUID().uuidString)
    try manager.createDirectory(at: work, withIntermediateDirectories: false)
    defer { try? manager.removeItem(at: work) }
    let decoded = work.appendingPathComponent("decoded.iconset")
    try run("iconutil", ["-c", "iconset", resources.appendingPathComponent(name).path, "-o", decoded.path])
    for points in [16, 32, 128, 256, 512] {
        for scale in [1, 2] {
            let size = points * scale, suffix = scale == 2 ? "@2x" : ""
            let label = "icon_\(points)x\(points)\(suffix).png"
            let reference = work.appendingPathComponent("reference.png")
            try run("sips", ["-s", "format", "png", "-z", String(size), String(size), artwork.path, "--out", reference.path])
            let expected = try pixels(reference, size: size)
            let actual = try pixels(decoded.appendingPathComponent(label), size: size)
            let error = zip(expected, actual).reduce(0) { $0 + abs(Int($1.0) - Int($1.1)) }
            // Native legacy encodings can round translucent pixels; corrupted small icons differ by much more.
            guard error <= 3 * actual.count else { throw IconError.mismatch(label) }
        }
    }
}

do { try check(); print("PASS all 10 native icon representations match the source artwork") }
catch { fputs("FAIL \(error)\n", stderr); exit(1) }
