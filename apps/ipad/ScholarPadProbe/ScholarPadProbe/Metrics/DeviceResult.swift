// iPad 门禁结果的导出结构。与 Mac 端报告器的 deviceResultSchema 共用夹具 device-result-v1.json。
// 只含设备信息与指标样本；不含 PCM、录音、笔迹或任何家庭环境信息。
import Foundation
import UIKit

struct DeviceResult: Codable, Equatable {
    struct SlowMotionSpotCheck: Codable, Equatable {
        let note: String
        let estimatedMs: Double
    }

    let schemaVersion: Int
    let runId: String
    let deviceModel: String
    let systemVersion: String
    let appBuild: String
    let transport: String
    let samples: [MetricSample]
    var slowMotionSpotChecks: [SlowMotionSpotCheck]?

    @MainActor
    static func build(from store: ProbeMetricsStore, appBuild: String, now: Date = Date()) -> DeviceResult {
        let stamp = ISO8601DateFormatter().string(from: now).replacingOccurrences(of: ":", with: "-")
        let suffix = String((UIDevice.current.identifierForVendor ?? UUID()).uuidString.prefix(8)).lowercased()
        return DeviceResult(
            schemaVersion: 1,
            runId: "device-\(stamp)-\(suffix)",
            deviceModel: "\(UIDevice.current.model) \(Self.machineIdentifier())",
            systemVersion: UIDevice.current.systemVersion,
            appBuild: appBuild,
            transport: "ws-local",
            samples: MetricName.allCases.flatMap { store.samples(for: $0) },
            slowMotionSpotChecks: nil
        )
    }

    /// 硬件型号标识（如 iPad16,5），UIDevice.model 只给 "iPad"。
    private static func machineIdentifier() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        return withUnsafePointer(to: &systemInfo.machine) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
        }
    }
}
