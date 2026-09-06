// 门禁测量的界面态：收集样本、算摘要、判门禁，并定期把摘要写进系统日志，方便真机上用 devicectl 读取。
import Foundation
import Observation
import os

@MainActor
@Observable
final class ProbeMetricsStore {
    private static let logger = Logger(subsystem: "com.houbin.aischolar.probe", category: "gate")

    private(set) var penSamples: [MetricSample] = []
    private(set) var penSummary: MetricSummary?
    private(set) var penVerdict: GateVerdict = .insufficient(have: 0, need: GateThresholds.penRenderMinSamples)

    func appendPenSample(_ sample: MetricSample) {
        penSamples.append(sample)
        refreshPen()
        // 每 20 个样本写一行日志，真机上不用截屏也能拿到数字
        if penSamples.count % 20 == 0, let summary = penSummary {
            Self.logger.notice("pen_render_ms n=\(summary.count) p50=\(summary.p50Ms, format: .fixed(precision: 1)) p95=\(summary.p95Ms, format: .fixed(precision: 1)) max=\(summary.maxMs, format: .fixed(precision: 1)) verdict=\(String(describing: self.penVerdict))")
        }
    }

    func clearPenSamples() {
        penSamples.removeAll()
        refreshPen()
    }

    private func refreshPen() {
        penSummary = try? MetricRecorder.summarize(penSamples)
        penVerdict = (try? PencilLatencyGate.evaluate(penSamples)) ?? .insufficient(have: penSamples.count, need: GateThresholds.penRenderMinSamples)
    }
}
