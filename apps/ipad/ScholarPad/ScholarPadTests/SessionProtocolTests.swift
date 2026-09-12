// 会话协议类型与 TS 契约夹具逐字对齐：packages/session-contracts/fixtures/session-protocol-v1.json 两端共用。
import XCTest
@testable import ScholarPad

final class SessionProtocolTests: XCTestCase {
    private struct Fixture: Decodable {
        let events: [EvidenceEvent]
        let outbound: [ChildOutbound]
        let clientFrames: [ClientFrame]
        let serverFrames: [ServerFrame]
    }

    private func loadFixture() throws -> Fixture {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }   // 文件 → ScholarPadTests → ScholarPad → ipad → apps → 仓库根
        url.append(path: "packages/session-contracts/fixtures/session-protocol-v1.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testEventsCoverAllFifteenPayloadTypes() throws {
        let fixture = try loadFixture()
        let types = Set(fixture.events.map { $0.payload.type })
        XCTAssertEqual(types.sorted(), [
            "ANSWER", "CONFIRM_TRANSCRIPT", "CONTEST", "DONE", "DRAG", "ERASE", "EXPLAIN", "HELP_REQUEST",
            "MEMORY_ASSENT", "PAUSE_REQUEST", "RESUME_REQUEST", "SELECT", "SOFT_LANDING_CHOICE", "STROKE", "UTTERANCE",
        ])
        XCTAssertEqual(fixture.events[1].payload, .stroke(strokeId: "st-1", contentHash: "h1", bounds: StrokeBounds(x: 10, y: 10, width: 100, height: 40)))
        XCTAssertEqual(fixture.events[6].quality, .corrected)
    }

    func testEventsRoundTripThroughEncoder() throws {
        let fixture = try loadFixture()
        for event in fixture.events {
            let data = try JSONEncoder().encode(event)
            XCTAssertEqual(try JSONDecoder().decode(EvidenceEvent.self, from: data), event)
        }
    }

    func testOutboundDecodesAllSevenKinds() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture.outbound.count, 7)
        guard case .speak(_, let text, let level, _, _) = fixture.outbound[0] else { return XCTFail("第一条应是 speak") }
        XCTAssertEqual(text, "你现在已经确定了什么？")
        XCTAssertEqual(level, 1)
        guard case .canvasAction(_, .highlight(let objectId)) = fixture.outbound[1] else { return XCTFail("第二条应是 highlight") }
        XCTAssertEqual(objectId, "bar-1")
        guard case .softLanding(_, _, let options) = fixture.outbound[5] else { return XCTFail("第六条应是 softLanding") }
        XCTAssertEqual(options, ["simpler", "hint", "stop"])
    }

    func testFramesDecodeAndClientFrameRoundTrips() throws {
        let fixture = try loadFixture()
        let frame = try XCTUnwrap(fixture.clientFrames.first)
        let data = try JSONEncoder().encode(frame)
        XCTAssertEqual(try JSONDecoder().decode(ClientFrame.self, from: data), frame)
        // 编码结果必须带协议版本与类型字段，网关按它们校验
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["protocolVersion"] as? Int, 1)
        XCTAssertEqual(json["type"] as? String, "event")

        XCTAssertEqual(fixture.serverFrames.count, 4)
        guard case .ack(let id, let seq, _) = fixture.serverFrames[0] else { return XCTFail("应是 ack") }
        XCTAssertEqual([id, "\(seq)"], ["f-1", "1"])
        guard case .nack(let reason, let expected) = fixture.serverFrames[1] else { return XCTFail("应是 nack") }
        XCTAssertEqual([reason, "\(expected)"], ["seqGap", "2"])
        guard case .outbound(.notice(_, let text)) = fixture.serverFrames[2] else { return XCTFail("应是 outbound notice") }
        XCTAssertEqual(text, "等我一下。")
        guard case .error(let errorReason, _) = fixture.serverFrames[3] else { return XCTFail("应是 error") }
        XCTAssertEqual(errorReason, "invalidJson")
    }

    func testUnknownPayloadTypeAndWrongVersionAreRejected() {
        let badType = Data(#"{"type":"NOPE"}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(EventPayload.self, from: badType))
        let badVersion = Data(#"{"protocolVersion":2,"type":"ack","id":"a","clientSeq":1,"serverReceivedAt":1}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ServerFrame.self, from: badVersion))
    }

    func testSemanticObjectPropsKeepArbitraryJson() throws {
        let data = Data(#"{"kind":"upsertObject","object":{"id":"bar","owner":"agent","kind":"tenthsBar","props":{"segments":10,"filled":0,"label":"0.3","flags":[true,null]}}}"#.utf8)
        guard case .upsertObject(let object) = try JSONDecoder().decode(CanvasAction.self, from: data) else { return XCTFail("应是 upsertObject") }
        XCTAssertEqual(object.props["segments"], .number(10))
        XCTAssertEqual(object.props["label"], .string("0.3"))
        XCTAssertEqual(object.props["flags"], .array([.bool(true), .null]))
        XCTAssertEqual(object.number("segments"), 10)
    }
}
