import XCTest
@testable import ScholarPad

@MainActor
final class RealtimeSessionTests: XCTestCase {
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<100 { if predicate() { return }; try await Task.sleep(for: .milliseconds(10)) }
        XCTFail("条件未满足")
    }

    private func readySession(instructions: String = "边界") async throws -> (RealtimeSession, WorkspaceTestTransport, URLRequest) {
        let transport = WorkspaceTestTransport()
        let url = try XCTUnwrap(URL(string: "wss://example.invalid/realtime"))
        var seen: URLRequest?
        let session = RealtimeSession(url: url, apiKey: "synthetic") { request in
            seen = request
            return transport
        }
        let pending = Task { await session.prewarm(instructions: instructions) }
        try await eventually { transport.sent.contains { $0["type"] as? String == "session.update" } == false }
        try transport.emit(["type": "session.created"])
        try await eventually { transport.sent.contains { $0["type"] as? String == "session.update" } }
        try transport.emit(["type": "session.updated"])
        await pending.value
        return (session, transport, try XCTUnwrap(seen))
    }

    func testAudioSentBeforeReadyIsFlushedInOrderAfterSessionUpdated() async throws {
        let transport = WorkspaceTestTransport()
        let session = RealtimeSession(url: try XCTUnwrap(URL(string: "wss://example.invalid/realtime")), apiKey: "synthetic") { _ in transport }
        let pending = Task { await session.prewarm(instructions: "边界") }
        session.appendAudio(Data([1, 2]))
        session.appendAudio(Data([3, 4]))
        try transport.emit(["type": "session.created"])
        try await eventually { transport.sent.contains { $0["type"] as? String == "session.update" } }
        try transport.emit(["type": "session.updated"])
        await pending.value
        try await eventually { transport.sent.filter { $0["type"] as? String == "input_audio_buffer.append" }.count == 2 }
        let audio = transport.sent.compactMap { event -> String? in
            event["type"] as? String == "input_audio_buffer.append" ? event["audio"] as? String : nil
        }
        XCTAssertEqual(audio, [Data([1, 2]).base64EncodedString(), Data([3, 4]).base64EncodedString()])
    }

    func testCommitWaitsUntilBufferedFramesFlushed() async throws {
        let transport = WorkspaceTestTransport()
        let session = RealtimeSession(url: try XCTUnwrap(URL(string: "wss://example.invalid/realtime")), apiKey: "synthetic") { _ in transport }
        let pending = Task { await session.prewarm(instructions: "边界") }
        session.appendAudio(Data([9]))
        let commit = Task { try await session.commitTurn() }
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertFalse(transport.sent.contains { $0["type"] as? String == "input_audio_buffer.commit" })
        try transport.emit(["type": "session.created"])
        try await eventually { transport.sent.contains { $0["type"] as? String == "session.update" } }
        try transport.emit(["type": "session.updated"])
        try await commit.value
        await pending.value
        let types = transport.sent.compactMap { $0["type"] as? String }
        let audio = try XCTUnwrap(types.firstIndex(of: "input_audio_buffer.append"))
        let commitIndex = try XCTUnwrap(types.firstIndex(of: "input_audio_buffer.commit"))
        XCTAssertLessThan(audio, commitIndex)
    }

    func testHeaderRequestIsTextOnlyAndReplyRequestHasAudio() async throws {
        let (session, transport, request) = try await readySession()
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic")
        try await session.requestHeader(instructions: "头部")
        try await session.requestReply(instructions: "回复")
        let created = transport.sent.filter { $0["type"] as? String == "response.create" }
        let header = created[0]["response"] as? [String: Any]
        let reply = created[1]["response"] as? [String: Any]
        XCTAssertEqual(header?["modalities"] as? [String], ["text"])
        XCTAssertEqual(reply?["modalities"] as? [String], ["text", "audio"])
    }

    func testCancelSendsResponseCancelAndDropsLaterAudioOfThatResponse() async throws {
        let (session, transport, _) = try await readySession()
        var audio: [String] = []
        session.onAudioDelta = { audio.append($0.base64EncodedString()) }
        try await session.requestReply(instructions: "回复")
        try transport.emit(["type": "response.created", "response": ["id": "r1"]])
        try await Task.sleep(for: .milliseconds(30))
        session.cancelResponse()
        try await eventually { transport.sent.contains { $0["type"] as? String == "response.cancel" } }
        try transport.emit(["type": "response.audio.delta", "response_id": "r1", "delta": Data([1]).base64EncodedString()])
        try transport.emit(["type": "response.created", "response": ["id": "r2"]])
        try transport.emit(["type": "response.audio.delta", "response_id": "r2", "delta": Data([2]).base64EncodedString()])
        try await eventually { audio == [Data([2]).base64EncodedString()] }
    }

    func testCancelBeforeResponseCreatedDropsThatResponseAndKeepsTheNext() async throws {
        let (session, transport, _) = try await readySession()
        var audio: [String] = []
        var text = ""
        session.onAudioDelta = { audio.append($0.base64EncodedString()) }
        session.onTextDelta = { text += $0 }
        try await session.requestReply(instructions: "回复")
        session.cancelResponse()
        try await eventually { transport.sent.contains { $0["type"] as? String == "response.cancel" } }
        try transport.emit(["type": "response.text.delta", "response_id": "late", "delta": "旧句子"])
        try transport.emit(["type": "response.audio.delta", "response_id": "late", "delta": Data([1]).base64EncodedString()])
        try transport.emit(["type": "response.created", "response": ["id": "late"]])
        try transport.emit(["type": "response.audio.delta", "response_id": "late", "delta": Data([1]).base64EncodedString()])
        try await session.requestReply(instructions: "下一句")
        try transport.emit(["type": "response.created", "response": ["id": "next"]])
        try transport.emit(["type": "response.audio.delta", "response_id": "next", "delta": Data([2]).base64EncodedString()])
        try await eventually { audio == [Data([2]).base64EncodedString()] }
        XCTAssertFalse(text.contains("旧句子"))
    }

    func testCloseDiscardsBufferedAudioAndReportsReason() async throws {
        let transport = WorkspaceTestTransport()
        let session = RealtimeSession(url: try XCTUnwrap(URL(string: "wss://example.invalid/realtime")), apiKey: "synthetic") { _ in transport }
        let pending = Task { await session.prewarm(instructions: "边界") }
        try await eventually { session.state == .connecting }
        session.appendAudio(Data([7, 7]))
        var reason: String?
        session.onClosed = { reason = $0 }
        session.close()
        await pending.value
        try transport.emit(["type": "session.created"])
        try transport.emit(["type": "session.updated"])
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(session.state, .closed(reason: "closed"))
        XCTAssertEqual(reason, "closed")
        XCTAssertFalse(transport.sent.contains { $0["type"] as? String == "input_audio_buffer.append" })
    }

    func testPrewarmTwiceReusesReadyConnection() async throws {
        let (session, transport, _) = try await readySession(instructions: "边界")
        let updates = transport.sent.filter { $0["type"] as? String == "session.update" }.count
        await session.prewarm(instructions: "边界")
        XCTAssertEqual(transport.sent.filter { $0["type"] as? String == "session.update" }.count, updates)
        XCTAssertEqual(session.state, .ready)
    }
}
