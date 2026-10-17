import XCTest
import UIKit
@testable import ScholarPad

@MainActor
final class WorkspacePortfolioTests: XCTestCase {
    func testNewPhotoAndReopenKeepBothUnsubmittedOriginals() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let model = ProblemCaptureModel(cache: cache)
        func picture(_ color: UIColor) -> UIImage {
            UIGraphicsImageRenderer(size: CGSize(width: 50, height: 50)).image { context in
                color.setFill(); context.fill(CGRect(x: 0, y: 0, width: 50, height: 50))
            }
        }
        model.capture(picture(.red))
        let first = try XCTUnwrap(cache.load())
        model.capture(picture(.blue))
        let second = try XCTUnwrap(cache.load())
        let archived = try XCTUnwrap(cache.archives().first)
        let opened = await model.openWork(archived.id, local: true)
        XCTAssertTrue(opened)
        XCTAssertEqual(try cache.load()?.photo, first.photo)
        XCTAssertTrue(try cache.archives().contains { try cache.loadArchive($0.id).photo == second.photo })
        let failed = await model.openWork("missing", local: true)
        XCTAssertFalse(failed)
        XCTAssertEqual(try cache.load()?.photo, first.photo)
    }
}
