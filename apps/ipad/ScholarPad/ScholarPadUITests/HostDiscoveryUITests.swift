import XCTest

final class HostDiscoveryUITests: XCTestCase {
    @MainActor func testDiscoversFamilyHostWithoutStartingConversation() throws {
        guard ProcessInfo.processInfo.environment["AI_DTL_DISCOVERY_LIVE"] == "1" else { throw XCTSkip("需要真实 Bonjour 主机") }
        let app = XCUIApplication()
        app.launch()
        let status = app.staticTexts["workspaceDiscoveryStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label == '已发现学习主机'"), evaluatedWith: status)
        waitForExpectations(timeout: 25)
        let host = app.textFields["workspaceHost"]
        expectation(for: NSPredicate(format: "value CONTAINS '.local'"), evaluatedWith: host)
        waitForExpectations(timeout: 10)
        // 空白首页尚无语音按钮；有作品时必须仍处于未开麦状态。
        if app.buttons["workspaceVoice"].exists {
            XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话")
        }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "bonjour-verified-host"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
