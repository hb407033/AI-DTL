// 门禁总览页：双层画布（PencilKit 笔迹在下、语义对象在上）加 Pencil 延迟实时读数。
import SwiftUI
import UIKit

struct ProbeDashboardView: View {
    @State private var store: ProbeMetricsStore
    @State private var audio: AudioProbeEngine
    @State private var canvas: CanvasSceneStore
    @State private var socket: ProbeWebSocket
    @State private var clearToken = 0
    @State private var demoCircleCount = 0

    init() {
        let store = ProbeMetricsStore()
        let canvas = CanvasSceneStore()
        _store = State(initialValue: store)
        _canvas = State(initialValue: canvas)
        _audio = State(initialValue: AudioProbeEngine(store: store))
        _socket = State(initialValue: ProbeWebSocket(store: store, canvas: canvas))
    }

    var body: some View {
        TabView {
            canvasTab
                .tabItem { Label("画布", systemImage: "pencil.and.outline") }
            AudioProbeView(engine: audio, store: store)
                .tabItem { Label("音频", systemImage: "waveform") }
            NetworkProbeView(socket: socket, store: store)
                .tabItem { Label("网络", systemImage: "network") }
        }
    }

    private var canvasTab: some View {
        NavigationStack {
            VStack(spacing: 0) {
                statsBar
                Divider()
                ZStack {
                    PencilLatencyCanvasView(store: store, clearToken: clearToken)
                    SemanticOverlayView(scene: canvas.scene)
                }
            }
            .navigationTitle("ScholarPad Probe")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    // 两个清空是两个动作：语义层与笔迹层永远分开
                    Button("加一个语义圆") { addDemoCircle() }
                    Button("清空语义层") { canvas.scene.clear() }
                    Button("清空笔迹", role: .destructive) { clearToken += 1 }
                    Button("清空本次探针", role: .destructive) { store.clear(.penRender) }
                }
            }
        }
    }

    private var statsBar: some View {
        HStack {
            MetricStatsRow(metric: .penRender, store: store, countIdentifier: "penSampleCount")
            Spacer()
            Text("\(UIDevice.current.model) · iPadOS \(UIDevice.current.systemVersion)")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    /// 阶段 0 用来肉眼验证分层的假远端动作；Task 5 接入局域网后由 Mac 端下发。
    private func addDemoCircle() {
        demoCircleCount += 1
        let offset = CGFloat(demoCircleCount * 90)
        canvas.scene.upsert(SemanticCircle(id: "demo-\(demoCircleCount)", owner: .agent,
                                    center: CGPoint(x: 160 + offset, y: 200), radius: 60))
    }
}
