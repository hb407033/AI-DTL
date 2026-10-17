import XCTest

/// 真机相机只保存在隔离的测试草稿中，不上传拍到的画面。
final class CameraLocalizationUITests: XCTestCase {
    @MainActor func testSystemCameraReviewIsChineseAndReturnsVisiblePreview() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("系统相机硬件与确认按钮需要真机验收。")
        #endif
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_HOST": "127.0.0.1"]
        defer { app.terminate() }
        app.launch()
        let entry = app.buttons["workspaceCamera"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10))
        entry.tap()
        XCTAssertTrue(app.buttons["workspaceCancelCamera"].waitForExistence(timeout: 10))
        print("CAMERA_CONTROLS", app.buttons.allElementsBoundByIndex.map { "\($0.identifier):\($0.label)" })
        let shutter = app.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@ OR label == %@", "PhotoCapture", "拍照", "Take Picture")).firstMatch
        XCTAssertTrue(shutter.waitForExistence(timeout: 10), "系统相机必须显示快门")
        shutter.tap()
        let use = app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "使用照片", "使用相片")).firstMatch
        XCTAssertTrue(use.waitForExistence(timeout: 10), "使用照片按钮必须是中文")
        XCTAssertFalse(app.buttons["Use Photo"].exists)
        XCTAssertFalse(app.buttons["Retake"].exists)
        print("CAMERA_REVIEW", app.buttons.allElementsBoundByIndex.map { "\($0.identifier):\($0.label)" })
        use.tap()
        XCTAssertTrue(app.staticTexts["照片已拍好"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.images["题目照片"].isHittable)
        XCTAssertTrue(app.buttons["workspaceUsePhoto"].isHittable)
        XCTAssertTrue(app.staticTexts["workspaceStatus"].label.contains("还没有发送"))
    }
}
