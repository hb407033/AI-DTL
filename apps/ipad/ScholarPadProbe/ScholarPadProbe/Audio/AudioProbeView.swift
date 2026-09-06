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
                    MetricStatsRow(metric: .localInterrupt, store: store, countIdentifier: "interruptSampleCount")
                    LabeledContent("上次结果", value: engine.lastResult)
                    if engine.trialRunning {
                        Button("停止本次测试", role: .destructive) { engine.stopTrial() }
                    } else {
                        Button("开始一次打断测试：先放测试音，请在 1 秒校准后开口") { engine.startInterruptTrial() }
                    }
                    Button("清空打断样本", role: .destructive) { store.clear(.localInterrupt) }
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
}
