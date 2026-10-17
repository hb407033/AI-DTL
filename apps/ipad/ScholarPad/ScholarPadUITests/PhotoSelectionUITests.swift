import XCTest
import UIKit

/// 真 HTTP 路由；测试主机可接合成或真实识别器，不写家庭草稿。
final class PhotoSelectionUITests: XCTestCase {
    @MainActor func testMultipleSelectionRestartEditAndConfirm() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 640, height: 480))
        let image = renderer.image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 640, height: 480))
            ("1. 2.4×0.3=?\n\n2. 3.6÷0.4=?" as NSString).draw(at: CGPoint(x: 30, y: 40), withAttributes: [.font: UIFont.systemFont(ofSize: 32), .foregroundColor: UIColor.black])
        }
        app.launchEnvironment = [
            "AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_HOST": "macbookpro.local",
            "AI_DTL_WORKSPACE_UNIT": "小数乘法",
            "AI_DTL_WORKSPACE_HTTP_PORT": "8797",
            "AI_DTL_WORKSPACE_PHOTO": try XCTUnwrap(image.pngData()).base64EncodedString()
        ]
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        XCTAssertFalse(app.navigationBars["AI-DTL · 一起探索"].exists)
        let second = app.buttons["workspaceCandidate-1"]
        XCTAssertTrue(second.waitForExistence(timeout: 25), "拍完应自动识别，不再让孩子找识别按钮：\(app.debugDescription)")
        XCTAssertFalse(app.buttons["workspaceConfirm"].exists)
        app.terminate(); app.launch()
        XCTAssertTrue(second.waitForExistence(timeout: 10), "重启后应保留多题选择，而不是重新识别")
        second.tap()
        let statement = app.staticTexts["workspaceStatement"]
        XCTAssertTrue(statement.waitForExistence(timeout: 10))
        XCTAssertTrue(statement.label.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "/", with: "÷").contains("3.6÷0.4"), statement.label)
        XCTAssertFalse(app.scrollViews["childCanvas"].exists, "尚未核对不能进入学习画布")
        let edit = app.buttons["workspaceEditStatement"]
        if !edit.isHittable { app.swipeUp() }
        edit.tap()
        let editor = app.textViews["workspaceStatementEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5)); editor.tap()
        editor.press(forDuration: 1.2)
        let selectAll = app.menuItems.matching(NSPredicate(format: "label == '全选' OR label == 'Select All'")).firstMatch
        XCTAssertTrue(selectAll.waitForExistence(timeout: 5), app.debugDescription)
        selectAll.tap()
        editor.typeText("3.6 / 0.6 = ?")
        XCTAssertEqual(editor.value as? String, "3.6 / 0.6 = ?")
        // 全选后的系统编辑浮层可能吞掉下一次外部点按，先结束选择状态。
        editor.tap()
        app.buttons["workspaceSaveStatement"].tap()
        let updated = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND label == %@", "3.6 / 0.6 = ?"), object: statement)
        XCTAssertEqual(XCTWaiter.wait(for: [updated], timeout: 15), .completed, app.debugDescription)
        XCTAssertEqual(statement.label, "3.6 / 0.6 = ?")
        let confirm = app.buttons["workspaceConfirmIndependent"]
        if !confirm.isHittable { app.swipeUp() }
        confirm.tap()
        XCTAssertTrue(app.scrollViews["childCanvas"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.navigationBars["AI-DTL · 一起探索"].exists)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["workspaceViewPhoto"].waitForExistence(timeout: 5))
        app.buttons["workspaceViewPhoto"].tap()
        XCTAssertTrue(app.images["workspaceOriginalPhotoFull"].waitForExistence(timeout: 5), "选择和编辑题意后仍能查看原照")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "multi-question-original-photo-after-confirm"; shot.lifetime = .keepAlways; add(shot)
        app.terminate(); XCUIDevice.shared.orientation = .portrait
    }
}
