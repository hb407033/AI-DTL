import XCTest
@testable import ScholarPad

@MainActor
final class SyncOutboxTests: XCTestCase {
    private func batch(_ seq: Int, id: String) throws -> SyncBatch {
        let context = try RealtimeTestSupport.sampleContext()
        return SyncBatch(batchId: id, sessionId: context.record.sessionId, seq: seq, expectedRevision: context.record.revision,
                         record: context.record, decisions: [], turns: [SyncTurn(turnId: "t-\(seq)", utterance: "先看看", played: false, path: "none")], usage: [])
    }

    func testBatchesPersistAcrossRelaunchAndFlushInOrder() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var seen: [String] = []
        let first = SyncOutbox(directory: directory) { _, _, data in
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            seen.append(json?["batchId"] as? String ?? "")
            return (200, Data("{}".utf8))
        }
        try first.enqueue(batch(2, id: "b-2"))
        try first.enqueue(batch(1, id: "b-1"))
        let second = SyncOutbox(directory: directory) { _, _, data in
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            seen.append(json?["batchId"] as? String ?? "")
            return (200, Data("{}".utf8))
        }
        XCTAssertEqual(second.pendingCount, 2)
        await second.flush(host: "127.0.0.1")
        XCTAssertEqual(seen, ["b-1", "b-2"])
        XCTAssertEqual(second.pendingCount, 0)
    }

    func testDuplicateResponseRemovesBatch() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let outbox = SyncOutbox(directory: directory) { _, _, _ in (200, Data("{\"duplicate\":true}".utf8)) }
        try outbox.enqueue(batch(1, id: "b-1"))
        await outbox.flush(host: "127.0.0.1")
        XCTAssertEqual(outbox.pendingCount, 0)
    }

    func testConflictStopsSessionQueue() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var calls = 0
        let outbox = SyncOutbox(directory: directory) { _, _, _ in
            calls += 1
            return (409, Data("{\"reason\":\"revisionConflict\"}".utf8))
        }
        try outbox.enqueue(batch(1, id: "b-1"))
        try outbox.enqueue(batch(2, id: "b-2"))
        await outbox.flush(host: "127.0.0.1")
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(outbox.pendingCount, 2)
        XCTAssertTrue(outbox.conflictedSessions.contains("gates"))
    }

    func testNetworkErrorKeepsBatch() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let outbox = SyncOutbox(directory: directory) { _, _, _ in throw URLError(.networkConnectionLost) }
        try outbox.enqueue(batch(1, id: "b-1"))
        await outbox.flush(host: "127.0.0.1")
        XCTAssertEqual(outbox.pendingCount, 1)
    }

    func testNoRecordingBytesInBatchJSON() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let outbox = SyncOutbox(directory: directory) { _, _, _ in (200, Data()) }
        try outbox.enqueue(batch(1, id: "b-1"))
        let folder = directory.appendingPathComponent("gates")
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).first)
        let text = try String(contentsOf: file, encoding: .utf8)
        XCTAssertFalse(text.contains("\"pcm\""))
        XCTAssertFalse(text.contains("\"recording\""))
        XCTAssertFalse(text.contains("\"audioBase64\""))
        XCTAssertFalse(text.contains("apiKey"))
    }
}
