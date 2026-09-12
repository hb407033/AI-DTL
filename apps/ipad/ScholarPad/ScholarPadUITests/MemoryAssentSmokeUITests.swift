import XCTest

/// 注入出站消息验证原生布局与入口；真实宿主链路由 socket 冒烟另测。
final class MemoryAssentSmokeUITests: XCTestCase {
    @MainActor
    func testEqualButtonsEvidenceAndPersistentControls() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-session"]
        app.launchEnvironment["SCHOLARPAD_TEST_FIRST_USE_NOTICE"] = #"{"version":1,"text":"已读说明","acknowledged":true}"#
        app.launchEnvironment["SCHOLARPAD_TEST_PREVIEW"] = #"{"type":"memoryPreview","id":"m","candidateId":"c","previewNonce":"n","tier":2,"childFacingText":"你试了画图","evidenceSummaryText":"这次你画了两条线","contestTarget":{"kind":"candidate","id":"c"}}"#
        app.launch()
        let buttons = ["record", "unsure", "disagree"].map { app.buttons["assent-\($0)"] }
        XCTAssertTrue(buttons[0].waitForExistence(timeout: 5))
        let evidence = app.staticTexts["memoryEvidenceSummary"]
        XCTAssertTrue(evidence.exists)
        for button in buttons {
            XCTAssertTrue(button.isHittable)
            XCTAssertEqual(button.frame.width, buttons[0].frame.width, accuracy: 1)
            XCTAssertEqual(button.frame.height, buttons[0].frame.height, accuracy: 1)
            XCTAssertLessThan(evidence.frame.maxY, button.frame.minY)
        }
        for title in ["我卡住了", "我做完了", "我想休息", "你理解错了"] {
            XCTAssertTrue(app.buttons[title].isHittable)
        }
        app.staticTexts["taskText"].tap()
        XCTAssertTrue(buttons[0].exists, "点卡片外不关闭，也不替孩子选择")
        app.buttons["我卡住了"].tap()
        XCTAssertTrue(buttons[0].exists)
        app.buttons["我想休息"].tap()
    }
}
