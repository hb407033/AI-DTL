import XCTest
import PencilKit
@testable import ScholarPad

final class WorkspaceCacheIsolationTests: XCTestCase {
    private func sampleRecord(_ sid: String = "s-1", _ rev: Int = 1) -> WorkspaceRecord {
        WorkspaceRecord(schemaVersion: 2, sessionId: sid, eventId: "e-\(rev)", revision: rev,
            problem: WorkspaceProblem(problemId: "p-1", source: "curated", photoId: nil, challengeId: "c-1", packVersion: "1",
                curriculum: WorkspaceCurriculum(currentUnit: "小数乘法"),
                statement: .init(text: "每米2.4元", revision: 0, confirmed: true)),
            phase: "exploring", childInkBase64: "", board: LearningBoard(revision: 0, rectangles: []),
            submissions: [], feedback: [], openQuestions: [])
    }

    // 冲突保留双方副本：local 和 remote 都不丢失
    func testConflictPreservesBothLocalAndRemoteCopies() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let local = WorkspaceLocalDraft(photo: Data([1]), drawing: PKDrawing().dataRepresentation(), record: sampleRecord("s-1", 1))
        try cache.save(local)
        let remote = sampleRecord("s-1", 5)
        try cache.archiveConflict(local: local, remote: remote)
        // 冲突文件存在且含双方
        let conflictFiles = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("conflict-") }
        XCTAssertEqual(conflictFiles.count, 1)
        struct Copies: Codable { var local: WorkspaceLocalDraft; var remote: WorkspaceRecord }
        let copies = try JSONDecoder().decode(Copies.self, from: Data(contentsOf: conflictFiles[0]))
        XCTAssertEqual(copies.local.record?.revision, 1)
        XCTAssertEqual(copies.remote.revision, 5)
        XCTAssertEqual(copies.local.record?.sessionId, "s-1")
        XCTAssertEqual(copies.remote.sessionId, "s-1")
    }

    // 冲突文件不腐蚀 current.json：冲突归档后 current 仍可正常加载
    func testConflictArchiveDoesNotCorruptCurrent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let current = WorkspaceLocalDraft(photo: Data([9, 9]), drawing: PKDrawing().dataRepresentation(), record: sampleRecord("s-1", 3))
        try cache.save(current)
        try cache.archiveConflict(local: current, remote: sampleRecord("s-1", 7))
        let loaded = try XCTUnwrap(cache.load())
        XCTAssertEqual(loaded.photo, Data([9, 9]))
        XCTAssertEqual(loaded.record?.revision, 3)
    }

    // pendingSave 跨重启保持身份
    func testPendingSaveSurvivesDiskRoundTrip() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let pending = sampleRecord("s-1", 2)
        try cache.save(.init(photo: Data([1]), drawing: PKDrawing().dataRepresentation(), record: sampleRecord("s-1", 1), pendingSave: pending))
        let restored = try XCTUnwrap(WorkspaceCache(directory: root).load())
        XCTAssertEqual(restored.pendingSave?.revision, 2)
        XCTAssertEqual(restored.pendingSave?.sessionId, "s-1")
        XCTAssertEqual(restored.pendingSave?.eventId, "e-2")
    }

    // 多会话归档共存：不同 sessionId 不碰撞
    func testMultipleArchivesCoexistBySessionId() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        try cache.save(.init(photo: Data([1]), drawing: PKDrawing().dataRepresentation(), record: sampleRecord("s-1", 1)))
        try cache.preserveCurrent()
        try cache.save(.init(photo: Data([2]), drawing: PKDrawing().dataRepresentation(), record: sampleRecord("s-2", 1)))
        try cache.preserveCurrent()
        let entries = try cache.archives()
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(Set(entries.map { $0.id }), Set(["s-1", "s-2"]))
    }

    // 两次冲突归档不覆盖：各保留独立文件
    func testTwoConflictsDoNotOverwrite() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let local1 = WorkspaceLocalDraft(photo: Data([1]), drawing: PKDrawing().dataRepresentation(), record: sampleRecord("s-1", 1))
        try cache.save(local1)
        try cache.archiveConflict(local: local1, remote: sampleRecord("s-1", 2))
        try cache.archiveConflict(local: local1, remote: sampleRecord("s-1", 3))
        let conflictFiles = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("conflict-") }
        XCTAssertEqual(conflictFiles.count, 2)
    }
}
