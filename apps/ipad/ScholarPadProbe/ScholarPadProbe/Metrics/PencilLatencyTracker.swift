// Pencil 延迟采样与门禁判定。
// 测的是"触摸事件时间戳 → 下一帧目标呈现时刻"，即应用侧帧调度延迟，是真实像素延迟的下界，
// 不是像素延迟本身；真实像素延迟按计划另用 240fps 慢动作抽查。
import Foundation

struct PencilLatencyTracker {
    /// 当前帧内最早的一次触摸时间戳（秒，与 CADisplayLink / UITouch 同一时钟）。
    private var earliestPendingTouch: TimeInterval?

    /// 记录一次触摸。一帧内多次触摸只保留最早那次，报最坏情况。
    mutating func noteTouch(timestamp: TimeInterval) {
        if let pending = earliestPendingTouch, pending <= timestamp { return }
        earliestPendingTouch = timestamp
    }

    /// 帧回调时结算：有待测触摸则产出一个样本并清空。帧目标时刻早于触摸属时钟异常，记失败样本。
    mutating func noteFrame(targetTimestamp: TimeInterval) -> MetricSample? {
        guard let touch = earliestPendingTouch else { return nil }
        earliestPendingTouch = nil
        let elapsed = targetTimestamp - touch
        guard elapsed >= 0 else {
            return MetricSample(metric: .penRender, elapsedMs: 0, success: false)
        }
        return MetricSample(metric: .penRender, elapsedMs: elapsed * 1000, success: true)
    }
}

/// 一条门禁规则：样本下限 + P95 上限。
struct GateRule: Equatable {
    let p95LimitMs: Double
    let minSamples: Int
}

/// 门禁规则表，与计划 §0 表格一致；Mac 端报告器必须用同一组数。
enum GateThresholds {
    static let penRender = GateRule(p95LimitMs: 50, minSamples: 100)
    static let localInterrupt = GateRule(p95LimitMs: 200, minSamples: 20)
}

enum GateVerdict: Equatable {
    case insufficient(have: Int, need: Int)
    case pass(p95Ms: Double)
    case fail(p95Ms: Double)
}

enum LatencyGate {
    static func evaluate(_ samples: [MetricSample], rule: GateRule) throws -> GateVerdict {
        guard samples.count >= rule.minSamples else {
            return .insufficient(have: samples.count, need: rule.minSamples)
        }
        let summary = try MetricRecorder.summarize(samples)
        return summary.p95Ms <= rule.p95LimitMs ? .pass(p95Ms: summary.p95Ms) : .fail(p95Ms: summary.p95Ms)
    }
}
