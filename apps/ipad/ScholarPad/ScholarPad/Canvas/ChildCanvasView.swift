// 孩子的笔迹层：PencilKit 画布的 SwiftUI 包装。画完一笔 PencilKit 通知“整幅画变了”，这里做差分翻成 STROKE / ERASE 事件。
// Agent 拿不到这个视图，也拿不到 PKDrawing；语义层是另一个只读视图叠在上面。
import PencilKit
import SwiftUI
import UIKit

struct ChildCanvasView: UIViewRepresentable {
    /// 外部把它 +1 就清空笔迹；用计数而不是布尔，避免同一值触发不了 updateUIView。
    let clearToken: Int
    var restored: Data? = nil
    var restoreToken: Int = 0
    var onDrawing: @MainActor (PKDrawing) -> Void = { _ in }
    let onEvents: @MainActor ([EventPayload]) -> Void

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        #if targetEnvironment(simulator)
        canvas.drawingPolicy = .anyInput   // 模拟器没有 Pencil，放开给鼠标/手指
        #else
        canvas.drawingPolicy = .pencilOnly
        #endif
        canvas.tool = PKInkingTool(.pen, color: .label, width: 4)
        canvas.backgroundColor = .systemBackground
        canvas.isOpaque = true
        canvas.delegate = context.coordinator
        canvas.accessibilityIdentifier = "childCanvas"
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        if context.coordinator.lastRestoreToken != restoreToken, let restored, let drawing = try? PKDrawing(data: restored) {
            context.coordinator.lastRestoreToken = restoreToken
            context.coordinator.restore(drawing, into: canvas)
        }
        if context.coordinator.lastClearToken != clearToken {
            context.coordinator.lastClearToken = clearToken
            context.coordinator.clearByChild(canvas)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(clearToken: clearToken, onEvents: onEvents, onDrawing: onDrawing) }

    @MainActor
    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var lastClearToken: Int
        var lastRestoreToken = -1
        private var lastData: Data?
        private var known: Set<String> = []
        private let onEvents: @MainActor ([EventPayload]) -> Void
        private let onDrawing: @MainActor (PKDrawing) -> Void

        init(clearToken: Int, onEvents: @escaping @MainActor ([EventPayload]) -> Void, onDrawing: @escaping @MainActor (PKDrawing) -> Void) {
            self.lastClearToken = clearToken
            self.onEvents = onEvents
            self.onDrawing = onDrawing
        }

        func restore(_ drawing: PKDrawing, into canvas: PKCanvasView) {
            known = Set(drawing.strokes.map { StrokeDiff.quantizedHash(points: $0.path.map(\.location)) })
            lastData = drawing.dataRepresentation()
            canvas.drawing = drawing
        }

        func clearByChild(_ canvas: PKCanvasView) {
            canvas.drawing = PKDrawing()
            canvasViewDrawingDidChange(canvas)
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            let data = canvasView.drawing.dataRepresentation()
            guard data != lastData else { return }
            lastData = data
            onDrawing(canvasView.drawing)
            let strokes = canvasView.drawing.strokes.map { stroke in
                let bounds = stroke.renderBounds
                return StrokeDiff.Stroke(
                    hash: StrokeDiff.quantizedHash(points: stroke.path.map(\.location)),
                    bounds: StrokeBounds(x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height)
                )
            }
            let events = StrokeDiff.diff(known: known, current: strokes)
            known = Set(strokes.map(\.hash))
            if !events.isEmpty { onEvents(events) }
        }
    }
}
