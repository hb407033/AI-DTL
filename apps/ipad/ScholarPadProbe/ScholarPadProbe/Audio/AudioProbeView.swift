// 音频门禁页：初始化、打断测试（放测试音 → 开口 → 本机停播）、5 秒录音回放，实时显示打断延迟读数。
import SwiftUI

struct AudioProbeView: View {
    let engine: AudioProbeEngine
    let store: ProbeMetricsStore
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Form {
                Section("状态") {
                    LabeledContent("麦克风权限", value: permissionText)
                    LabeledContent("引擎") { Text(engine.status).accessibilityIdentifier("audioStatus") }
                    LabeledContent("路由", value: engine.route)
                    LabeledContent("VAD 阈值", value: engine.threshold.map { String(format: "%.4f", $0) } ?? "未校准")
                }
                Section("本地打断（预算 P95 ≤ 200 ms，需 20 次）") {
                    HStack(spacing: 24) {
                        stat("样本", "\(store.interruptSamples.count)", identifier: "interruptSampleCount")
                        stat("P50", ms(store.interruptSummary?.p50Ms))
                        stat("P95", ms(store.interruptSummary?.p95Ms))
                        stat("最大", ms(store.interruptSummary?.maxMs))
                        verdictLabel(store.interruptVerdict)
                    }
                    .font(.system(.body, design: .monospaced))
                    LabeledContent("上次结果", value: engine.lastResult)
                    if engine.trialRunning {
                        Button("停止本次测试", role: .destructive) { engine.stopTrial() }
                    } else {
                        Button("开始一次打断测试：先放测试音，请在 1 秒校准后开口") { engine.startInterruptTrial() }
                    }
                    Button("清空打断样本", role: .destructive) { store.clearInterruptSamples() }
                }
                Section("录音回放（PCM 只在内存，回放完清零）") {
                    Button("录 5 秒并回放") { engine.recordAndPlayBack() }
                }
                Section {
                    Button("初始化音频") { engine.prepare() }
                }
            }
            .navigationTitle("音频门禁")
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { engine.resumeIfNeeded() }   // 锁屏唤醒后确保引擎在跑
        }
    }

    private var permissionText: String {
        switch engine.permissionGranted {
        case .none: return "未请求"
        case .some(true): return "已允许"
        case .some(false): return "被拒绝"
        }
    }

    private func verdictLabel(_ verdict: GateVerdict) -> some View {
        Group {
            switch verdict {
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
}
