// 单个指标的统计行：样本数 / P50 / P95 / 最大 / 门禁判定。三个探针页共用，避免各自抄一份。
import SwiftUI

struct MetricStatsRow: View {
    let metric: MetricName
    let store: ProbeMetricsStore
    var countIdentifier: String? = nil

    var body: some View {
        HStack(spacing: 24) {
            statCell("样本", "\(store.samples(for: metric).count)", identifier: countIdentifier)
            statCell("P50", Self.ms(store.summary(for: metric)?.p50Ms))
            statCell("P95", Self.ms(store.summary(for: metric)?.p95Ms))
            statCell("最大", Self.ms(store.summary(for: metric)?.maxMs))
            verdictLabel(store.verdict(for: metric))
        }
        .font(.system(.body, design: .monospaced))
    }

    private func verdictLabel(_ verdict: GateVerdict) -> some View {
        Group {
            switch verdict {
            case .insufficient(let have, let need):
                Label("样本不足 \(have)/\(need)", systemImage: "hourglass").foregroundStyle(.secondary)
            case .pass(let p95):
                Label("门禁通过 P95 \(Self.ms(p95))", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
            case .fail(let p95):
                Label("门禁未过 P95 \(Self.ms(p95))", systemImage: "xmark.octagon.fill").foregroundStyle(.red)
            }
        }
        .font(.body.bold())
    }

    private func statCell(_ title: String, _ value: String, identifier: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).accessibilityIdentifier(identifier ?? "")
        }
    }

    static func ms(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.1f ms", value)
    }
}
