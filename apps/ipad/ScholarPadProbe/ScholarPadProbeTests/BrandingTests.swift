import XCTest
import UIKit
import CryptoKit
@testable import ScholarPadProbe

final class BrandingTests: XCTestCase {
    func testDisplayNameAndOriginalLogoAreBundled() throws {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String, "AI-DTL 联调")
        let logo = try XCTUnwrap(UIImage(named: "brand/ai-dtl-logo"))
        XCTAssertEqual(logo.size.width / logo.size.height, 3, accuracy: 0.001)
        let url = try XCTUnwrap(Bundle.main.url(forResource: "ai-dtl-logo", withExtension: "png", subdirectory: "brand"))
        let hash = SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(hash, "d5c780d649b2678a1cd59619a0879afa906a5a0a841de4379758d602b17e494d")
    }
}
