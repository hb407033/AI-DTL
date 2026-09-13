import XCTest

final class BrandingUITests: XCTestCase {
    @MainActor
    func testProbeBrandIsAccessible() {
        let app = XCUIApplication()
        app.launch()
        let logo = app.images["brandLogo"]
        XCTAssertTrue(logo.waitForExistence(timeout: 10))
        XCTAssertEqual(logo.label, "AI-DTL，AI 学科心智学习系统")
        XCTAssertTrue(app.staticTexts["AI 学科心智学习系统"].exists)
        XCTAssertTrue(app.staticTexts["AI-Powered System for Disciplinary Thinking and Learning"].exists)
        XCTAssertTrue(app.navigationBars["AI-DTL 联调"].exists)
    }
}
