import Cocoa

/// A transparent title-bar surface. Controls continue receiving their own
/// events; AppKit owns the actual window drag, including screen boundaries.
@MainActor
final class MoleWindowDragView: NSView {
    private var dragRegion = NSRect.zero
    private var exclusions: [NSRect] = []
    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        autoresizingMask = [.width, .height]
        setAccessibilityElement(false)
    }
    required init?(coder: NSCoder) { nil }

    @discardableResult
    func update(_ value: [String: Any], in webView: NSView) -> Bool {
        dragRegion = .zero
        exclusions = []
        guard value["modal"] as? Bool != true,
              let layout = value["drag"] as? [String: Any],
              let height = layout["height"] as? Double, height.isFinite,
              height >= 0, height <= 120,
              let controls = layout["exclusions"] as? [[String: Any]], controls.count <= 32 else { return false }
        var rectangles: [NSRect] = []
        for control in controls {
            guard let x = control["x"] as? Double, let y = control["y"] as? Double,
                  let width = control["width"] as? Double, let height = control["height"] as? Double,
                  [x, y, width, height].allSatisfy({ $0.isFinite && abs($0) <= 10000 }),
                  width >= 0, height >= 0 else { return false }
            rectangles.append(domRect(NSRect(x: x, y: y, width: width, height: height), in: webView).insetBy(dx: -3, dy: -3))
        }
        exclusions = rectangles
        dragRegion = domRect(NSRect(x: 0, y: 0, width: webView.bounds.width, height: min(height, webView.bounds.height)), in: webView)
        return true
    }

    private func domRect(_ rect: NSRect, in webView: NSView) -> NSRect {
        let y = webView.isFlipped ? rect.minY : webView.bounds.height - rect.maxY
        return convert(NSRect(x: rect.minX, y: y, width: rect.width, height: rect.height), from: webView)
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        guard !isHidden, bounds.contains(local), dragRegion.contains(local),
              !exclusions.contains(where: { $0.contains(local) }) else { return nil }
        // Keep the standard macOS window controls clickable as well.
        for kind: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
            if let button = window?.standardWindowButton(kind), !button.isHidden,
               convert(button.bounds, from: button).insetBy(dx: -3, dy: -3).contains(local) { return nil }
        }
        return self
    }

    override func mouseDown(with event: NSEvent) {
        guard event.type == .leftMouseDown, let window, window.isMovable,
              !window.styleMask.contains(.fullScreen) else { return }
        window.performDrag(with: event)
    }
}
