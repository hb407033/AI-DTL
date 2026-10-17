import XCTest
import UIKit

final class PhotoEntryUITests: XCTestCase {
    @MainActor func testConfirmedProblemKeepsOriginalPhotoVisibleInBothOrientations() {
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_HOST": "127.0.0.1", "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE": "1"]
        defer { XCUIDevice.shared.orientation = .portrait; app.terminate() }
        app.launch()
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            XCUIDevice.shared.orientation = orientation
            // SwiftUI 的按钮合并其图像标签；验证用户实际能操作的原照按钮，而非内部图像节点。
            let original = app.buttons["workspaceViewPhoto"]
            XCTAssertTrue(original.waitForExistence(timeout: 5), "确认题意后仍应能直接看见原照")
            XCTAssertTrue(original.isHittable)
            XCTAssertEqual(original.label, "题目原照，点按放大")
            XCTAssertGreaterThanOrEqual(original.frame.height, 44)
            let proof = XCTAttachment(screenshot: app.screenshot())
            proof.name = "visible-original-photo-\(orientation.rawValue)"; proof.lifetime = .keepAlways; add(proof)
            original.tap()
            XCTAssertTrue(app.images["workspaceOriginalPhotoFull"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.images["workspaceOriginalPhotoFull"].isHittable)
            app.buttons["返回"].firstMatch.tap()
        }
    }
    @MainActor func testCameraEntryVisibleInBothLearningOrientations() {
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_HOST": "127.0.0.1", "AI_DTL_WORKSPACE_CONFIRMED_FIXTURE": "1"]
        defer { XCUIDevice.shared.orientation = .portrait; app.terminate() }
        app.launch()
        XCTAssertTrue(app.scrollViews["childCanvas"].waitForExistence(timeout: 10))
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            XCUIDevice.shared.orientation = orientation
            XCTAssertTrue(app.buttons["workspaceCamera"].isHittable, "拍照不能藏在查看照片里")
        }
    }

    @MainActor func testCapturedPhotoIsVisibleAndFailedRecognitionHasRetry() {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 400)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 300, height: 400))
            ("2.4 × 0.3 = ?" as NSString).draw(at: CGPoint(x: 20, y: 50), withAttributes: [.foregroundColor: UIColor.black])
        }
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_HOST": "127.0.0.1", "AI_DTL_WORKSPACE_PHOTO": image.jpegData(compressionQuality: 0.8)!.base64EncodedString()]
        defer { app.terminate() }
        app.launch()
        XCTAssertTrue(app.images["题目照片"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.images["题目照片"].isHittable)
        XCTAssertTrue(app.buttons["workspaceUsePhoto"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["workspaceUsePhoto"].isHittable)
        XCTAssertEqual(app.buttons["workspaceUsePhoto"].label, "重试识别")
        XCTAssertFalse(app.buttons["workspaceConfirm"].exists, "识别失败不能把说明当作题干进入学习")
        let proof = XCTAttachment(screenshot: app.screenshot())
        proof.name = "photo-clear-next-step"; proof.lifetime = .keepAlways; add(proof)
    }
}
