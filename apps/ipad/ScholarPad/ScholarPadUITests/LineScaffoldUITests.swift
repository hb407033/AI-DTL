import XCTest

final class LineScaffoldUITests: XCTestCase {
    @MainActor func testVoiceHelpDrawingAndIndependentContinuation() throws {
        guard let host = ProcessInfo.processInfo.environment["AI_DTL_TEST_HOST"] else { throw XCTSkip("需要隔离辅助图宿主") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString, "AI_DTL_WORKSPACE_HOST": host,
            "AI_DTL_WORKSPACE_AUDIO_URL": "http://\(host):8791/test-line-audio", "AI_DTL_LINE_LOOP": "1"]
        app.launch()
        XCTAssertTrue(app.buttons["workspacePortfolio"].waitForExistence(timeout: 10))
        app.buttons["workspacePortfolio"].tap()
        let work = app.buttons["portfolioRemote-line-ui-voice"]
        XCTAssertTrue(work.waitForExistence(timeout: 15)); work.tap()
        let canvas = app.scrollViews["childCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 15))
        func reveal(_ element: XCUIElement) {
            for _ in 0..<12 {
                if element.isHittable { return }
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.75)).press(forDuration: 0.05,
                    thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.45)))
            }
            XCTAssertTrue(element.isHittable)
        }
        func drawStroke(vertical: Bool) {
            let frame = canvas.frame
            let viewport = CGRect(x: app.frame.minX, y: app.frame.minY + 140,
                width: app.frame.width, height: app.frame.height - 164)
            let visible = frame.intersection(viewport)
            XCTAssertGreaterThan(visible.width, 80); XCTAssertGreaterThan(visible.height, 80)
            let start = CGPoint(x: visible.minX + visible.width * (vertical ? 0.4 : 0.2), y: visible.minY + visible.height * 0.3)
            let end = CGPoint(x: visible.minX + visible.width * (vertical ? 0.4 : 0.75), y: visible.minY + visible.height * (vertical ? 0.7 : 0.3))
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: start.x, dy: start.y)).press(forDuration: 0.1,
                thenDragTo: origin.withOffset(CGVector(dx: end.x, dy: end.y)))
        }
        reveal(canvas)
        drawStroke(vertical: false)
        XCTAssertEqual(canvas.value as? String, "1")
        let run = app.buttons["workspaceSyntheticVoice"]
        reveal(run); run.tap()
        let status = app.staticTexts["workspaceValidationStatus"]
        expectation(for: NSPredicate(format: "label == '语音求助邀请已到达' OR label CONTAINS '失败'"), evaluatedWith: status)
        waitForExpectations(timeout: 150)
        XCTAssertEqual(status.label, "语音求助邀请已到达")
        let consent = app.buttons["scaffoldConsent"]
        for _ in 0..<12 {
            if consent.isHittable { break }
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.4)).press(forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.7)))
        }
        XCTAssertTrue(consent.isHittable); consent.tap()
        let part = app.buttons["scaffoldPart0"]
        XCTAssertTrue(part.waitForExistence(timeout: 50)); part.tap()
        expectation(for: NSPredicate(format: "label CONTAINS '1 / 2'"), evaluatedWith: app.staticTexts["scaffoldSelection"])
        waitForExpectations(timeout: 10)
        XCTAssertEqual(canvas.value as? String, "1", "老师提示不能改动原始笔迹")
        let selected = XCTAttachment(screenshot: app.screenshot()); selected.name = "voice-help-real-line"; selected.lifetime = .keepAlways; add(selected)
        app.buttons["scaffoldHide"].tap()
        reveal(canvas)
        drawStroke(vertical: true)
        expectation(for: NSPredicate(format: "value == '2'"), evaluatedWith: canvas)
        waitForExpectations(timeout: 5)
        XCTAssertEqual(canvas.value as? String, "2", "隐藏后继续写画")
        reveal(run); run.tap()
        expectation(for: NSPredicate(format: "label == '隐藏后独立表达已保存' OR label CONTAINS '失败'"), evaluatedWith: status)
        waitForExpectations(timeout: 150)
        XCTAssertEqual(status.label, "隐藏后独立表达已保存")
        app.terminate(); app.launch()
        XCTAssertTrue(canvas.waitForExistence(timeout: 15)); XCTAssertEqual(canvas.value as? String, "2")
        XCTAssertFalse(app.buttons["scaffoldPart0"].exists)
        XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话")
    }
    @MainActor func testConsentSelectHideAndCorrectionOnDevice() throws {
        guard let host = ProcessInfo.processInfo.environment["AI_DTL_TEST_HOST"] else { throw XCTSkip("需要隔离辅助图宿主") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString, "AI_DTL_WORKSPACE_HOST": host]
        app.launch()
        func open(_ work: String) {
            let portfolio = app.buttons["workspacePortfolio"]
            for _ in 0..<6 { if portfolio.isHittable { break }; app.swipeDown() }
            XCTAssertTrue(portfolio.waitForExistence(timeout: 10)); portfolio.tap()
            let item = app.buttons["portfolioRemote-\(work)"]
            XCTAssertTrue(item.waitForExistence(timeout: 15)); item.tap()
            XCTAssertTrue(app.buttons["scaffoldConsent"].waitForExistence(timeout: 15))
        }
        open("line-ui-hide")
        XCTAssertFalse(app.buttons["scaffoldPart0"].exists, "同意前不能出现图形")
        app.buttons["scaffoldConsent"].tap()
        let part = app.buttons["scaffoldPart0"]
        XCTAssertTrue(part.waitForExistence(timeout: 50)); part.tap()
        let selected = app.staticTexts["scaffoldSelection"]
        expectation(for: NSPredicate(format: "label CONTAINS '1 / 2'"), evaluatedWith: selected)
        waitForExpectations(timeout: 15)
        XCTAssertTrue(selected.label.contains("1/2 升"))
        let proof = XCTAttachment(screenshot: app.screenshot()); proof.name = "real-qwen-line-native-selection"; proof.lifetime = .keepAlways; add(proof)
        app.buttons["scaffoldHide"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: part)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.scrollViews["childCanvas"].exists)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["workspaceVoice"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话")
        XCTAssertFalse(app.buttons["scaffoldPart0"].exists)
        open("line-ui-correct")
        app.buttons["scaffoldConsent"].tap()
        // 撤销不等待模型生成，检验迟到结果不能复活。
        app.buttons["scaffoldCorrect"].tap()
        XCTAssertFalse(app.buttons["scaffoldPart0"].exists)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["workspaceVoice"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["scaffoldConsent"].exists)
        XCTAssertFalse(app.buttons["scaffoldPart0"].exists)
        let end = XCTAttachment(screenshot: app.screenshot()); end.name = "revoked-line-reopened-without-microphone"; end.lifetime = .keepAlways; add(end)
    }
}
