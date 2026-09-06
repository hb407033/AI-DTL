// 音频探针的界面态：把 AudioProbeCore 的事件翻译成可显示状态，并把打断样本记入 ProbeMetricsStore。
import Foundation
import Observation
import os

@MainActor
@Observable
final class AudioProbeEngine {
    private static let logger = Logger(subsystem: "com.houbin.aischolar.probe", category: "audio")

    private(set) var permissionGranted: Bool?
    private(set) var status = "未初始化"
    private(set) var route = "—"
    private(set) var threshold: Float?
    private(set) var lastResult = "—"
    private(set) var trialRunning = false

    private let core = AudioProbeCore()
    private let store: ProbeMetricsStore
    private var eventTask: Task<Void, Never>?

    init(store: ProbeMetricsStore) {
        self.store = store
        eventTask = Task { [weak self, core] in
            for await event in core.events {
                guard let self else { return }
                self.handle(event)
            }
        }
    }

    func prepare() { Task { await core.prepare() } }
    func resumeIfNeeded() { Task { await core.resumeIfNeeded() } }
    func startInterruptTrial() {
        trialRunning = true
        threshold = nil
        Task { await core.startInterruptTrial() }
    }
    func stopTrial() {
        trialRunning = false
        Task { await core.stopTrial() }
    }
    func recordAndPlayBack() { Task { await core.recordAndPlayBack(seconds: 5) } }

    private func handle(_ event: AudioProbeCore.Event) {
        switch event {
        case .permission(let granted):
            permissionGranted = granted
        case .status(let text):
            status = text
        case .calibrated(let value):
            threshold = value
            status = "已校准阈值 \(String(format: "%.4f", value))，等待开口…"
        case .interrupted(let latency, let detectToStop):
            trialRunning = false
            store.append(MetricSample(metric: .localInterrupt, elapsedMs: latency, success: true))
            lastResult = String(format: "开口→停播 %.1f ms（判定→停播 %.2f ms）", latency, detectToStop)
            status = "已打断"
            Self.logger.notice("local_interrupt_ms sample=\(latency, format: .fixed(precision: 1)) detect_to_stop=\(detectToStop, format: .fixed(precision: 2)) n=\(self.store.samples(for: .localInterrupt).count)")
        case .trialTimedOut:
            trialRunning = false
            status = "30 秒内没有检测到开口，本次不计样本"
            Self.logger.notice("local_interrupt trial timed out")
        case .playbackFinished:
            status = "回放完成，录音已清零"
        case .routeChanged(let text):
            route = text
        case .failure(let text):
            trialRunning = false
            status = text
            Self.logger.error("\(text)")
        }
    }
}
