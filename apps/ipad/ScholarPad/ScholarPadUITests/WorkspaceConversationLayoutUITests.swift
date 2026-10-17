import XCTest

final class WorkspaceConversationLayoutUITests: XCTestCase {
    @MainActor func testMissingRestoredWorkOffersHostSettingsInsteadOfEndlessRetry() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_HOST": "hb-mini.local", "AI_DTL_WORKSPACE_HTTP_PORT": "8797",
            "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE": "1"]
        defer { app.terminate() }
        app.launch()
        let voice = app.buttons["workspaceVoice"]
        XCTAssertTrue(voice.waitForExistence(timeout: 15))
        voice.tap()
        let recovery = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == '检查主机'"), object: voice)
        XCTAssertEqual(XCTWaiter.wait(for: [recovery], timeout: 15), .completed)
        XCTAssertTrue(app.staticTexts["workspaceVoiceStatus"].label.contains("当前主机没有这份作品"))
        XCTAssertTrue(voice.isHittable)
        XCTAssertTrue(app.buttons["workspaceCamera"].isEnabled)
        voice.tap()
        XCTAssertTrue(app.textFields["workspaceHost"].waitForExistence(timeout: 10))
        app.buttons["workspaceParentSettingsClose"].tap()
        XCTAssertTrue(app.scrollViews["childCanvas"].exists)
        XCTAssertEqual(voice.label, "一起聊聊", "检查主机返回后应允许重新连接，不能一直打开设置")
        let proof = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        proof.name = "missing-old-work-actionable-host-recovery"; proof.lifetime = .keepAlways; add(proof)
    }
    @MainActor func testLongConversationDoesNotMoveControlsAndActionsHaveEqualTargets() throws {
        continueAfterFailure = false
        defer { XCUIDevice.shared.orientation = .portrait }
        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
            XCUIDevice.shared.orientation = orientation
            var baseline: [CGRect] = []
            for preview in ["short", "long"] {
                let app = XCUIApplication()
                app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
                    "AI_DTL_WORKSPACE_HOST": "127.0.0.1", "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE": "1",
                    "AI_DTL_WORKSPACE_CHAT_PREVIEW": preview]
                app.launch()
                XCTAssertTrue(app.scrollViews["workspaceConversation"].waitForExistence(timeout: 10), "聊天必须在独立限高滚动区域中")
                let ids = ["workspaceVoice", "workspaceCorrect"]
                XCTAssertFalse(app.buttons["workspaceSave"].exists, "保存和记录应收进次要入口，不能挤占儿童主流程")
                XCTAssertFalse(app.buttons["workspaceClarify"].exists, "自然交流不要求孩子先选权限按钮")
                let frames = ids.map { app.buttons[$0].frame }
                for (index, id) in ids.enumerated() {
                    XCTAssertTrue(app.buttons[id].isHittable, id)
                    XCTAssertEqual(frames[index].height, frames[0].height, accuracy: 1)
                    XCTAssertEqual(frames[index].width, frames[0].width, accuracy: 1)
                    XCTAssertGreaterThanOrEqual(frames[index].height, 44)
                }
                if preview == "short" { baseline = frames }
                else {
                    for index in frames.indices {
                        XCTAssertEqual(frames[index].minY, baseline[index].minY, accuracy: 1, "聊天长度不应移动按钮")
                    }
                    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                    attachment.name = "stable-conversation-\(orientation.rawValue)"; attachment.lifetime = .keepAlways; add(attachment)
                }
                app.terminate()
            }
        }
    }
}
