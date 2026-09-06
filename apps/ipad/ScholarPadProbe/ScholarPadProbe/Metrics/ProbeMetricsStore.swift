// 门禁测量的界面态：按指标名收样本、算摘要、判门禁，并把摘要写进系统日志，方便真机上用 devicectl 读取。
import Foundation
import Observation
import os

@MainActor
@Observable
final class ProbeMetricsStore {
    private static let logger = Logger(subsystem: "com.houbin.aischolar.probe", category: "gate")

    private var samplesByMetric: [MetricName: [MetricSample]] = [:]

    func samples(for metric: MetricName) -> [MetricSample] { samplesByMetric[metric] ?? [] }
    func summary(for metric: MetricName) -> MetricSummary? { try? MetricRecorder.summarize(samples(for: metric)) }
    func verdict(for metric: MetricName) -> GateVerdict {
        let rule = GateThresholds.rule(for: metric)
        return (try? LatencyGate.evaluate(samples(for: metric), rule: rule)) ?? .insufficient(have: samples(for: metric).count, need: rule.minSamples)
    }

    func append(_ sample: MetricSample) {
        samplesByMetric[sample.metric, default: []].append(sample)
        let count = samples(for: sample.metric).count
        // 高频指标每 20 个样本写一行日志，低频指标每个都写；真机上不用截屏也能拿到数字
        let logEvery = GateThresholds.rule(for: sample.metric).minSamples >= 100 ? 20 : 1
        if count % logEvery == 0, let summary = summary(for: sample.metric) {
            Self.logger.notice("\(sample.metric.rawValue) n=\(summary.count) p50=\(summary.p50Ms, format: .fixed(precision: 1)) p95=\(summary.p95Ms, format: .fixed(precision: 1)) max=\(summary.maxMs, format: .fixed(precision: 1)) ok=\(summary.successCount) verdict=\(String(describing: self.verdict(for: sample.metric)))")
        }
    }

    func clear(_ metric: MetricName) {
        samplesByMetric[metric] = nil
    }
}
