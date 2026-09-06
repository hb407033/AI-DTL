// 局域网探针协议测试。夹具与 TS 端共用同一个 JSON 文件（按源码路径读取），任何一端改字段两边同时报错。
import XCTest
@testable import ScholarPadProbe

final class ProbeProtocolTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        // 从本测试源文件定位仓库根：apps/ipad/ScholarPadProbe/ScholarPadProbeTests/ProbeProtocolTests.swift
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        url.append(path: "packages/gate-contracts/fixtures/probe-protocol-v1.json")
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func json(_ object: Any) throws -> Data { try JSONSerialization.data(withJSONObject: object) }

    func testProtocolVersionMatchesFixture() throws {
        XCTAssertEqual(ProbeProtocol.version, try XCTUnwrap(fixture()["protocolVersion"] as? Int))
    }

    func testDecodesAckFromFixture() throws {
        let server = try XCTUnwrap(fixture()["serverToClient"] as? [String: Any])
        let message = try JSONDecoder().decode(ServerMessage.self, from: json(server["ack"]!))
        XCTAssertEqual(message, .ack(id: "c-0001", clientSeq: 1, serverReceivedAt: 1757100000042))
    }

    func testDecodesNackFromFixture() throws {
        let server = try XCTUnwrap(fixture()["serverToClient"] as? [String: Any])
        let message = try JSONDecoder().decode(ServerMessage.self, from: json(server["nack"]!))
        XCTAssertEqual(message, .nack(reason: "seqGap", expectedSeq: 2))
    }

    func testDecodesSemanticActionIntoLocalCircle() throws {
        let server = try XCTUnwrap(fixture()["serverToClient"] as? [String: Any])
        let message = try JSONDecoder().decode(ServerMessage.self, from: json(server["semanticAction"]!))
        let expected = SemanticCircle(id: "circle-1", owner: .agent, center: CGPoint(x: 160, y: 200), radius: 60)
        XCTAssertEqual(message, .semanticAction(id: "s-0001", inReplyTo: "c-0002", action: .upsertCircle(expected)))
    }

    func testUnknownServerTypeFailsToDecode() throws {
        let unknown = try json(["protocolVersion": 1, "type": "teleport", "id": "x"])
        XCTAssertThrowsError(try JSONDecoder().decode(ServerMessage.self, from: unknown))
    }

    func testWrongVersionFailsToDecode() throws {
        let wrong = try json(["protocolVersion": 2, "type": "ack", "id": "c", "clientSeq": 1, "serverReceivedAt": 1])
        XCTAssertThrowsError(try JSONDecoder().decode(ServerMessage.self, from: wrong))
    }

    func testEncodedPingMatchesFixtureFields() throws {
        let client = try XCTUnwrap(fixture()["clientToServer"] as? [String: Any])
        let expected = try XCTUnwrap(client["ping"] as? [String: Any])
        let ping = ClientMessage.ping(id: "c-0001", clientSeq: 1, sessionId: "sess-a", sentAt: 1757100000000)
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(ping)) as? [String: Any])
        XCTAssertEqual(encoded as NSDictionary, expected as NSDictionary)
    }
}

final class ProbeWebSocketPolicyTests: XCTestCase {
    func testReconnectDelayCapsAtOneSecond() {
        XCTAssertEqual((0...4).map(ProbeWebSocket.reconnectDelayMs), [100, 200, 400, 800, 1000])
    }
}

final class OutboundQueueTests: XCTestCase {
    /// 未确认消息按 clientSeq 保序；ack 移除；重连时按序重放；序号缺口的 nack 让队列从期望序号起重放
    func testAckRemovesOnlyThatMessage() {
        var queue = OutboundQueue(sessionId: "s")
        let a = queue.enqueue(.ping, sentAt: 1)
        let b = queue.enqueue(.ping, sentAt: 2)
        XCTAssertEqual([a.clientSeq, b.clientSeq], [1, 2])
        queue.acknowledge(id: a.id)
        XCTAssertEqual(queue.pending.map(\.id), [b.id])
    }

    func testReplayReturnsPendingInSeqOrder() {
        var queue = OutboundQueue(sessionId: "s")
        _ = queue.enqueue(.ping, sentAt: 1)
        _ = queue.enqueue(.requestSemanticAction, sentAt: 2)
        _ = queue.enqueue(.ping, sentAt: 3)
        XCTAssertEqual(queue.replayFrom(seq: 2).map(\.clientSeq), [2, 3])
    }

    func testAcknowledgingUnknownIdIsNoop() {
        var queue = OutboundQueue(sessionId: "s")
        _ = queue.enqueue(.ping, sentAt: 1)
        queue.acknowledge(id: "nope")
        XCTAssertEqual(queue.pending.count, 1)
    }
}
