import XCTest
@testable import ScholarPad

@MainActor
final class ScaffoldRevocationTests: XCTestCase {
    func testOfflineRestartRetryAndHostIsolation() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let first = ScaffoldRevocationOutbox(url: url)
        try first.enqueue(sessionId: "s", offerId: "o", action: "hide", host: "old.local", hostId: "host-a")
        let event = try XCTUnwrap(first.pending.first?.eventId)
        try first.enqueue(sessionId: "s", offerId: "o", action: "hide", host: "old.local", hostId: "host-a")
        XCTAssertEqual(first.pending.count, 1)
        XCTAssertEqual(first.pending.first?.eventId, event)
        let restored = ScaffoldRevocationOutbox(url: url)
        XCTAssertTrue(restored.dismissed.contains("o"))
        var calls = 0
        await restored.flush(host: "old.local", hostId: nil) { _ in calls += 1 }
        await restored.flush(host: "new.local", hostId: "host-b") { _ in calls += 1 }
        XCTAssertEqual(calls, 0)
        await restored.flush(host: "new.local", hostId: "host-a") { item in
            calls += 1; XCTAssertEqual(item.eventId, event); throw URLError(.notConnectedToInternet)
        }
        XCTAssertEqual(restored.pending.count, 1)
        await restored.flush(host: "new.local", hostId: "host-a") { item in
            calls += 1; XCTAssertEqual(item.eventId, event)
        }
        XCTAssertEqual(calls, 2)
        XCTAssertTrue(ScaffoldRevocationOutbox(url: url).pending.isEmpty)
        XCTAssertTrue(ScaffoldRevocationOutbox(url: url).dismissed.contains("o"))
    }

    func testLegacyTombstonesAndUnidentifiedHostStayScoped() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try JSONEncoder().encode(Set(["legacy"])).write(to: url)
        let outbox = ScaffoldRevocationOutbox(url: url)
        XCTAssertTrue(outbox.dismissed.contains("legacy"))
        try outbox.enqueue(sessionId: "s", offerId: "o", action: "invalidate", host: "old.local", hostId: nil)
        var sent = false
        await outbox.flush(host: "other.local", hostId: "host-a") { _ in sent = true }
        XCTAssertFalse(sent)
        await outbox.flush(host: "old.local", hostId: "host-a") { _ in sent = true }
        XCTAssertTrue(sent)
    }

    func testCorruptionDoesNotOverwriteUnrecoverableQueue() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let broken = Data("broken".utf8)
        try broken.write(to: url)
        let outbox = ScaffoldRevocationOutbox(url: url)
        XCTAssertThrowsError(try outbox.enqueue(sessionId: "s", offerId: "o", action: "hide", host: "h", hostId: nil))
        XCTAssertEqual(try Data(contentsOf: url), broken)
    }
}
