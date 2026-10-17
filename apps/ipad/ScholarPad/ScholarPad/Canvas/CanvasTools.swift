import PencilKit
import SwiftUI

/// 仅控制孩子自己的笔迹；不修改照片、题意、辅助图或已保存的学习证据。
@MainActor final class CanvasTools: ObservableObject {
    enum Tool { case pen, eraser }
    @Published private(set) var selected: Tool = .pen
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false
    @Published private(set) var hasInk = false
    private weak var canvas: PKCanvasView?
    private var current = PKDrawing().dataRepresentation()
    private var undoStack: [Data] = []
    private var redoStack: [Data] = []
    private var lastRestoreToken: Int?

    func attach(_ canvas: PKCanvasView) {
        self.canvas = canvas
        applyTool()
    }
    func select(_ tool: Tool) { selected = tool; applyTool() }
    func resetHistory(to drawing: PKDrawing) {
        current = drawing.dataRepresentation(); undoStack = []; redoStack = []; refresh(drawing)
    }
    private func applyTool() {
        canvas?.tool = selected == .pen ? PKInkingTool(.pen, color: .black, width: 4) : PKEraserTool(.vector)
    }
    func restored(_ drawing: PKDrawing, token: Int? = nil) {
        let data = drawing.dataRepresentation()
        // PKDrawing 解码后重新编码的字节不保证相同；旋转用同一恢复代号，不据字节变化清空历史。
        if let token, token == lastRestoreToken { current = data; return }
        if let token { lastRestoreToken = token }
        guard data != current else { return }
        current = data; undoStack = []; redoStack = []
        // 恢复发生在 UIViewRepresentable 更新中，下一次主线程调度再发布工具状态。
        Task { @MainActor [weak self] in
            guard let self, let latest = try? PKDrawing(data: self.current) else { return }
            self.refresh(latest)
        }
    }
    func drawingChanged(_ drawing: PKDrawing) {
        let data = drawing.dataRepresentation()
        guard data != current else { return }
        undoStack.append(current); redoStack = []; current = data
        trimHistory(); refresh(drawing)
    }
    func clear() { guard hasInk else { return }; apply(PKDrawing(), recording: true) }
    func undo() {
        guard let data = undoStack.popLast(), let drawing = try? PKDrawing(data: data) else { return }
        redoStack.append(current); apply(drawing, recording: false)
    }
    func redo() {
        guard let data = redoStack.popLast(), let drawing = try? PKDrawing(data: data) else { return }
        undoStack.append(current); apply(drawing, recording: false)
    }
    private func apply(_ drawing: PKDrawing, recording: Bool) {
        guard let canvas else { return }
        if recording { drawingChanged(drawing) } else { current = drawing.dataRepresentation(); refresh(drawing) }
        canvas.drawing = drawing
        // PencilKit 的程序性赋值不保证立即回调；走同一个差分/落盘入口，重复回调由数据去重。
        canvas.delegate?.canvasViewDrawingDidChange?(canvas)
    }
    private func refresh(_ drawing: PKDrawing) {
        if hasInk != !drawing.strokes.isEmpty { hasInk = !drawing.strokes.isEmpty }
        if canUndo != !undoStack.isEmpty { canUndo = !undoStack.isEmpty }
        if canRedo != !redoStack.isEmpty { canRedo = !redoStack.isEmpty }
    }
    private func trimHistory() {
        // 图片墨迹也可能很大，历史同时受次数和字节约束，避免无限占用 iPad 内存。
        while undoStack.count > 30 || undoStack.reduce(0, { $0 + $1.count }) > 12_000_000 {
            undoStack.removeFirst()
        }
    }
}
