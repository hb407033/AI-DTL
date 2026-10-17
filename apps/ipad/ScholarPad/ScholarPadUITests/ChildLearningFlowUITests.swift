import XCTest
import UIKit

/// 真实设备、HTTP/WS、PencilKit 快照、Qwen 图片理解及语音；只合成题照和孩子音频。
final class ChildLearningFlowUITests: XCTestCase {
    @MainActor func testDecimalDivisionDecisionAndSpeechLoop() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let sessionID = UUID().uuidString
        let image = UIGraphicsImageRenderer(size: CGSize(width: 640, height: 480)).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 640, height: 480))
            ("12.5 ÷ 0.5 =\n先估一估，再计算，并检验。" as NSString).draw(at: CGPoint(x: 35, y: 65),
                withAttributes: [.font: UIFont.systemFont(ofSize: 32), .foregroundColor: UIColor.black])
        }
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": sessionID,
            "AI_DTL_WORKSPACE_HOST": "macbookpro.local", "AI_DTL_WORKSPACE_UNIT": "小数除法",
            "AI_DTL_WORKSPACE_HTTP_PORT": "8797", "AI_DTL_WORKSPACE_AUDIO_URL": "http://macbookpro.local:8797/fixture/audio",
            "AI_DTL_DIALOGUE_LOOP": "1", "AI_DTL_DIALOGUE_TURNS": "5", "AI_DTL_DECISION_VERDICT": "1",
            "AI_DTL_WORKSPACE_PHOTO": try XCTUnwrap(image.pngData()).base64EncodedString()]
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft; app.launch()
        // 启动时模拟器可能恢复上次竖屏；确认实际窗口旋转完成后再计算画布坐标。
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.windows.firstMatch.frame
            return frame.width > frame.height
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 10), .completed,
            "横屏窗口未就绪：\(app.debugDescription)")
        let statement = app.staticTexts["workspaceStatement"]
        XCTAssertTrue(statement.waitForExistence(timeout: 60), app.debugDescription)
        XCTAssertTrue(statement.label.contains("12.5"), statement.label)
        app.buttons["workspaceConfirmIndependent"].tap()
        let canvas = app.scrollViews["childCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 15))
        func stroke(_ x: Double, _ y: Double, _ ex: Double, _ ey: Double) {
            canvas.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).press(forDuration: 0.05,
                thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: ex, dy: ey)))
        }
        // 以真实 PencilKit 手势写125÷5=205；不把解法塞进照片或解释字段。
        let segments: [(Double, Double, Double, Double)] = [(0, 0, 1, 0), (1, 0, 1, 1), (1, 1, 1, 2),
            (0, 2, 1, 2), (0, 1, 0, 2), (0, 0, 0, 1), (0, 1, 1, 1)]
        let patterns = ["1": [1, 2], "2": [0, 1, 6, 4, 3], "5": [0, 5, 6, 2, 3], "0": [0, 1, 2, 3, 4, 5]]
        for (index, symbol) in ["1", "2", "5", "÷", "5", "=", "2", "0", "5"].enumerated() {
            let x = 0.08 + Double(index) * 0.085, y = 0.23, w = 0.055, h = 0.065
            if let shape = patterns[symbol] {
                for s in shape { let p = segments[s]; stroke(x + p.0*w, y + p.1*h, x + p.2*w, y + p.3*h) }
            } else if symbol == "÷" {
                stroke(x, y+h, x+w, y+h); stroke(x+w/2, y+0.02, x+w/2+0.002, y+0.022)
                stroke(x+w/2, y+2*h-0.02, x+w/2+0.002, y+2*h-0.018)
            } else { stroke(x, y+0.7*h, x+w, y+0.7*h); stroke(x, y+1.3*h, x+w, y+1.3*h) }
        }
        XCTAssertGreaterThan(Int(canvas.value as? String ?? "0") ?? 0, 0)
        let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); before.name = "division-125-divide-5-equals-205"
        before.lifetime = .keepAlways; add(before)
        app.buttons["workspaceVoice"].tap()
        let synthetic = app.buttons["workspaceSyntheticVoice"]
        if !synthetic.isHittable {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.88)).press(forDuration: 0.1,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.43)))
        }
        XCTAssertTrue(synthetic.isHittable, app.debugDescription); synthetic.tap()
        let status = app.staticTexts["workspaceValidationStatus"]
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "拍照学习讨论已保存"), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 240), .completed, "\(status.label)\n\(app.debugDescription)")
        // 完成状态同时要求应用按实际作品ID核对服务器决策，不能只看收到了6条话。
        XCTAssertGreaterThan(Int(canvas.value as? String ?? "0") ?? 0, 0)
        let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); after.name = "division-reason-correct-check-handoff"
        after.lifetime = .keepAlways; add(after)
    }
    @MainActor func testConfirmAndDiscussDoesNotRequireAnotherVoiceButton() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 640, height: 480)).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 640, height: 480))
            ("每米彩带2.4元，买0.3米需要多少元？" as NSString).draw(at: CGPoint(x: 30, y: 70),
                withAttributes: [.font: UIFont.systemFont(ofSize: 24), .foregroundColor: UIColor.black])
        }
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_HOST": "macbookpro.local", "AI_DTL_WORKSPACE_HTTP_PORT": "8797",
            "AI_DTL_WORKSPACE_AUDIO_URL": "http://macbookpro.local:8797/fixture/audio",
            "AI_DTL_WORKSPACE_PHOTO": try XCTUnwrap(image.pngData()).base64EncodedString()]
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        let confirm = app.buttons["workspaceConfirm"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 60), app.debugDescription)
        XCTAssertEqual(confirm.label, "题目没问题，一起聊聊")
        confirm.tap()
        XCTAssertTrue(app.scrollViews["childCanvas"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.scrollViews["workspaceConversation"].staticTexts["老师"].waitForExistence(timeout: 60),
            "确认并讨论应自动收到老师开场，无需再点语音按钮：\(app.debugDescription)")
        let proof = XCTAttachment(screenshot: app.screenshot())
        proof.name = "one-confirm-starts-discussion"; proof.lifetime = .keepAlways; add(proof)
    }

    @MainActor func testPhotoInkAndContinuousDiscussion() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 640, height: 480)).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 640, height: 480))
            ("每米彩带2.4元，\n买0.3米需要多少元？" as NSString).draw(at: CGPoint(x: 30, y: 70),
                withAttributes: [.font: UIFont.systemFont(ofSize: 34), .foregroundColor: UIColor.black])
        }
        app.launchEnvironment = [
            "AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_HOST": "macbookpro.local", "AI_DTL_WORKSPACE_UNIT": "小数乘法",
            "AI_DTL_WORKSPACE_HTTP_PORT": "8797", "AI_DTL_WORKSPACE_AUDIO_URL": "http://macbookpro.local:8797/fixture/audio",
            "AI_DTL_DIALOGUE_LOOP": "1", "AI_DTL_WORKSPACE_PHOTO": try XCTUnwrap(image.pngData()).base64EncodedString()
        ]
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        let statement = app.staticTexts["workspaceStatement"]
        XCTAssertTrue(statement.waitForExistence(timeout: 60), app.debugDescription)
        XCTAssertTrue(statement.label.contains("0.3"), statement.label)
        XCTAssertFalse(app.scrollViews["childCanvas"].exists)
        // 明确选择先独立尝试，随后才主动叫老师；确认题意本身不打开麦克风。
        app.buttons["workspaceConfirmIndependent"].tap()
        let canvas = app.scrollViews["childCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 15))
        func stroke(_ x: Double, _ y: Double, _ ex: Double, _ ey: Double) {
            canvas.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).press(forDuration: 0.1,
                thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: ex, dy: ey)))
        }
        // 真正经 PencilKit 生成 7.2 笔迹，而非把答案写进解释字符串。
        stroke(0.18, 0.20, 0.28, 0.20); stroke(0.28, 0.20, 0.20, 0.40)
        stroke(0.33, 0.39, 0.335, 0.395)
        stroke(0.39, 0.20, 0.49, 0.20); stroke(0.49, 0.20, 0.49, 0.29)
        stroke(0.49, 0.29, 0.39, 0.40); stroke(0.39, 0.40, 0.50, 0.40)
        XCTAssertGreaterThan(Int(canvas.value as? String ?? "0") ?? 0, 0)
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "child-7.2-before-teacher"; before.lifetime = .keepAlways; add(before)
        app.buttons["workspaceVoice"].tap()
        let synthetic = app.buttons["workspaceSyntheticVoice"]
        if !synthetic.isHittable {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.88))
                .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.43)))
        }
        XCTAssertTrue(synthetic.isHittable, app.debugDescription)
        synthetic.tap()
        let status = app.staticTexts["workspaceValidationStatus"]
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "拍照学习讨论已保存"), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 180), .completed, "\(status.label)\n\(app.debugDescription)")
        XCTAssertGreaterThan(Int(canvas.value as? String ?? "0") ?? 0, 0, "讨论后保留独立笔迹")
        let after = XCTAttachment(screenshot: app.screenshot())
        after.name = "photo-ink-discussion-saved"; after.lifetime = .keepAlways; add(after)
    }
}
