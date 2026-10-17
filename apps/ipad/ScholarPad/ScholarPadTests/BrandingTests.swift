import XCTest
import UIKit
import CryptoKit
import SwiftUI
import PencilKit
@testable import ScholarPad

final class BrandingTests: XCTestCase {
    @MainActor
    func testWritingSurfaceRemainsLightInDarkMode() throws {
        let host = UIHostingController(rootView: ChildCanvasView(clearToken: 0, onEvents: { _ in }))
        host.overrideUserInterfaceStyle = .dark
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 800, height: 1000))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        host.view.layoutIfNeeded()
        func findCanvas(_ view: UIView) -> PKCanvasView? {
            if let canvas = view as? PKCanvasView { return canvas }
            return view.subviews.lazy.compactMap(findCanvas).first
        }
        let canvas = try XCTUnwrap(findCanvas(host.view))
        XCTAssertEqual(canvas.overrideUserInterfaceStyle, .light)
        XCTAssertEqual(canvas.backgroundColor, UIColor.white)
        let ink = try XCTUnwrap(canvas.tool as? PKInkingTool)
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        XCTAssertTrue(ink.color.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
        XCTAssertEqual(red, 0, accuracy: 0.001)
        XCTAssertEqual(green, 0, accuracy: 0.001)
        XCTAssertEqual(blue, 0, accuracy: 0.001)
        XCTAssertEqual(alpha, 1, accuracy: 0.001)
    }

    func testDisplayNameAndOriginalLogoAreBundled() throws {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String, "AI-DTL")
        let logo = try XCTUnwrap(UIImage(named: "brand/ai-dtl-logo"))
        XCTAssertEqual(logo.size.width / logo.size.height, 3, accuracy: 0.001)
        let url = try XCTUnwrap(Bundle.main.url(forResource: "ai-dtl-logo", withExtension: "png", subdirectory: "brand"))
        let hash = SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(hash, "d5c780d649b2678a1cd59619a0879afa906a5a0a841de4379758d602b17e494d")
    }
}
