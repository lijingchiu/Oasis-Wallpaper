import Cocoa
import ServiceManagement

@MainActor
final class MoleLoginAtStartup {
    var changed: (([String: Any]) -> Void)?

    private var service: SMAppService { .mainApp }

    func snapshot() -> [String: Any] {
        let status = service.status
        let enabled = status == .enabled
        let needsApproval = status == .requiresApproval
        let message: String
        switch status {
        case .enabled:
            message = "Mole 會在你登入 macOS 時自動開啟。"
        case .requiresApproval:
            message = "請在系統設定的登入項目中允許 Mole。"
        case .notFound:
            message = "macOS 找不到此 App 的登入項目。"
        case .notRegistered:
            message = "目前未設定登入時啟動。"
        @unknown default:
            message = "無法確認登入項目狀態。"
        }
        return ["enabled": enabled, "needsApproval": needsApproval, "status": status.rawValue, "message": message]
    }

    func publish() { changed?(snapshot()) }

    func configure(_ enabled: Bool) {
        do {
            if enabled {
                if service.status != .enabled { try service.register() }
            } else if service.status != .notRegistered {
                try service.unregister()
            }
            publish()
        } catch {
            var value = snapshot()
            value["error"] = error.localizedDescription
            changed?(value)
        }
    }

    func openSettings() { SMAppService.openSystemSettingsLoginItems() }
}
