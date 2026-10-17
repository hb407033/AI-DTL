import XCTest

/// A2: confirmed 后画布首屏可见 ≥55% 视区，对话/暂停可触达，不需滚动寻找。
final class WorkspaceCanvasFirstUITests: XCTestCase {
    @MainActor func testConfirmedWorkStartsWithVisibleCanvas() throws {
        continueAfterFailure = false
        let testId = "A2C0F1E9-3D4A-4B7E-9C3D-000000000001"
        let app = XCUIApplication()
        app.launchEnvironment = [
            "AI_DTL_WORKSPACE_TEST_ID": testId,
            "AI_DTL_WORKSPACE_HOST": "127.0.0.1",
            "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE": "1"
        ]

        // ── 竖屏 ──
        XCUIDevice.shared.orientation = .portrait
        app.launch()

        // 诊断：确认 fixture 已加载（workspaceStatement 应显示题面）
        let statement = app.staticTexts["workspaceStatement"]
        XCTAssertTrue(statement.waitForExistence(timeout: 10), "confirmed fixture 应显示题面；实际可见: \(app.descendants(matching: .any).staticTexts.allElementsBoundByIndex.map { $0.label })")

        let canvas = app.scrollViews["childCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 10), "confirmed 后画布应存在")
        XCTAssertTrue(canvas.isHittable, "竖屏画布应首屏可触，不需滚动")
        let voiceButton = app.buttons["workspaceVoice"]
        XCTAssertTrue(voiceButton.waitForExistence(timeout: 5))
        XCTAssertTrue(voiceButton.isHittable, "竖屏对话/暂停按钮应首屏可触")
        XCTAssertEqual(voiceButton.label, "一起聊聊")

        let portraitWindow = app.frame
        let portraitCanvas = canvas.frame
        let portraitIntersect = portraitWindow.intersection(portraitCanvas)
        let portraitRatio = (portraitIntersect.width * portraitIntersect.height) / (portraitWindow.width * portraitWindow.height)
        XCTAssertGreaterThanOrEqual(portraitRatio, 0.55,
            "竖屏画布可见面积 \(portraitRatio) < 55% 视区")
        let portraitShot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        portraitShot.name = "a2-portrait-canvas-first"; portraitShot.lifetime = .keepAlways; add(portraitShot)

        // ── 横屏 ──
        XCUIDevice.shared.orientation = .landscapeLeft
        for _ in 0..<20 { if app.frame.width > app.frame.height { break }; _ = app.frame; usleep(200_000) }
        XCTAssertTrue(canvas.waitForExistence(timeout: 10))
        XCTAssertTrue(canvas.isHittable, "横屏画布应首屏可触，不需滚动")
        XCTAssertTrue(voiceButton.isHittable, "横屏对话/暂停按钮应首屏可触")

        let landscapeWindow = app.frame
        let landscapeCanvas = canvas.frame
        let landscapeIntersect = landscapeWindow.intersection(landscapeCanvas)
        let landscapeRatio = (landscapeIntersect.width * landscapeIntersect.height) / (landscapeWindow.width * landscapeWindow.height)
        XCTAssertGreaterThanOrEqual(landscapeRatio, 0.55,
            "横屏画布可见面积 \(landscapeRatio) < 55% 视区")
        let landscapeShot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        landscapeShot.name = "a2-landscape-canvas-first"; landscapeShot.lifetime = .keepAlways; add(landscapeShot)

        XCUIDevice.shared.orientation = .portrait
        app.terminate()
    }
}
