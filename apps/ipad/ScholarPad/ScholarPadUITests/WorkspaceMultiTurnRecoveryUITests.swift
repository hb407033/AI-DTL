import XCTest
import UIKit

/// 手动运行的真模型验收：先将旧草稿副本放入下列隔离缓存，并在 mini 的 8797 端口准备同作品和 0...4.pcm。
/// 不注入老师回复、不访问家庭缓存；只替代孩子的麦克风输入。
final class WorkspaceMultiTurnRecoveryUITests: XCTestCase {
    @MainActor func testSameOldWorkFiveChildTurnsAcrossPauseAndProcessRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = [
            "AI_DTL_WORKSPACE_TEST_ID": "CA8D6C27-9116-48BB-97A7-D91787A42938",
            "AI_DTL_WORKSPACE_HOST": "hb-mini.local", "AI_DTL_WORKSPACE_HTTP_PORT": "8797",
            "AI_DTL_WORKSPACE_AUDIO_URL": "http://hb-mini.local:8797/fixture/audio",
            "AI_DTL_RECOVERY_REPLAY": "1"
        ]
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        let statement = app.staticTexts["workspaceStatement"]
        XCTAssertTrue(statement.waitForExistence(timeout: 15), app.debugDescription)
        let original = statement.label
        let session = app.staticTexts["workspaceTestSession"].label
        let canvas = app.scrollViews["childCanvas"]
        let originalStrokes = canvas.value as? String
        let voice = app.buttons["workspaceVoice"]
        var revision = Int(app.staticTexts["workspaceTestRevision"].label) ?? -1
        XCTAssertGreaterThanOrEqual(revision, 0)

        func waitForVoice(_ title: String) {
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", title), object: voice)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 90), .completed,
                "\(app.staticTexts["workspaceVoiceStatus"].label)\n\(app.debugDescription)")
        }
        func checkWork(_ checkpoint: String) {
            XCTAssertEqual(statement.label, original)
            XCTAssertEqual(app.staticTexts["workspaceTestSession"].label, session)
            XCTAssertEqual(canvas.value as? String, originalStrokes)
            let next = Int(app.staticTexts["workspaceTestRevision"].label) ?? -1
            XCTAssertGreaterThanOrEqual(next, revision, "恢复不能退回旧版本")
            revision = next
            let proof = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            proof.name = checkpoint; proof.lifetime = .keepAlways; add(proof)
        }
        func childTurn(_ index: Int) {
            let replay = app.buttons["workspaceSyntheticVoice"]
            if !replay.isHittable {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.88)).press(forDuration: 0.1,
                    thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.40)))
            }
            XCTAssertTrue(replay.isHittable, app.debugDescription)
            replay.tap()
            let status = app.staticTexts["workspaceValidationStatus"]
            let expected = "续聊第\(index + 1)轮完成"
            let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@ OR label CONTAINS %@", expected, "失败"), object: status)
            XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 100), .completed,
                "\(status.label)\n\(app.staticTexts["workspaceVoiceStatus"].label)\n\(app.debugDescription)")
            XCTAssertEqual(status.label, expected, app.staticTexts["workspaceVoiceStatus"].label)
            XCTAssertEqual(voice.label, "结束对话", "老师播完仍须连接，不能每轮重开")
            checkWork("same-work-child-turn-\(index + 1)")
        }

        XCTAssertEqual(voice.label, "一起聊聊", "恢复作品不得自动开麦")
        voice.tap(); waitForVoice("结束对话")
        childTurn(0) // 不会，主动求助。
        childTurn(1) // 只把除数扩大十倍，错误想法。
        voice.tap(); waitForVoice("一起聊聊")
        checkWork("same-work-paused-after-two-child-turns")
        voice.tap(); waitForVoice("结束对话")
        childTurn(2) // 换思路，两个数同时扩大十倍。

        // 不先按暂停，直接结束进程；不能只证明已主动保存后的冷启动。
        app.terminate()
        app.launchEnvironment["AI_DTL_RECOVERY_AUDIO_OFFSET"] = "3"
        app.launch()
        XCTAssertTrue(statement.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(voice.label, "一起聊聊")
        XCTAssertTrue(app.staticTexts["workspaceRestoredFeedback"].exists, "重开应能看到上次讨论")
        checkWork("same-work-reopened-without-explicit-pause")
        voice.tap(); waitForVoice("结束对话")
        childTurn(3) // 商的数位算错。
        childTurn(4) // 自行改正并检验。
        voice.tap(); waitForVoice("一起聊聊")
        checkWork("same-work-final-paused")
        app.terminate(); app.launch()
        XCTAssertTrue(statement.waitForExistence(timeout: 15))
        XCTAssertEqual(voice.label, "一起聊聊")
        checkWork("same-work-final-reopened")
    }
}
