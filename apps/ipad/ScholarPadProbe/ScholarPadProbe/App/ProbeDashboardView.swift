// 门禁总览页：双层画布（PencilKit 笔迹在下、语义对象在上）加 Pencil 延迟实时读数。
import SwiftUI
import UIKit

struct ProbeDashboardView: View {
    @State private var store = ProbeMetricsStore()
    @State private var scene = SemanticScene()
    @State private var clearToken = 0
    @State private var demoCircleCount = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                statsBar
                Divider()
                ZStack {
                    PencilLatencyCanvasView(store: store, clearToken: clearToken)
                    SemanticOverlayView(scene: scene)
                }
            }
            .navigationTitle("ScholarPad Probe")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    // 两个清空是两个动作：语义层与笔迹层永远分开
                    Button("加一个语义圆") { addDemoCircle() }
                    Button("清空语义层") { scene.clear() }
                    Button("清空笔迹", role: .destructive) { clearToken += 1 }
                    Button("清空本次探针", role: .destructive) { store.clearPenSamples() }
                }
            }
        }
    }

    private var statsBar: some View {
        HStack(spacing: 24) {
            stat("样本", "\(store.penSamples.count)", identifier: "penSampleCount")
            stat("P50", ms(store.penSummary?.p50Ms))
            stat("P95", ms(store.penSummary?.p95Ms))
            stat("最大", ms(store.penSummary?.maxMs))
            verdictLabel
            Spacer()
            Text("\(UIDevice.current.model) · iPadOS \(UIDevice.current.systemVersion)")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .font(.system(.body, design: .monospaced))
    }

    private var verdictLabel: some View {
        Group {
            switch store.penVerdict {
            case .insufficient(let have, let need):
                Label("样本不足 \(have)/\(need)", systemImage: "hourglass").foregroundStyle(.secondary)
            case .pass(let p95):
                Label("门禁通过 P95 \(ms(p95))", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
            case .fail(let p95):
                Label("门禁未过 P95 \(ms(p95))", systemImage: "xmark.octagon.fill").foregroundStyle(.red)
            }
        }
        .font(.body.bold())
    }

    private func stat(_ title: String, _ value: String, identifier: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).accessibilityIdentifier(identifier ?? "")
        }
    }

    private func ms(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.1f ms", value)
    }

    /// 阶段 0 用来肉眼验证分层的假远端动作；Task 5 接入局域网后由 Mac 端下发。
    private func addDemoCircle() {
        demoCircleCount += 1
        let offset = CGFloat(demoCircleCount * 90)
        scene.upsert(SemanticCircle(id: "demo-\(demoCircleCount)", owner: .agent,
                                    center: CGPoint(x: 160 + offset, y: 200), radius: 60))
    }
}
