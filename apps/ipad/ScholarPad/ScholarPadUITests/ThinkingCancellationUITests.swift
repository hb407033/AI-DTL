import XCTest

final class ThinkingCancellationUITests: XCTestCase {
    @MainActor func testRejectedReplyContinuesWithoutReconnectThenPauseAndReopen() throws {
        continueAfterFailure = false
        let host = ProcessInfo.processInfo.environment["AI_DTL_RECOVERY_TEST_HOST"] ?? "127.0.0.1"
        let port = ProcessInfo.processInfo.environment["AI_DTL_RECOVERY_TEST_PORT"] ?? "18792"
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE": "1", "AI_DTL_WORKSPACE_HOST": host,
            "AI_DTL_WORKSPACE_HTTP_PORT": port, "AI_DTL_WORKSPACE_AUDIO_URL": "http://\(host):\(port)/fixture/audio",
            "AI_DTL_RECOVERY_REPLAY": "1"]
        app.launchArguments = ["-workspaceHost", host]
        defer { app.terminate() }
        app.launch()
        let voice = app.buttons["workspaceVoice"]
        XCTAssertTrue(voice.waitForExistence(timeout: 15)); voice.tap()
        let status = app.staticTexts["workspaceVoiceStatus"]
        let failed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS '没想好'"), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [failed], timeout: 20), .completed, app.debugDescription)
        XCTAssertEqual(voice.label, "结束对话", "单轮失败不能要求重连")
        XCTAssertFalse(app.staticTexts["老师在想"].exists)
        let session = app.staticTexts["workspaceTestSession"].label
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "reply-rejected-conversation-still-open"; screenshot.lifetime = .keepAlways; add(screenshot)
        let replay = app.buttons["workspaceSyntheticVoice"]
        func nextTurn(_ number: Int) {
            if !replay.isHittable {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.9)).press(forDuration: 0.1,
                    thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.4)))
            }
            XCTAssertTrue(replay.isHittable, app.debugDescription); replay.tap()
            let completed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@ OR label CONTAINS '失败'", "续聊第\(number)轮完成"), object: app.staticTexts["workspaceValidationStatus"])
            XCTAssertEqual(XCTWaiter.wait(for: [completed], timeout: 25), .completed, app.debugDescription)
            XCTAssertEqual(app.staticTexts["workspaceValidationStatus"].label, "续聊第\(number)轮完成")
            XCTAssertEqual(app.staticTexts["workspaceTestSession"].label, session)
        }
        nextTurn(1); nextTurn(2)
        voice.tap()
        XCTAssertTrue(app.buttons["workspaceVoice"].waitForExistence(timeout: 5))
        XCTAssertNotEqual(voice.label, "结束对话")
        voice.tap()
        let resumed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == '结束对话'"), object: voice)
        XCTAssertEqual(XCTWaiter.wait(for: [resumed], timeout: 20), .completed)
        nextTurn(3)
        app.terminate()
        app.launchEnvironment.removeValue(forKey: "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE")
        app.launch()
        XCTAssertTrue(voice.waitForExistence(timeout: 15))
        XCTAssertNotEqual(voice.label, "结束对话", "重开不能自动开麦")
        XCTAssertEqual(app.staticTexts["workspaceTestSession"].label, session)
        voice.tap()
        let reopened = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == '结束对话'"), object: voice)
        XCTAssertEqual(XCTWaiter.wait(for: [reopened], timeout: 20), .completed)
        nextTurn(1)
        let final = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        final.name = "reply-recovery-continuous-pause-reopen"; final.lifetime = .keepAlways; add(final)
    }
    @MainActor func testThinkingCanCancelAndLateReplyDoesNotReopenIt() throws {
        continueAfterFailure = false
        let host = ProcessInfo.processInfo.environment["AI_DTL_THINKING_TEST_HOST"] ?? "127.0.0.1"
        let port = ProcessInfo.processInfo.environment["AI_DTL_THINKING_TEST_PORT"] ?? "18791"
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE": "1", "AI_DTL_WORKSPACE_HOST": host,
            "AI_DTL_WORKSPACE_HTTP_PORT": port, "AI_DTL_WORKSPACE_AUDIO_URL": "fixture-no-microphone"]
        app.launchArguments = ["-workspaceHost", host]
        app.launch()
        let button = app.buttons["workspaceVoice"]
        XCTAssertTrue(button.waitForExistence(timeout: 15))
        button.tap()
        let indicator = app.otherElements["workspaceThinkingIndicator"]
        let label = app.staticTexts["老师在想"]
        XCTAssertTrue(label.waitForExistence(timeout: 15))
        XCTAssertEqual(button.label, "先停一下")
        XCTAssertFalse(app.staticTexts["上次反馈已被你提出异议，不作为学习结论。"].exists,
            "占位的未交付反馈不是孩子提出异议")
        let waiting = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        waiting.name = "thinking-before-cancel"; waiting.lifetime = .keepAlways; add(waiting)
        button.tap()
        let cancelled = NSPredicate(format: "exists == false")
        expectation(for: cancelled, evaluatedWith: label)
        waitForExpectations(timeout: 4)
        XCTAssertFalse(indicator.exists)
        XCTAssertTrue(app.scrollViews["childCanvas"].exists)
        // 越过宿主12秒迟到回调，不能闪回思考态或播放未经确认的回复。
        // 单独等时不是断言；随后再断言稳定态，日志同时核对迟到回调确实发生。
        let delay = expectation(description: "wait for fixture's late result")
        DispatchQueue.main.asyncAfter(deadline: .now() + 13) { delay.fulfill() }
        wait(for: [delay], timeout: 16)
        XCTAssertFalse(label.exists)
        XCTAssertNotEqual(button.label, "先停一下")
        XCTAssertFalse(app.staticTexts["你想先从哪里试试？"].exists)
        let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        after.name = "thinking-cancelled-after-late-result"; after.lifetime = .keepAlways; add(after)
    }
}
