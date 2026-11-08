import XCTest

final class RealtimeModeUITests: XCTestCase {
    func testRealtimeModeShowsListeningThenSpeakingAndPlaysWithinBudget() {
        let port = ProcessInfo.processInfo.environment["AI_DTL_REALTIME_FAKE_PORT"] ?? "8799"
        let app = XCUIApplication()
        app.launchEnvironment = [
            "AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE": "1",
            "AI_DTL_WORKSPACE_HOST": "127.0.0.1",
            "AI_DTL_REALTIME_FAKE_URL": "ws://127.0.0.1:\(port)",
            "AI_DTL_REALTIME_AUTOTURN": "1",
        ]
        app.launch()
        let voice = app.buttons["workspaceVoice"]
        XCTAssertTrue(voice.waitForExistence(timeout: 15))
        voice.tap()
        let phase = app.staticTexts["workspaceVoicePhase"]
        XCTAssertTrue(phase.waitForExistence(timeout: 15))
        let listening = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "正在听你说"), object: phase)
        XCTAssertEqual(XCTWaiter().wait(for: [listening], timeout: 20), .completed)
        let speaking = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "老师在说话"), object: phase)
        XCTAssertEqual(XCTWaiter().wait(for: [speaking], timeout: 20), .completed)
        let status = app.staticTexts["workspaceVoiceStatus"]
        XCTAssertFalse(status.label.contains("没听清"))
    }
}
