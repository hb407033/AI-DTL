import XCTest
import PencilKit
@testable import ScholarPad

@MainActor final class CanvasToolsTests: XCTestCase {
    func testClearUndoRedoAllNotifyTheExistingDrawingAndEvidencePath() throws {
        let tools = CanvasTools(), canvas = PKCanvasView()
        var drawings: [PKDrawing] = []
        let coordinator = ChildCanvasView.Coordinator(clearToken: 0, onEvents: { _ in }, onDrawing: { drawings.append($0) }, tools: tools)
        canvas.delegate = coordinator; tools.attach(canvas)
        let ink = stroke()
        canvas.drawing = ink; coordinator.canvasViewDrawingDidChange(canvas)
        XCTAssertTrue(tools.canUndo); XCTAssertTrue(tools.hasInk)
        tools.select(.eraser); XCTAssertTrue(canvas.tool is PKEraserTool)
        tools.select(.pen); XCTAssertTrue(canvas.tool is PKInkingTool)
        tools.clear()
        XCTAssertTrue(canvas.drawing.strokes.isEmpty); XCTAssertFalse(tools.hasInk)
        XCTAssertEqual(drawings.last?.strokes.count, 0)
        tools.undo()
        XCTAssertEqual(canvas.drawing.strokes.count, 1)
        XCTAssertEqual(drawings.last?.strokes.count, 1)
        XCTAssertTrue(tools.canRedo)
        tools.redo()
        XCTAssertTrue(canvas.drawing.strokes.isEmpty)
        XCTAssertEqual(drawings.last?.strokes.count, 0)
    }
    func testRecreatingCanvasForRotationRetainsCurrentWorkAndUndo() throws {
        let tools = CanvasTools(), first = PKCanvasView()
        tools.attach(first); tools.restored(first.drawing, token: 1)
        first.drawing = stroke(); tools.drawingChanged(first.drawing)
        let second = PKCanvasView(); second.drawing = try PKDrawing(data: first.drawing.dataRepresentation())
        tools.attach(second); tools.restored(second.drawing, token: 1)
        XCTAssertTrue(tools.canUndo)
        tools.undo(); XCTAssertTrue(second.drawing.strokes.isEmpty)
        tools.redo(); XCTAssertEqual(second.drawing.strokes.count, 1)
    }
    func testLoadingAnotherWorkResetsHistoryAndCannotUndoIntoPreviousWork() async {
        let tools = CanvasTools(), canvas = PKCanvasView()
        tools.attach(canvas); canvas.drawing = stroke(); tools.drawingChanged(canvas.drawing)
        tools.restored(PKDrawing())
        await Task.yield()
        XCTAssertFalse(tools.canUndo); XCTAssertFalse(tools.canRedo); XCTAssertFalse(tools.hasInk)
    }
    func testSwitchingProblemsDropsHistoryEvenWhenBothCanvasesAreEmpty() {
        let tools = CanvasTools(), canvas = PKCanvasView()
        tools.attach(canvas); canvas.drawing = stroke(); tools.drawingChanged(canvas.drawing)
        tools.clear(); XCTAssertTrue(tools.canUndo)
        tools.resetHistory(to: PKDrawing())
        XCTAssertFalse(tools.canUndo); XCTAssertFalse(tools.canRedo)
        tools.undo(); XCTAssertTrue(canvas.drawing.strokes.isEmpty)
    }
    private func stroke() -> PKDrawing {
        let points = [CGPoint(x: 20, y: 50), CGPoint(x: 160, y: 60)].map {
            PKStrokePoint(location: $0, timeOffset: 0, size: CGSize(width: 4, height: 4), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
    }
}
