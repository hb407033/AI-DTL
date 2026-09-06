// 门禁指标的数据模型。rawValue 即 Mac 端 packages/gate-contracts 的 METRIC_NAMES 字面量，两端不得各自改名。
import Foundation

enum MetricName: String, Codable, CaseIterable {
    case penRender = "pen_render_ms"
    case localInterrupt = "local_interrupt_ms"
    case lanAck = "lan_ack_ms"
    case firstAudio = "first_audio_ms"
    case remoteCanvas = "remote_canvas_ms"
    case reconnect = "reconnect_ms"
}

struct MetricSample: Codable, Equatable {
    let metric: MetricName
    let elapsedMs: Double
    let success: Bool
}

struct MetricSummary: Codable, Equatable {
    let count: Int
    let successCount: Int
    let p50Ms: Double
    let p95Ms: Double
    let maxMs: Double
}
