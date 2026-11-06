// swift Tests/wallpaper-ui-startup.swift http://127.0.0.1:PORT/
import AppKit
import WebKit

guard CommandLine.arguments.count == 2, let url = URL(string: CommandLine.arguments[1]),
      url.scheme == "http", url.host == "127.0.0.1", url.path == "/" else {
    fatalError("Supply the root URL of an isolated wallpaper service")
}

@MainActor
final class StartupChecks: NSObject, WKNavigationDelegate {
    let web: WKWebView
    private var navigation: CheckedContinuation<Void, Error>?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 920, height: 720), configuration: configuration)
        super.init()
        web.navigationDelegate = self
    }

    func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
        navigation?.resume()
        navigation = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError error: Error) {
        navigation?.resume(throwing: error)
        navigation = nil
    }

    private func navigate(_ start: () -> Void) async throws {
        try await withCheckedThrowingContinuation { continuation in
            navigation = continuation
            start()
        }
    }

    private func check(_ expression: String, _ message: String) async throws {
        guard (try await web.evaluateJavaScript(expression)) as? Bool == true else {
            throw NSError(domain: "WallpaperStartup", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
    }

    private func select(_ tab: String, available: Bool) async throws {
        try await check("""
            (() => {
                const button = document.querySelector('[data-page-tab="\(tab)"]');
                button.click();
                return button.getAttribute('aria-current') === 'page'
                    && document.body.dataset.page === '\(tab)'
                    && document.querySelector('#page-load-status').hidden === \(available);
            })()
            """, "Tab did not report the expected state: \(tab), available=\(available)")
    }

    func run(at url: URL) async throws {
        let controller = web.configuration.userContentController
        let store = WKContentRuleListStore.default()!
        for asset in ["theme", "weather", "workshop-browser", "wallpaper-app"] {
            let id = "oasis-wallpaper-startup-\(UUID().uuidString)"
            let ruleJSON = #"[{"trigger":{"url-filter":"/\#(asset)\\.js$","resource-type":["script"]},"action":{"type":"block"}}]"#
            let rule = try await store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: ruleJSON)!
            controller.add(rule)
            do {
                try await navigate { web.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)) }
                if asset == "wallpaper-app" {
                    try await check("getComputedStyle(document.querySelector('nav')).display === 'none' && !document.querySelector('#page-load-status').hidden", "Inert controls exposed without the main script")
                } else {
                    try await select("library", available: asset != "weather")
                    try await select("settings", available: asset != "weather")
                    try await select("appearance", available: asset != "theme")
                    try await select("workshop", available: asset == "theme")
                    let failedTab = asset == "theme" ? "appearance" : asset == "weather" ? "library" : "workshop"
                    try await select(failedTab, available: false)
                }
                controller.remove(rule)
                try await navigate { web.evaluateJavaScript("document.querySelector('#page-load-status a').click()", completionHandler: nil) }
                for tab in ["library", "settings", "appearance", "workshop"] {
                    try await select(tab, available: true)
                }
                try await select("library", available: true)
                try await check("!document.querySelector('#import-oasis, #import-status') && !!document.querySelector('input[type=file]')", "Library actions after removing the Oasis import")
                try await select("workshop", available: true)
                try await check("!!document.querySelector('.owb-search input') && !!document.querySelector('[data-glass-setting]')", "Controls missing after retry")
                try await check("""
                    (() => {
                        const button = document.querySelector('#check-update'), panel = document.querySelector('#update-status');
                        const bar = panel.querySelector('progress');
                        window.oasisWallpaperUpdate({phase:'downloading',busy:true,version:'1.0.3',message:'42%',progress:0.42});
                        const downloading = button.disabled && !panel.hidden && !bar.hidden && bar.value === 0.42;
                        window.oasisWallpaperUpdate({phase:'current',busy:false,version:'1.0.3',message:'目前已是最新版',progress:0});
                        return downloading && !button.disabled && bar.hidden && panel.textContent.includes('最新版');
                    })()
                    """, "Update progress or retry state did not render")
            } catch {
                controller.remove(rule)
                try? await store.removeContentRuleList(forIdentifier: id)
                throw error
            }
            try await store.removeContentRuleList(forIdentifier: id)
            print("PASS \(asset).js failure and recovery")
        }
    }
}

let app = NSApplication.shared
Task { @MainActor in
    let checks = StartupChecks()
    let window = NSWindow(contentRect: checks.web.bounds, styleMask: [.titled], backing: .buffered, defer: false)
    window.contentView = checks.web
    window.orderBack(nil)
    defer { window.orderOut(nil) }
    do { try await checks.run(at: url); exit(0) }
    catch { print("FAIL \(error.localizedDescription)"); exit(1) }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 45) { print("FAIL navigation timed out"); exit(1) }
app.run()
