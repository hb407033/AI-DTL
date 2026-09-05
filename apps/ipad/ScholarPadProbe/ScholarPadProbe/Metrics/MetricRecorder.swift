// 门禁指标的统计算法。与 Mac 端 summarizeMetrics 必须是同一算法，报告器才能跨端比较。
import Foundation

enum MetricError: Error {
    case emptySamples
}

enum MetricRecorder {
    /// 用 nearest-rank 法算百分位：取排序后第 ceil(p·n) 个样本，不做插值。
    /// 选它是因为两端实现只需一行且结果完全一致；插值法在小样本上会让 Swift 与 TS 各差一点。
    /// 空样本抛错而不是返回 0，避免把"没测"伪装成"0 毫秒"。
    static func summarize(_ samples: [MetricSample]) throws -> MetricSummary {
        guard !samples.isEmpty else { throw MetricError.emptySamples }
        let values = samples.map(\.elapsedMs).sorted()
        func nearestRank(_ percentile: Double) -> Double {
            let index = max(0, Int(ceil(percentile * Double(values.count))) - 1)
            return values[index]
        }
        return MetricSummary(
            count: samples.count,
            successCount: samples.filter(\.success).count,
            p50Ms: nearestRank(0.50),
            p95Ms: nearestRank(0.95),
            maxMs: values[values.count - 1]
        )
    }
}
