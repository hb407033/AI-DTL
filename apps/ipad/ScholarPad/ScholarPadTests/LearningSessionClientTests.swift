import XCTest
@testable import ScholarPad

/// 练习模式客户端逻辑测试：迟到音频/图形事件丢弃、正常播放、信封 revision 校验。
/// 不触网、不触音频硬件：传输与播放均注入。
final class LearningSessionClientTests: XCTestCase {

    @MainActor
    final class MockTransport: LearningTransport {
        var sent: [String] = []
        var closed = false
        var onMessage: ((String) -> Void)?
        var onClose: (() -> Void)?
        func send(_ text: String) { sent.append(text) }
        func close() { closed = true }
    }

    @MainActor
    private func makeClient() -> (LearningSessionClient, MockTransport, UnsafeMutablePointer<Int>) {
        let transport = MockTransport()
        let played = UnsafeMutablePointer<Int>.allocate(capacity: 1)
        played.pointee = 0
        let client = LearningSessionClient(makeTransport: { _ in transport }, audioPlayback: { _ in played.pointee += 1 })
        client.connect(host: "127.0.0.1")
        client.handleIncoming(#"{"type":"ready","sessionId":"s-1","revision":0,"phase":"exploring","packVersion":"fraction-pack-2026-09-17-v1"}"#)
        return (client, transport, played)
    }

    @MainActor
    func testConnectSendsHelloWithoutSessionIdForNewSession() throws {
        let (client, transport, _) = makeClient()
        _ = client
        let hello = try XCTUnwrap(transport.sent.first.flatMap { $0.data(using: .utf8) }.flatMap {
            try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
        })
        XCTAssertEqual(hello["type"] as? String, "hello")
        XCTAssertNil(hello["sessionId"], "新会话的 hello 不带 sessionId")
    }

    @MainActor
    func testConnectWithSessionIdSendsHelloForResume() throws {
        let transport = MockTransport()
        let client = LearningSessionClient(makeTransport: { _ in transport }, audioPlayback: { _ in })
        client.connect(host: "127.0.0.1", sessionId: "s-9")
        let hello = try XCTUnwrap(transport.sent.first.flatMap { $0.data(using: .utf8) }.flatMap {
            try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
        })
        XCTAssertEqual(hello["type"] as? String, "hello")
        XCTAssertEqual(hello["sessionId"] as? String, "s-9", "恢复会话的 hello 必须带 sessionId")
    }

    @MainActor
    func testReadyExposesPromptRestoredAndChallenge() {
        let transport = MockTransport()
        let client = LearningSessionClient(makeTransport: { _ in transport }, audioPlayback: { _ in })
        var ready: LearningSessionClient.ReadyInfo?
        client.onReady = { ready = $0 }
        client.connect(host: "127.0.0.1")
        client.handleIncoming(#"{"type":"ready","sessionId":"s-7","revision":4,"phase":"exploring","challengeId":"fraction-compare-01","prompt":"两张同样大的纸，分别涂 3/4 和 2/3，哪张更多？","restored":true,"packVersion":"fraction-pack-2026-09-17-v1"}"#)
        XCTAssertEqual(ready, LearningSessionClient.ReadyInfo(sessionId: "s-7", revision: 4, phase: "exploring",
                                                            challengeId: "fraction-compare-01",
                                                            prompt: "两张同样大的纸，分别涂 3/4 和 2/3，哪张更多？",
                                                            restored: true, packVersion: "fraction-pack-2026-09-17-v1"))
        XCTAssertTrue(client.restored)
        XCTAssertTrue(client.connected)
        XCTAssertEqual(client.prompt, "两张同样大的纸，分别涂 3/4 和 2/3，哪张更多？")
    }

    @MainActor
    private func acceptSubmit(_ client: LearningSessionClient, revision: Int = 1, submissionId: String = "sub-1") {
        client.handleIncoming(#"{"type":"accepted","eventId":"e-1","command":"submit","revision":\#(revision),"phase":"reviewing","submissionId":"\#(submissionId)"}"#)
    }

    private func audioEvent(_ responseId: String) -> String {
        #"{"type":"audio","data":"\#(Data(repeating: 0, count: 960).base64EncodedString())","responseId":"\#(responseId)"}"#
    }

    @MainActor
    func testSubmitEnvelopeFreezesEvidenceWithCurrentRevision() {
        let (client, transport, _) = makeClient()
        client.submit(challengeId: "fraction-compare-01", boardRevision: 3, image: "aGVsbG8=",
                      board: ["revision": 3, "rectangles": []])
        XCTAssertEqual(transport.sent.count, 2) // hello + submit
        let raw = try! JSONSerialization.jsonObject(with: transport.sent[1].data(using: .utf8)!) as! [String: Any]
        XCTAssertEqual(raw["schemaVersion"] as? Int, 1)
        XCTAssertEqual(raw["sessionId"] as? String, "s-1")
        XCTAssertEqual(raw["revision"] as? Int, 0)
        XCTAssertEqual(raw["type"] as? String, "submit")
        XCTAssertNotNil(raw["submissionId"] as? String)
        XCTAssertEqual((raw["payload"] as? [String: Any])?["boardRevision"] as? Int, 3)
        XCTAssertEqual(raw["image"] as? String, "aGVsbG8=")
        XCTAssertNotNil(raw["board"])
    }

    @MainActor
    func testNormalPlaybackAndBoardActionWithoutInterrupt() {
        let (client, _, played) = makeClient()
        var actions: [LearningSessionClient.BoardAction] = []
        client.onBoardAction = { actions.append($0) }
        client.submit(challengeId: "fraction-compare-01", boardRevision: 3, image: "aGVsbG8=", board: ["revision": 3, "rectangles": []])
        acceptSubmit(client)
        XCTAssertEqual(client.revision, 1)
        XCTAssertEqual(client.phase, "reviewing")
        client.handleIncoming(audioEvent("r1"))
        XCTAssertEqual(played.pointee, 1)
        client.handleIncoming(#"{"type":"action","responseId":"r1","submissionId":"sub-1","boardRevision":4,"command":{"type":"showHintRectangle","rectangle":{"id":"agent-hint-c1","wholeGroupId":"whole-1","rows":3,"columns":4,"shadedCells":[0,1,2],"owner":"agent"}}}"#)
        XCTAssertEqual(actions, [.init(responseId: "r1", submissionId: "sub-1", boardRevision: 4,
                                       command: .showHintRectangle(id: "agent-hint-c1", wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2]))])
        client.handleIncoming(#"{"type":"feedback","feedbackId":"r1","submissionId":"sub-1"}"#)
        XCTAssertEqual(client.lastFeedbackId, "r1")
        client.handleIncoming(#"{"type":"responseDone","responseId":"r1","status":"completed"}"#)
    }

    @MainActor
    func testLateAudioAfterInterruptIsDroppedButNewResponsePlays() {
        let (client, transport, played) = makeClient()
        client.submit(challengeId: "fraction-compare-01", boardRevision: 3, image: "aGVsbG8=", board: ["revision": 3, "rectangles": []])
        acceptSubmit(client)
        client.handleIncoming(audioEvent("r1"))
        XCTAssertEqual(played.pointee, 1)
        client.interrupt()
        XCTAssertTrue(transport.sent.contains(#"{"type":"interrupt"}"#))
        client.handleIncoming(audioEvent("r1")) // 迟到音频：丢弃
        client.handleIncoming(#"{"type":"text","text":"迟到的文字","responseId":"r1"}"#)
        client.handleIncoming(#"{"type":"interrupted","responseId":"r1","reason":"interrupt"}"#)
        client.handleIncoming(audioEvent("r1"))
        XCTAssertEqual(played.pointee, 1)
        XCTAssertFalse(client.reply.contains("迟到"))
        client.handleIncoming(audioEvent("r2")) // 新响应不受影响
        XCTAssertEqual(played.pointee, 2)
    }

    @MainActor
    func testLateEventsAfterContestAreDropped() {
        let (client, transport, played) = makeClient()
        var actions: [LearningSessionClient.BoardAction] = []
        client.onBoardAction = { actions.append($0) }
        client.submit(challengeId: "fraction-compare-01", boardRevision: 3, image: "aGVsbG8=", board: ["revision": 3, "rectangles": []])
        acceptSubmit(client)
        client.handleIncoming(#"{"type":"feedback","feedbackId":"fb-1","submissionId":"sub-1"}"#)
        client.handleIncoming(audioEvent("r2"))
        XCTAssertEqual(played.pointee, 1)
        client.contest(feedbackId: "fb-1")
        let contest = try! JSONSerialization.jsonObject(with: transport.sent.last!.data(using: .utf8)!) as! [String: Any]
        XCTAssertEqual(contest["type"] as? String, "contest")
        XCTAssertEqual(contest["revision"] as? Int, 1)
        XCTAssertEqual((contest["payload"] as? [String: Any])?["feedbackId"] as? String, "fb-1")
        client.handleIncoming(#"{"type":"accepted","eventId":"e-2","command":"contest","revision":2,"phase":"clarifying"}"#)
        // 异议后：旧响应迟到音频、旧提交迟到图形动作全部丢弃
        client.handleIncoming(audioEvent("r2"))
        XCTAssertEqual(played.pointee, 1)
        client.handleIncoming(#"{"type":"action","responseId":"r2","submissionId":"sub-1","boardRevision":5,"command":{"type":"hideHint","objectId":"agent-hint-c1"}}"#)
        XCTAssertTrue(actions.isEmpty)
    }

    @MainActor
    func testLateBoardActionAfterTransferIsDropped() {
        let (client, _, played) = makeClient()
        var actions: [LearningSessionClient.BoardAction] = []
        client.onBoardAction = { actions.append($0) }
        client.submit(challengeId: "fraction-compare-01", boardRevision: 3, image: "aGVsbG8=", board: ["revision": 3, "rectangles": []])
        acceptSubmit(client)
        client.startTransfer(challengeId: "fraction-transfer-01")
        client.handleIncoming(#"{"type":"accepted","eventId":"e-2","command":"startTransfer","revision":2,"phase":"transfer"}"#)
        client.handleIncoming(#"{"type":"action","responseId":"r1","submissionId":"sub-1","boardRevision":4,"command":{"type":"showHintRectangle","rectangle":{"id":"agent-hint-c1","wholeGroupId":"whole-1","rows":1,"columns":2,"shadedCells":[0],"owner":"agent"}}}"#)
        XCTAssertTrue(actions.isEmpty, "切题后旧提交的图形不得应用到新画布")
        _ = played
    }

    @MainActor
    func testEnvelopeRevisionValidation() {
        let (client, _, _) = makeClient()
        // 乱序/跳跃的确认不改变本地进度
        client.handleIncoming(#"{"type":"accepted","eventId":"e-x","command":"submit","revision":3,"phase":"reviewing","submissionId":"sub-9"}"#)
        XCTAssertEqual(client.revision, 0)
        XCTAssertEqual(client.phase, "exploring")
        XCTAssertTrue(client.status.contains("不同步"))
        // 正常前进一步
        acceptSubmit(client)
        XCTAssertEqual(client.revision, 1)
        // 重复确认被忽略
        client.handleIncoming(#"{"type":"accepted","eventId":"e-1","command":"submit","revision":1,"phase":"clarifying","submissionId":"sub-1"}"#)
        XCTAssertEqual(client.revision, 1)
        XCTAssertEqual(client.phase, "reviewing")
        // 被拒绝不改变 revision
        client.handleIncoming(#"{"type":"rejected","eventId":"e-9","reason":"staleRevision"}"#)
        XCTAssertEqual(client.revision, 1)
    }

    @MainActor
    func testStopDropsEverything() {
        let (client, transport, played) = makeClient()
        client.submit(challengeId: "fraction-compare-01", boardRevision: 3, image: "aGVsbG8=", board: ["revision": 3, "rectangles": []])
        acceptSubmit(client)
        client.stop()
        XCTAssertTrue(transport.closed)
        client.handleIncoming(audioEvent("r1"))
        client.handleIncoming(#"{"type":"accepted","eventId":"e-9","command":"submit","revision":2,"phase":"reviewing","submissionId":"sub-1"}"#)
        XCTAssertEqual(played.pointee, 0)
        XCTAssertEqual(client.revision, 0)
        XCTAssertEqual(client.phase, "")
        XCTAssertEqual(client.status, "已停止，画布保留。")
    }

    @MainActor
    func testVoiceIntentNeverAutoSubmits() {
        let (client, transport, _) = makeClient()
        var intents: [LearningSessionClient.VoiceIntent] = []
        client.onVoiceIntent = { intent, _ in intents.append(intent) }
        client.handleIncoming(#"{"type":"voiceIntent","intent":"submit","transcript":"我做好了。"}"#)
        XCTAssertEqual(intents, [.submit])
        let nonHello = transport.sent.filter { !$0.contains(#""type":"hello""#) }
        XCTAssertTrue(nonHello.isEmpty, "语音意图绝不自动变成提交信封")
    }
}
