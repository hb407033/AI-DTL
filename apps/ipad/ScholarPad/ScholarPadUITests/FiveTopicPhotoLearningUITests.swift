import XCTest
import UIKit

/// 实机、真实识图/教学/语音，孩子输入由外部验收控制器根据老师刚才的实际回应逐轮生成。
final class FiveTopicPhotoLearningUITests: XCTestCase {
    @MainActor func test01Multiplication() throws {
        try runCase("multiply", unit: "小数乘法", question: "每千克苹果3.6元，买0.4千克要多少元？",
            work: "3.6 × 0.4 = 14.4（元）", required: ["3.6", "0.4", "苹果"], forbidden: "14.4")
    }
    @MainActor func test02Division() throws {
        try runCase("divide", unit: "小数除法", question: "一根长5.4米的彩带，每段0.6米，可以剪成几段？",
            work: "", required: ["5.4", "0.6", "彩带"])
    }
    @MainActor func test03Equation() throws {
        try runCase("equation", unit: "简易方程", question: "一本故事书x元，买3本，付50元，找回8元。每本故事书多少元？",
            work: "3x = 50 + 8", required: ["3", "50", "8", "故事书"])
    }
    @MainActor func test04Area() throws {
        try runCase("area", unit: "多边形的面积", question: "一块平行四边形花坛，底8米，高3米，斜边5米。面积是多少平方米？",
            work: "8 × 5 = 40（平方米）", required: ["8", "3", "5", "平行四边形"], forbidden: "40")
    }
    @MainActor func test05Planting() throws {
        try runCase("planting", unit: "数学广角——植树问题", question: "在一条长60米的小路一侧，每隔5米栽一棵树，两端都栽。一共要栽多少棵树？",
            work: "", required: ["60", "5", "两端"])
    }
    @MainActor private func runCase(_ caseID: String, unit: String, question: String, work: String,
                                    required: [String], forbidden: String? = nil) throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 900, height: 650)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 900, height: 650))
            ("五年级上册 数学练习" as NSString).draw(at: CGPoint(x: 45, y: 35),
                withAttributes: [.font: UIFont.systemFont(ofSize: 28), .foregroundColor: UIColor.darkGray])
            (question as NSString).draw(in: CGRect(x: 45, y: 110, width: 810, height: 200),
                withAttributes: [.font: UIFont.systemFont(ofSize: 36), .foregroundColor: UIColor.black])
            if !work.isEmpty {
                ("我的解答：" as NSString).draw(at: CGPoint(x: 60, y: 340),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 27), .foregroundColor: UIColor.systemBlue])
                (work as NSString).draw(at: CGPoint(x: 60, y: 410),
                    withAttributes: [.font: UIFont.italicSystemFont(ofSize: 42), .foregroundColor: UIColor.systemBlue])
            }
        }
        let cacheID = UUID().uuidString
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": cacheID,
            "AI_DTL_WORKSPACE_HOST": "hb-mini.local", "AI_DTL_WORKSPACE_HTTP_PORT": "8797",
            "AI_DTL_WORKSPACE_UNIT": unit, "AI_DTL_WORKSPACE_PHOTO": try XCTUnwrap(image.pngData()).base64EncodedString(),
            "AI_DTL_WORKSPACE_AUDIO_URL": "http://hb-mini.local:8797/harness/audio",
            "AI_DTL_ADAPTIVE_PHOTO_CASE": caseID]
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft; app.launch()
        let statement = app.staticTexts["workspaceStatement"]
        let recognized = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            statement.exists || app.buttons["workspaceCandidate-0"].exists
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [recognized], timeout: 75), .completed, app.debugDescription)
        if app.buttons["workspaceCandidate-0"].exists { app.buttons["workspaceCandidate-0"].tap() }
        XCTAssertTrue(statement.waitForExistence(timeout: 75), app.debugDescription)
        for token in required { XCTAssertTrue(statement.label.contains(token), statement.label) }
        if let forbidden { XCTAssertFalse(statement.label.contains(forbidden), "不能把孩子错答当作题干：\(statement.label)") }
        let originalStatement = statement.label
        XCTAssertFalse(app.scrollViews["childCanvas"].exists, "确认前不进入讲解")
        let photo = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        photo.name = "\(caseID)-photo-recognized-awaiting-confirmation"; photo.lifetime = .keepAlways; add(photo)
        app.buttons["workspaceConfirm"].tap()
        let canvas = app.scrollViews["childCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 15), app.debugDescription)
        let voice = app.buttons["workspaceVoice"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == '结束对话' OR label == '重试对话'"), object: voice)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 90), .completed, app.debugDescription)
        XCTAssertEqual(voice.label, "结束对话", app.staticTexts["workspaceVoiceStatus"].label)
        let replay = app.buttons["workspaceSyntheticVoice"]
        if !replay.isHittable {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.9)).press(forDuration: 0.1,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.4)))
        }
        XCTAssertTrue(replay.isHittable, app.debugDescription); replay.tap()
        let status = app.staticTexts["workspaceValidationStatus"]
        func waitForStatus(_ label: String) {
            let waiting = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@ OR label CONTAINS '失败' OR label CONTAINS '未通过'", label), object: status)
            XCTAssertEqual(XCTWaiter.wait(for: [waiting], timeout: 900), .completed, app.debugDescription)
            XCTAssertEqual(status.label, label, app.staticTexts["workspaceVoiceStatus"].label)
        }
        func waitForVoice(_ label: String) {
            let waiting = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", label), object: voice)
            XCTAssertEqual(XCTWaiter.wait(for: [waiting], timeout: 90), .completed, app.staticTexts["workspaceVoiceStatus"].label)
        }
        let initialSession = app.staticTexts["workspaceTestSession"].label
        waitForStatus("等待模拟孩子第3轮")
        voice.tap(); waitForVoice("一起聊聊")
        XCTAssertEqual(app.staticTexts["workspaceTestSession"].label, initialSession)
        voice.tap(); waitForVoice("结束对话")
        // 控制器等到真实续聊开场后才上传第3段；回放不会替 UI 自动重连。
        waitForStatus("等待模拟孩子第4轮")
        let beforeRestart = Int(app.staticTexts["workspaceTestRevision"].label) ?? -1
        app.terminate()
        app.launchEnvironment["AI_DTL_ADAPTIVE_PHOTO_OFFSET"] = "3"
        app.launch()
        XCTAssertTrue(statement.waitForExistence(timeout: 15))
        XCTAssertEqual(statement.label, originalStatement)
        XCTAssertEqual(app.staticTexts["workspaceTestSession"].label, initialSession)
        XCTAssertGreaterThanOrEqual(Int(app.staticTexts["workspaceTestRevision"].label) ?? -1, beforeRestart)
        XCTAssertEqual(voice.label, "一起聊聊", "退出重开不能自动开麦")
        XCTAssertTrue(app.staticTexts["workspaceRestoredFeedback"].exists)
        voice.tap(); waitForVoice("结束对话")
        if !replay.isHittable {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.9)).press(forDuration: 0.1,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.4)))
        }
        replay.tap()
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == '逐题讨论已保存' OR label CONTAINS '失败' OR label CONTAINS '未通过'"), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 900), .completed, app.debugDescription)
        XCTAssertEqual(status.label, "逐题讨论已保存", app.staticTexts["workspaceVoiceStatus"].label)
        let sessionID = app.staticTexts["workspaceTestSession"].label
        let revision = app.staticTexts["workspaceTestRevision"].label
        let final = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        final.name = "\(caseID)-adaptive-discussion-saved"; final.lifetime = .keepAlways; add(final)
        app.terminate(); app.launch()
        XCTAssertTrue(statement.waitForExistence(timeout: 15))
        XCTAssertEqual(statement.label, originalStatement)
        XCTAssertEqual(app.staticTexts["workspaceTestSession"].label, sessionID)
        XCTAssertEqual(app.staticTexts["workspaceTestRevision"].label, revision)
        XCTAssertEqual(voice.label, "一起聊聊")
        XCTAssertTrue(app.staticTexts["workspaceRestoredFeedback"].exists)
    }
}
