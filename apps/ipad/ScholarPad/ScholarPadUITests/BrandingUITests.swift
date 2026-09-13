import XCTest

final class BrandingUITests: XCTestCase {
    @MainActor
    func testBrandIsAccessibleWithoutDisplacingCanvas() {
        let app = XCUIApplication()
        app.launch()
        let logo = app.images["brandLogo"]
        XCTAssertTrue(logo.waitForExistence(timeout: 10))
        XCTAssertEqual(logo.label, "AI-DTL，AI 学科心智学习系统")
        XCTAssertLessThanOrEqual(logo.frame.height, 48)
        XCTAssertTrue(app.staticTexts["AI 学科心智学习系统"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["childCanvas"].exists)
    }
}
