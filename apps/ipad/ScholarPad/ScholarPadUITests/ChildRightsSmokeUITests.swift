import XCTest

/// 固定 HTTP 响应的 UI 验证；真实网络请求另由 ChildLedgerTests 验证。
final class ChildRightsSmokeUITests: XCTestCase {
    @MainActor
    func testCompletedSessionStillAllowsContestAndDeletionRequest() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-session"]
        app.launchEnvironment["SCHOLARPAD_TEST_PHASE"] = "COMPLETED"
        app.launchEnvironment["SCHOLARPAD_TEST_FIRST_USE_NOTICE"] = #"{"version":1,"text":"已读说明","acknowledged":true}"#
        let responses = [
            "understanding": #"{"myQuestions":[],"myExplorations":[],"myArtifacts":[],"myCorrectedGuesses":[],"myNewMethods":[],"activeGuesses":[],"scaffoldLine":"这些理解可以修改","records":[{"recordId":"r","text":"你试了画图","contestTarget":{"kind":"record","id":"r"},"canRequestDeletion":true}],"deletionRequests":[],"firstUseAcknowledged":true}"#,
            "contest": #"{"ok":true}"#,
            "deletion-preview": #"{"preview":{"records":1},"text":"会影响这一条记录","previewComputedAt":123}"#,
            "deletion-requests": #"{"requestId":"d","preview":{"records":1}}"#,
        ]
        app.launchEnvironment["SCHOLARPAD_TEST_CHILD_LEDGER"] = String(decoding: try JSONEncoder().encode(responses), as: UTF8.self)
        app.launch()
        app.buttons["openChildUnderstanding"].tap()
        XCTAssertTrue(app.buttons["不是这样"].waitForExistence(timeout: 5))
        app.buttons["不是这样"].tap()
        XCTAssertTrue(app.staticTexts["childLedgerFeedback"].waitForExistence(timeout: 5))
        app.buttons["请删掉"].tap()
        XCTAssertTrue(app.staticTexts["deletionPreviewText"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["deletionPreviewText"].label, "会影响这一条记录")
        app.buttons["请家长一起决定"].tap()
        XCTAssertTrue(app.staticTexts["childLedgerFeedback"].label.contains("还没有删除"))
    }

    @MainActor
    func testUnacknowledgedNoticeKeepsCanvasUsableAndHidesAssent() {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-session"]
        app.launchEnvironment["SCHOLARPAD_TEST_FIRST_USE_NOTICE"] = #"{"version":1,"text":"系统会猜测你在哪一步卡住，家长也能看到。你可以说不是这样。","acknowledged":false}"#
        app.launchEnvironment["SCHOLARPAD_TEST_PREVIEW"] = #"{"type":"memoryPreview","id":"m","candidateId":"c","previewNonce":"n","tier":2,"childFacingText":"你试了画图","evidenceSummaryText":"这次你画了两条线","contestTarget":{"kind":"candidate","id":"c"}}"#
        app.launch()
        XCTAssertTrue(app.staticTexts["firstUseNoticeText"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["firstUseNoticeAcknowledge"].exists)
        XCTAssertFalse(app.buttons["assent-record"].exists)
        XCTAssertTrue(app.buttons["我卡住了"].isHittable)
        XCTAssertTrue(app.buttons["我想休息"].isHittable)
        XCTAssertTrue(app.descendants(matching: .any)["childCanvas"].exists)
    }
}
