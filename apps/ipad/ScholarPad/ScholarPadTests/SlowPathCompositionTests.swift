import XCTest
@testable import ScholarPad

/// 应用真正用来组装慢路径的入口。注入的是传输，不是另一套会跳过文字模型和临时合成的闭包。
@MainActor
final class SlowPathCompositionTests: XCTestCase {
    private let fixtureKey = "fixture-key-not-for-logs"
    private let pcm = Data([9, 8, 7])

    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(10)) }
        XCTFail("条件未满足")
    }

    private func credentialURL() throws -> URL {
        try XCTUnwrap(URL(string: "wss://example.invalid/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime"))
    }

    private func sse(_ text: String, finish: String = "stop", reasoning: String? = nil) throws -> Data {
        var delta: [String: Any] = ["content": text]
        if let reasoning { delta["reasoning_content"] = reasoning }
        let event: [String: Any] = ["choices": [["delta": delta, "finish_reason": finish]]]
        let encoded = try JSONSerialization.data(withJSONObject: event)
        let body = "data: \(String(decoding: encoded, as: UTF8.self))\n\ndata: [DONE]\n\n"
        return Data(body.utf8)
    }

    private func http(_ data: Data, status: Int = 200) -> (Data, HTTPURLResponse) {
        let response = HTTPURLResponse(url: URL(string: "https://example.invalid/compatible-mode/v1/chat/completions")!,
                                        statusCode: status, httpVersion: nil, headerFields: nil)!
        return (data, response)
    }

    private func decisionJSON() -> String {
        let utterance = RealtimeTestSupport.passingUtterance
        return "{\"focus\":\"clarify\",\"observation\":\"孩子求助\",\"evidenceIds\":[\"t\"],\"utterance\":\"\(utterance)\",\"method\":\"ordinary\",\"handoff\":false}"
    }

    private func assertNoSecret(_ request: URLRequest) {
        let url = request.url?.absoluteString ?? ""
        XCTAssertFalse(url.contains(fixtureKey))
        XCTAssertFalse(String(decoding: request.httpBody ?? Data(), as: UTF8.self).contains(fixtureKey))
        let header = request.value(forHTTPHeaderField: "Authorization") ?? ""
        XCTAssertTrue(header.hasPrefix("Bearer "))
        XCTAssertEqual(header.count, "Bearer ".count + fixtureKey.count)
    }

    func testThinkingRequestMatchesProtocolAndDropsReasoning() async throws {
        var seen: URLRequest?
        let text = try await ThinkingTextClient.request(
            instructions: "请返回决策", image: nil, credentialURL: try credentialURL(), apiKey: fixtureKey,
            transport: { request in
                seen = request
                return self.http(try self.sse("{\"ok\":true}", reasoning: "思维链不留下"))
            })
        let request = try XCTUnwrap(seen)
        XCTAssertEqual(request.url?.absoluteString, "https://example.invalid/compatible-mode/v1/chat/completions")
        XCTAssertEqual(request.httpMethod, "POST")
        assertNoSecret(request)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        XCTAssertEqual(body["model"] as? String, "qwen3.8-omni-flash")
        XCTAssertEqual(body["reasoning_effort"] as? String, "medium")
        XCTAssertEqual(body["max_tokens"] as? Int, 4096)
        XCTAssertEqual(body["modalities"] as? [String], ["text"])
        XCTAssertEqual(body["stream"] as? Bool, true)
        XCTAssertEqual(text, "{\"ok\":true}")
        XCTAssertFalse(text.contains("思维链"))
    }

    func testInsecureRealtimeURLDoesNotSendTheKey() async throws {
        var calls = 0
        do {
            _ = try await ThinkingTextClient.request(
                instructions: "请返回决策", image: nil,
                credentialURL: try XCTUnwrap(URL(string: "ws://127.0.0.1:8799/realtime")), apiKey: fixtureKey,
                transport: { _ in calls += 1; return self.http(Data()) })
            XCTFail("明文地址不能发出请求")
        } catch {
            XCTAssertEqual(calls, 0)
            XCTAssertFalse(String(describing: error).contains(fixtureKey))
        }
    }

    func testTimeoutAndHTTPErrorStayFreeOfTheKey() async throws {
        do {
            _ = try await ThinkingTextClient.request(
                instructions: "请返回决策", image: nil, credentialURL: try credentialURL(), apiKey: fixtureKey,
                timeout: .milliseconds(30),
                transport: { _ in
                    try await Task.sleep(for: .seconds(5))
                    return self.http(Data())
                })
            XCTFail("超时应失败")
        } catch {
            XCTAssertFalse(String(describing: error).contains(fixtureKey))
        }
        do {
            _ = try await ThinkingTextClient.request(
                instructions: "请返回决策", image: nil, credentialURL: try credentialURL(), apiKey: fixtureKey,
                transport: { _ in self.http(Data("no".utf8), status: 500) })
            XCTFail("错误状态应失败")
        } catch {
            XCTAssertFalse(String(describing: error).contains(fixtureKey))
            XCTAssertFalse(String(describing: error).contains("no"))
        }
    }

    func testGateRejectionCallsThinkingTextAndPlaysSpeech() async throws {
        let harness = try makeHarness(spoken: RealtimeTestSupport.passingUtterance, includePCM: true)
        try await rejectFastPath(harness)
        try await eventually { harness.speech.items.count == 1 }
        try await completeSpeech(harness.speech.items[0], spoken: RealtimeTestSupport.passingUtterance, pcm: pcm)
        try await eventually { harness.audio.played == [pcm] }
        XCTAssertEqual(harness.conductor.messages.last?.text, RealtimeTestSupport.passingUtterance)
        XCTAssertGreaterThanOrEqual(harness.requests.items.count, 2)
        harness.requests.items.forEach(assertNoSecret)
        let instructions = harness.speech.items[0].sent.compactMap { event -> String? in
            guard event["type"] as? String == "response.create",
                  let response = event["response"] as? [String: Any] else { return nil }
            return response["instructions"] as? String
        }
        XCTAssertTrue(instructions.contains { $0.hasPrefix("只逐字读这句话：") && $0.contains(RealtimeTestSupport.passingUtterance) })
        XCTAssertFalse(harness.audio.played.contains(Data([1])))
    }

    func testSpeechMismatchRetriesOnceThenFailsWithoutPlayback() async throws {
        let harness = try makeHarness(spoken: "完全另一句", includePCM: true)
        try await rejectFastPath(harness)
        try await eventually { harness.speech.items.count == 1 }
        try await completeSpeech(harness.speech.items[0], spoken: "完全另一句", pcm: pcm)
        try await eventually { harness.speech.items.count == 2 }
        try await completeSpeech(harness.speech.items[1], spoken: "完全另一句", pcm: pcm)
        try await eventually { harness.audio.said.contains("老师刚才没想好，你再说一遍好吗？") }
        XCTAssertTrue(harness.audio.played.isEmpty)
        XCTAssertFalse(harness.conductor.messages.contains { $0.text == RealtimeTestSupport.passingUtterance })
        XCTAssertEqual(harness.speech.items.count, 2)
    }

    func testCancelDuringSpeechDropsLateAudio() async throws {
        let harness = try makeHarness(spoken: RealtimeTestSupport.passingUtterance, includePCM: true)
        try await rejectFastPath(harness)
        try await eventually { harness.speech.items.count == 1 }
        let speech = harness.speech.items[0]
        try speech.emit(["type": "session.created"])
        try await eventually { speech.sent.contains { $0["type"] as? String == "session.update" } }
        try speech.emit(["type": "session.updated"])
        try await eventually { speech.sent.contains { $0["type"] as? String == "response.create" } }
        harness.conductor.interrupt()
        try speech.emit(["type": "response.created", "response": ["id": "late"]])
        try speech.emit(["type": "response.audio.delta", "response_id": "late", "delta": pcm.base64EncodedString()])
        try speech.emit(["type": "response.audio_transcript.delta", "response_id": "late", "delta": RealtimeTestSupport.passingUtterance])
        try speech.emit(["type": "response.done", "response": ["id": "late"]])
        try await Task.sleep(for: .milliseconds(80))
        XCTAssertTrue(harness.audio.played.isEmpty)
        XCTAssertFalse(harness.audio.said.contains("老师刚才没想好，你再说一遍好吗？"))
        XCTAssertFalse(harness.conductor.messages.contains { $0.text == RealtimeTestSupport.passingUtterance })
    }

    func testTimeoutDoesNotStartSpeechOrPlay() async throws {
        let harness = try makeHarness(spoken: RealtimeTestSupport.passingUtterance, includePCM: true, textTimeout: .milliseconds(40), hangText: true)
        try await rejectFastPath(harness)
        try await eventually { harness.audio.said.contains("老师刚才没想好，你再说一遍好吗？") }
        XCTAssertTrue(harness.speech.items.isEmpty)
        XCTAssertTrue(harness.audio.played.isEmpty)
    }

    private struct Harness {
        var conductor: TutorConductor
        var session: FakeRealtimeSession
        var audio: FakeTutorAudio
        var requests: RequestBox
        var speech: SpeechBox
        var slow: SlowPath
    }

    private func makeHarness(spoken: String, includePCM: Bool, textTimeout: Duration = .seconds(5), hangText: Bool = false) throws -> Harness {
        let gates = try RealtimeTestSupport.gates()
        let context = try RealtimeTestSupport.sampleContext()
        let requests = RequestBox()
        let speech = SpeechBox()
        let slow = WorkspaceClient.makeRealtimeSlowPath(
            gates: gates, credentialURL: try credentialURL(), apiKey: fixtureKey,
            textTimeout: textTimeout, speechTimeout: .seconds(5),
            textTransport: { request in
                requests.items.append(request)
                if hangText { try await Task.sleep(for: .seconds(5)) }
                let raw = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
                let text = raw.contains("抢答复核器") ? "{\"allowed\":true,\"reason\":\"none\"}" : self.decisionJSON()
                return self.http(try self.sse(text))
            },
            makeSpeechSession: { url, key in
                let transport = WorkspaceTestTransport()
                speech.items.append(transport)
                return RealtimeSession(url: url, apiKey: key) { made in
                    XCTAssertTrue((made.value(forHTTPHeaderField: "Authorization") ?? "").hasPrefix("Bearer "))
                    XCTAssertEqual((made.value(forHTTPHeaderField: "Authorization") ?? "").count, "Bearer ".count + key.count)
                    XCTAssertFalse(made.url?.absoluteString.contains(key) ?? false)
                    return transport
                }
            })
        let audio = FakeTutorAudio()
        let session = FakeRealtimeSession()
        let conductor = TutorConductor(session: session, gates: gates, audio: audio, slowPath: slow,
                                       context: { context })
        _ = spoken
        _ = includePCM
        return Harness(conductor: conductor, session: session, audio: audio, requests: requests, speech: speech, slow: slow)
    }

    private func rejectFastPath(_ harness: Harness) async throws {
        harness.conductor.childStartedSpeaking()
        harness.conductor.childFinishedSpeaking()
        try await eventually { harness.session.calls.contains("header") }
        harness.session.emitHeader("{\"transcript\":\"帮我\",\"kind\":\"help\"}")
        harness.session.emitReply(text: "答案是12吗？你算出来了吗？", audio: [Data([1])])
    }

    private func completeSpeech(_ transport: WorkspaceTestTransport, spoken: String, pcm: Data) async throws {
        try transport.emit(["type": "session.created"])
        try await eventually { transport.sent.contains { $0["type"] as? String == "session.update" } }
        try transport.emit(["type": "session.updated"])
        try await eventually { transport.sent.contains { $0["type"] as? String == "response.create" } }
        try transport.emit(["type": "response.created", "response": ["id": "speak"]])
        try transport.emit(["type": "response.audio_transcript.delta", "response_id": "speak", "delta": spoken])
        try transport.emit(["type": "response.audio.delta", "response_id": "speak", "delta": pcm.base64EncodedString()])
        try transport.emit(["type": "response.done", "response": ["id": "speak"]])
    }
}

@MainActor
private final class RequestBox {
    var items: [URLRequest] = []
}

@MainActor
private final class SpeechBox {
    var items: [WorkspaceTestTransport] = []
}
