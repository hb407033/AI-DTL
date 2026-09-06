// 出站队列：每条事件带幂等 id 与会话内单调 clientSeq；ack 移除；nack 或重连时从指定序号重放。
import XCTest
@testable import ScholarPad

final class EventOutboxTests: XCTestCase {
    func testEnqueueAssignsIncreasingSeqAndUniqueIds() {
        var outbox = EventOutbox(sessionId: "s-1", deviceId: "ipad-sim")
        let a = outbox.enqueue(.helpRequest, source: .childButton, occurredAt: 100)
        let b = outbox.enqueue(.done, source: .childButton, occurredAt: 200)
        XCTAssertEqual([a.clientSeq, b.clientSeq], [1, 2])
        XCTAssertEqual([a.event.clientSeq, b.event.clientSeq], [1, 2])
        XCTAssertNotEqual(a.id, b.id)
        XCTAssertEqual(a.id, a.event.eventId)   // 帧 id 与事件 id 同一个幂等键
        XCTAssertEqual(a.sessionId, "s-1")
        XCTAssertEqual(a.event.clientSessionId, "s-1")
        XCTAssertEqual(a.event.deviceId, "ipad-sim")
        XCTAssertEqual(a.event.quality, .confirmed)
        XCTAssertEqual(outbox.pending.map(\.clientSeq), [1, 2])
    }

    func testAcknowledgeRemovesAndReplayFromKeepsOrder() {
        var outbox = EventOutbox(sessionId: "s-1", deviceId: "d")
        let a = outbox.enqueue(.helpRequest, source: .childButton, occurredAt: 1)
        _ = outbox.enqueue(.done, source: .childButton, occurredAt: 2)
        _ = outbox.enqueue(.resumeRequest, source: .childButton, occurredAt: 3)
        outbox.acknowledge(id: a.id)
        XCTAssertEqual(outbox.pending.map(\.clientSeq), [2, 3])
        XCTAssertEqual(outbox.replayFrom(seq: 3).map(\.clientSeq), [3])
        outbox.acknowledge(id: "not-there")
        XCTAssertEqual(outbox.pending.count, 2)
    }
}
