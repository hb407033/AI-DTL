import XCTest
import PencilKit
@testable import ScholarPad

/// A2: confirmed 合成 fixture 写入 DEBUG 隔离缓存并可读回，UI 测试用同一 TEST_ID 启动。
final class WorkspaceConfirmedFixtureTests: XCTestCase {
    func testWriteConfirmedFixtureAndLoadBack() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        // 写 confirmed fixture 到隔离目录（不碰家庭 cache）
        LearningWorkspaceView.writeConfirmedFixture(to: root)
        let cache = WorkspaceCache(directory: root)
        let draft = try XCTUnwrap(cache.load())
        let record = try XCTUnwrap(draft.record)
        XCTAssertTrue(record.problem?.statement.confirmed == true, "fixture 应为 confirmed 状态")
        XCTAssertEqual(record.problem?.statement.text, "每米彩带2.4元，买0.3米需要多少元？")
        XCTAssertEqual(record.schemaVersion, 2)
        XCTAssertFalse(draft.photo.isEmpty, "fixture 应含合成照片")
        XCTAssertNoThrow(try PKDrawing(data: draft.drawing))
    }
}
