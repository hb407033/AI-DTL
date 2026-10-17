import XCTest

final class WorkspaceDrawingToolsUITests: XCTestCase {
    @MainActor func testToolsAreVisibleAndClearCanBeCancelledAndUndone() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_HOST": "127.0.0.1", "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE": "1"]
        defer { XCUIDevice.shared.orientation = .portrait; app.terminate() }
        app.launch()
        let canvas = app.scrollViews["childCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 10))
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            XCUIDevice.shared.orientation = orientation
            let settled = NSPredicate { _, _ in
                let landscape = app.frame.width > app.frame.height
                return landscape == (orientation == .landscapeLeft) && app.buttons["workspacePen"].frame.height >= 44
            }
            expectation(for: settled, evaluatedWith: nil)
            waitForExpectations(timeout: 8)
            for id in ["workspacePen", "workspaceEraser", "workspaceUndo", "workspaceRedo", "workspaceClearInk"] {
                XCTAssertTrue(app.buttons[id].waitForExistence(timeout: 3), "缺少书写工具 \(id)")
                XCTAssertTrue(app.buttons[id].isHittable, "工具需直接可见 \(id)")
                XCTAssertGreaterThanOrEqual(app.buttons[id].frame.height, 44)
            }
            XCTAssertTrue(app.buttons["workspaceCamera"].isHittable)
            XCTAssertTrue(app.buttons["workspaceVoice"].isHittable)
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = "workspace-designed-\(orientation.rawValue)"; shot.lifetime = .keepAlways; add(shot)
        }
        app.buttons["workspaceEraser"].tap()
        XCTAssertEqual(app.buttons["workspaceEraser"].value as? String, "已选")
        app.buttons["workspacePen"].tap()
        let start = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.35))
        let end = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.45))
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertEqual(canvas.value as? String, "1")
        let count = canvas.value as? String
        app.buttons["workspaceEraser"].tap()
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertEqual(canvas.value as? String, "0", "橡皮应实际擦掉笔画，不只是改变按钮状态")
        app.buttons["workspaceUndo"].tap()
        XCTAssertEqual(canvas.value as? String, count)
        app.buttons["workspacePen"].tap()
        app.buttons["workspaceClearInk"].tap()
        app.buttons["保留笔迹"].tap()
        XCTAssertEqual(canvas.value as? String, count)
        app.buttons["workspaceClearInk"].tap()
        app.buttons["确认清空笔迹"].tap()
        XCTAssertEqual(canvas.value as? String, "0")
        app.buttons["workspaceUndo"].tap()
        XCTAssertEqual(canvas.value as? String, count)
        app.buttons["workspaceRedo"].tap()
        XCTAssertEqual(canvas.value as? String, "0")
    }
}
