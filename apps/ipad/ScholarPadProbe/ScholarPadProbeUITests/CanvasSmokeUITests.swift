// 画布冒烟 UI 测试：用真实触摸事件在画布上拖一笔，证明"触摸观察器 → 延迟采样 → 界面读数"这条线是通的，
// 且旁观式手势识别器没有挡住 PencilKit 自己的手势。模拟器上用鼠标触摸，真机门禁仍以 Pencil 为准。
import XCTest

final class CanvasSmokeUITests: XCTestCase {
    @MainActor
    func testDraggingOnCanvasProducesPenSamples() throws {
        let app = XCUIApplication()
        app.launch()

        let canvas = app.descendants(matching: .any)["pencilCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 5), "找不到画布")

        let sampleCount = app.staticTexts["penSampleCount"]
        XCTAssertTrue(sampleCount.waitForExistence(timeout: 5))
        XCTAssertEqual(sampleCount.label, "0", "启动时应无样本")

        let start = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.4))
        let end = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.6))
        start.press(forDuration: 0.05, thenDragTo: end)

        let gotSamples = NSPredicate(format: "label != '0'")
        expectation(for: gotSamples, evaluatedWith: sampleCount)
        waitForExpectations(timeout: 3)
    }

    @MainActor
    func testClearingStrokesDoesNotResetSamples() throws {
        // "清空笔迹"只清 PKDrawing，不清测量样本；两者是不同操作
        let app = XCUIApplication()
        app.launch()
        let canvas = app.descendants(matching: .any)["pencilCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 5))
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5)))
        let sampleCount = app.staticTexts["penSampleCount"]
        expectation(for: NSPredicate(format: "label != '0'"), evaluatedWith: sampleCount)
        waitForExpectations(timeout: 3)
        let before = sampleCount.label

        app.buttons["清空笔迹"].tap()
        XCTAssertEqual(sampleCount.label, before)
    }
}
