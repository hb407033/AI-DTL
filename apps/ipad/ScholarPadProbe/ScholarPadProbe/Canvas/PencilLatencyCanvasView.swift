// PencilKit 笔迹层的 SwiftUI 包装。只做两件事：让孩子用 Pencil 画；旁观触摸时间戳并在下一帧结算延迟。
// 不覆写 PKCanvasView 的 touches 系列方法，改用一个只旁观、永不识别成功的手势识别器，避免干扰 PencilKit 自己的手势。
import PencilKit
import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

struct PencilLatencyCanvasView: UIViewRepresentable {
    let store: ProbeMetricsStore
    /// 外部把它 +1 就清空笔迹；用计数而不是布尔，避免同一值触发不了 updateUIView。
    let clearToken: Int

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        #if targetEnvironment(simulator)
        canvas.drawingPolicy = .anyInput   // 模拟器没有 Pencil，放开给鼠标以便验证管线
        #else
        canvas.drawingPolicy = .pencilOnly
        #endif
        canvas.tool = PKInkingTool(.pen, color: .label, width: 4)
        canvas.backgroundColor = .systemBackground
        canvas.isOpaque = true
        canvas.accessibilityIdentifier = "pencilCanvas"   // 供 XCUITest 定位画布

        let observer = TouchObserverRecognizer(target: nil, action: nil)
        observer.onTouch = { [coordinator = context.coordinator] timestamp in
            coordinator.noteTouch(timestamp: timestamp)
        }
        observer.delegate = context.coordinator
        canvas.addGestureRecognizer(observer)

        context.coordinator.startDisplayLink()
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        if context.coordinator.lastClearToken != clearToken {
            context.coordinator.lastClearToken = clearToken
            canvas.drawing = PKDrawing()
        }
    }

    static func dismantleUIView(_ canvas: PKCanvasView, coordinator: Coordinator) {
        coordinator.stopDisplayLink()
    }

    func makeCoordinator() -> Coordinator { Coordinator(store: store, clearToken: clearToken) }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private let store: ProbeMetricsStore
        private var tracker = PencilLatencyTracker()
        private var displayLink: CADisplayLink?
        var lastClearToken: Int

        init(store: ProbeMetricsStore, clearToken: Int) {
            self.store = store
            self.lastClearToken = clearToken
        }

        func noteTouch(timestamp: TimeInterval) {
            tracker.noteTouch(timestamp: timestamp)
        }

        func startDisplayLink() {
            let link = CADisplayLink(target: self, selector: #selector(onFrame(_:)))
            // 让回调跟上 ProMotion 120Hz，否则会把 60Hz 的帧间隔算进延迟
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
            link.add(to: .main, forMode: .common)
            displayLink = link
        }

        func stopDisplayLink() {
            displayLink?.invalidate()
            displayLink = nil
        }

        @objc private func onFrame(_ link: CADisplayLink) {
            if let sample = tracker.noteFrame(targetTimestamp: link.targetTimestamp) {
                store.appendPenSample(sample)
            }
        }

        // 与 PencilKit 自己的手势并行识别，不抢也不挡
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            true
        }
    }
}

/// 只旁观触摸、永远停留在 .possible 的识别器：拿到每次触摸的系统时间戳后原样放行。
final class TouchObserverRecognizer: UIGestureRecognizer {
    var onTouch: ((TimeInterval) -> Void)?

    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        record(touches)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        record(touches)
    }

    private func record(_ touches: Set<UITouch>) {
        for touch in touches {
            #if !targetEnvironment(simulator)
            guard touch.type == .pencil else { continue }   // 真机只统计 Pencil，手指触摸不计入门禁
            #endif
            onTouch?(touch.timestamp)
        }
    }
}
