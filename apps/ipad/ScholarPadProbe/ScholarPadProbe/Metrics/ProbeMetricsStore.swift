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
    private(set) var penVerdict: GateVerdict = .insufficient(have: 0, need: GateThresholds.penRender.minSamples)

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

    private(set) var interruptSamples: [MetricSample] = []
    private(set) var interruptSummary: MetricSummary?
    private(set) var interruptVerdict: GateVerdict = .insufficient(have: 0, need: GateThresholds.localInterrupt.minSamples)

    func appendInterruptSample(_ sample: MetricSample) {
        interruptSamples.append(sample)
        interruptSummary = try? MetricRecorder.summarize(interruptSamples)
        interruptVerdict = (try? LatencyGate.evaluate(interruptSamples, rule: GateThresholds.localInterrupt))
            ?? .insufficient(have: interruptSamples.count, need: GateThresholds.localInterrupt.minSamples)
        if let summary = interruptSummary {
            Self.logger.notice("local_interrupt_ms n=\(summary.count) p50=\(summary.p50Ms, format: .fixed(precision: 1)) p95=\(summary.p95Ms, format: .fixed(precision: 1)) max=\(summary.maxMs, format: .fixed(precision: 1)) verdict=\(String(describing: self.interruptVerdict))")
        }
    }

    func clearInterruptSamples() {
        interruptSamples.removeAll()
        interruptSummary = nil
        interruptVerdict = .insufficient(have: 0, need: GateThresholds.localInterrupt.minSamples)
    }

    private func refreshPen() {
        penSummary = try? MetricRecorder.summarize(penSamples)
        penVerdict = (try? LatencyGate.evaluate(penSamples, rule: GateThresholds.penRender)) ?? .insufficient(have: penSamples.count, need: GateThresholds.penRender.minSamples)
    }
}
