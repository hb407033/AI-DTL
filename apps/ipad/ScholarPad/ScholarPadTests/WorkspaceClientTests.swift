import XCTest
@testable import ScholarPad

@MainActor
private final class WorkspaceTestTransport: WorkspaceTransport {
    var sent: [[String: Any]] = []
    var frames = 0
    var failFrame: Int?
    var closed = false
    var onSend: (([String: Any]) throws -> Void)?
    private var buffered: [String] = []
    private var receiver: CheckedContinuation<String, Error>?
    func sendText(_ text: String) async throws {
        let e = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        sent.append(e); try onSend?(e)
    }
    func sendPCM(_ data: Data) async throws {
        frames += 1
        if frames == failFrame { throw URLError(.networkConnectionLost) }
    }
    func receiveText() async throws -> String {
        if closed { throw URLError(.cancelled) }
        if !buffered.isEmpty { return buffered.removeFirst() }
        return try await withCheckedThrowingContinuation { receiver = $0 }
    }
    func emit(_ event: [String: Any]) throws {
        let text = String(decoding: try JSONSerialization.data(withJSONObject: event), as: UTF8.self)
        if let receiver { self.receiver = nil; receiver.resume(returning: text) } else { buffered.append(text) }
    }
    func close() { closed = true; receiver?.resume(throwing: URLError(.cancelled)); receiver = nil }
}

@MainActor
final class WorkspaceClientTests: XCTestCase {
    func testRecoverableReplyFailureKeepsConversationAndLatestExpressionForNextTurn() async throws {
        var record = try fixture()
        let original = record, transport = WorkspaceTestTransport()
        let client = WorkspaceClient(transportFactory: { _ in transport })
        client.record = { record }; client.acceptRecord = { record = $0 }
        defer { client.pause() }
        let turn = try await pendingReply(client, transport: transport)
        client.receive(["type": "transcript", "turnId": turn, "text": "这条线表示一升果汁。", "action": "uncertain"])
        client.receive(["type": "responseStart", "turnId": turn, "responseId": "reply"])
        client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "reply"])
        let completed = client.completedTurns
        var latest = record; latest.revision += 1
        client.receive(["type": "error", "recoverable": true, "code": "decisionNeedsReview",
                        "turnId": turn, "responseId": "reply", "record": try object(latest)])
        XCTAssertTrue(client.connected); XCTAssertFalse(transport.closed)
        XCTAssertFalse(client.working); XCTAssertFalse(client.thinking); XCTAssertFalse(client.canAuthorize)
        XCTAssertNil(client.recovery)
        XCTAssertEqual(client.completedTurns, completed, "失败不能被标为一次成功回复")
        XCTAssertEqual(record.revision, latest.revision)
        XCTAssertEqual(record.childInkBase64, original.childInkBase64)
        XCTAssertEqual(record.feedback, original.feedback)
        XCTAssertEqual(client.transcript, "这条线表示一升果汁。")
        XCTAssertEqual(client.messages.map(\.text), ["这条线表示一升果汁。"])
        XCTAssertEqual(client.reply, "")
        XCTAssertTrue(client.status.contains("老师刚才没想好"), client.status)
        XCTAssertTrue(client.status.contains("再说一遍"), client.status)
        let recoveryStatus = client.status
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertEqual(client.status, recoveryStatus, "重新监听后仍需如实说明本轮未回应")
        XCTAssertEqual(transport.frames, 1, "不能自动重发失败录音")
        XCTAssertEqual(transport.sent.filter { $0["type"] as? String == "voiceEnd" }.count, 1)
        for type in ["responseStart", "thinkingStart", "responseDone"] {
            client.receive(["type": type, "turnId": turn, "responseId": "reply", "text": "迟到的旧答案"])
        }
        XCTAssertFalse(client.working); XCTAssertFalse(client.thinking)
        XCTAssertEqual(client.reply, ""); XCTAssertEqual(client.completedTurns, completed)

        var frozen: String?
        client.evidence = { text in
            frozen = text
            return WorkspaceEvidence(submissionId: "next-snapshot", problemId: record.problem!.problemId,
                problemRevision: record.problem!.statement.revision, boardRevision: 0, previewId: "next-preview", explanation: text)
        }
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { transport.sent.filter { $0["type"] as? String == "voiceEnd" }.count == 2 }
        let nextTurn = try XCTUnwrap(transport.sent.last?["turnId"] as? String)
        XCTAssertNotEqual(nextTurn, turn)
        client.receive(["type": "transcript", "turnId": nextTurn, "text": "帮我一下。", "action": "help"])
        try await eventually { frozen != nil }
        XCTAssertEqual(frozen, "这条线表示一升果汁。", "恢复后保留孩子最近的表达作为证据")
        client.receive(["type": "responseStart", "turnId": nextTurn, "responseId": "next-reply"])
        client.receive(["type": "responseDone", "turnId": nextTurn, "responseId": "next-reply", "text": "你想怎么检验？"])
        XCTAssertFalse(client.working); XCTAssertEqual(client.completedTurns, completed + 1)
        XCTAssertEqual(client.messages.map(\.role), ["我", "我", "老师"])
        XCTAssertEqual(transport.sent.filter { $0["type"] as? String == "hello" }.count, 1)
    }
    func testRecoverableReplyFailureCodesReleaseOnlyTheCurrentTurn() async throws {
        for code in ["decisionNeedsReview", "speechMismatch", "providerTimeout", "providerError", "connectionClosed", "connectionFailed", "workspaceVoiceFailed"] {
            let record = try fixture(), transport = WorkspaceTestTransport()
            let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
            defer { client.pause() }
            let turn = try await pendingReply(client, transport: transport)
            client.receive(["type": "error", "recoverable": true, "code": code, "turnId": turn, "responseId": "reply"])
            XCTAssertTrue(client.connected, code); XCTAssertFalse(transport.closed, code)
            XCTAssertFalse(client.working, code); XCTAssertFalse(client.thinking, code)
            XCTAssertEqual(client.completedTurns, 0, code)
        }
    }
    func testRecoverableReplyFailureIgnoresWrongTurnOrResponseAndItsRecord() async throws {
        var record = try fixture()
        let transport = WorkspaceTestTransport(), client = WorkspaceClient(transportFactory: { _ in transport })
        client.record = { record }; client.acceptRecord = { record = $0 }
        defer { client.pause() }
        let turn = try await pendingReply(client, transport: transport)
        var stale = record; stale.revision += 1
        let status = client.status
        for identity in [("old-turn", "reply"), (turn, "old-reply")] {
            client.receive(["type": "error", "recoverable": true, "code": "providerTimeout",
                            "turnId": identity.0, "responseId": identity.1, "record": try object(stale)])
            XCTAssertTrue(client.connected); XCTAssertTrue(client.working); XCTAssertTrue(client.thinking)
            XCTAssertEqual(client.status, status); XCTAssertEqual(record.revision, 0)
        }
    }
    func testRecoverableReplyFailureCannotRestartListeningWhileInterruptingOrEnding() async throws {
        for exiting in [false, true] {
            let record = try fixture(), transport = WorkspaceTestTransport()
            let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
            defer { client.pause() }
            let turn = try await pendingReply(client, transport: transport)
            let failure: [String: Any] = ["type": "error", "recoverable": true, "code": "providerError", "turnId": turn, "responseId": "reply"]
            if exiting {
                transport.onSend = { event in
                    if event["type"] as? String == "interrupt" {
                        client.receive(failure)
                        XCTAssertTrue(client.connected); XCTAssertFalse(client.listening)
                        try transport.emit(["type": "interrupted", "turnId": turn])
                    }
                }
                var saved = false
                await client.finishSession {
                    client.receive(failure)
                    try? await Task.sleep(for: .milliseconds(500))
                    XCTAssertFalse(client.listening); XCTAssertTrue(client.working)
                    saved = true
                }
                XCTAssertTrue(saved); XCTAssertTrue(transport.closed)
            } else {
                client.interruptReply()
                let status = client.status
                client.receive(failure)
                try await Task.sleep(for: .milliseconds(500))
                XCTAssertTrue(client.connected); XCTAssertFalse(transport.closed)
                XCTAssertTrue(client.working); XCTAssertFalse(client.listening)
                XCTAssertEqual(client.status, status)
                client.receive(["type": "interrupted", "turnId": turn])
                XCTAssertFalse(client.working)
            }
        }
    }
    func testLegacyAndFatalReplyErrorsStillCloseConnection() async throws {
        let cases: [(String, Bool?)] = [("providerTimeout", nil), ("recordMissing", true), ("recordCorrupt", true), ("notAuthorized", true)]
        for (code, recoverable) in cases {
            let record = try fixture(), transport = WorkspaceTestTransport()
            let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
            defer { client.pause() }
            let turn = try await pendingReply(client, transport: transport)
            var event: [String: Any] = ["type": "error", "code": code, "turnId": turn, "responseId": "reply"]
            if let recoverable { event["recoverable"] = recoverable }
            client.receive(event)
            XCTAssertFalse(client.connected, code); XCTAssertTrue(transport.closed, code)
            XCTAssertFalse(client.working, code); XCTAssertFalse(client.thinking, code)
        }
    }
    func testRecoverableReplyFailureRejectsRecordFromAnotherWork() async throws {
        for changeProblem in [false, true] {
            var record = try fixture()
            let original = record, transport = WorkspaceTestTransport()
            let client = WorkspaceClient(transportFactory: { _ in transport })
            client.record = { record }; client.acceptRecord = { record = $0 }
            defer { client.pause() }
            let turn = try await pendingReply(client, transport: transport)
            var other = record
            if changeProblem { other.problem?.statement.revision += 1 }
            else { other.sessionId = UUID().uuidString }
            client.receive(["type": "error", "recoverable": true, "code": "providerTimeout", "turnId": turn,
                            "responseId": "reply", "record": try object(other)])
            XCTAssertEqual(record, original)
            XCTAssertFalse(client.connected); XCTAssertTrue(transport.closed)
        }
    }
    private func pendingReply(_ client: WorkspaceClient, transport: WorkspaceTestTransport) async throws -> String {
        client.connect(host: "127.0.0.1", microphone: false)
        try transport.emit(["type": "ready"])
        try await eventually { client.connected }
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { transport.sent.contains { $0["type"] as? String == "voiceEnd" } }
        let turn = try XCTUnwrap(transport.sent.last?["turnId"] as? String)
        client.receive(["type": "responseStart", "turnId": turn, "responseId": "reply"])
        client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "reply"])
        return turn
    }
    func testMissingOldWorkExplainsHostMismatchAndCanReconnectWithoutLosingDraft() async throws {
        let record = try fixture(), first = WorkspaceTestTransport(), second = WorkspaceTestTransport()
        var transports = [first, second]
        let client = WorkspaceClient(transportFactory: { _ in transports.removeFirst() })
        client.record = { record }
        defer { client.pause() }
        client.connect(host: "wrong-host.local", microphone: false)
        try first.emit(["type": "ready"])
        try await eventually { client.connected }
        client.receive(["type": "error", "code": "recordMissing"])
        XCTAssertFalse(client.connected)
        XCTAssertFalse(client.working)
        XCTAssertTrue(client.status.contains("当前主机没有这份作品"), client.status)
        XCTAssertFalse(client.status.contains("重新开启"), "缺档不能让孩子无限重试同一台主机")
        XCTAssertEqual(client.record?()?.sessionId, record.sessionId)
        client.connect(host: "right-host.local", microphone: false)
        try second.emit(["type": "ready"])
        try await eventually { client.connected }
        XCTAssertEqual(second.sent.first?["sessionId"] as? String, record.sessionId)
        XCTAssertFalse(client.working)
    }
    func testSpokenCorrectionContinuationWaitsForTeacherInsteadOfCompletingTurnEarly() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
        client.connect(host: "127.0.0.1", microphone: false)
        defer { client.pause() }
        try transport.emit(["type": "ready"])
        try await eventually { client.connected }
        client.receive(["type": "corrected", "continuing": true])
        XCTAssertEqual(client.completedTurns, 0)
        XCTAssertTrue(client.working)
        XCTAssertFalse(client.listening)
    }
    func testConversationKeepsTurnOrderAcrossPauseAndClearsOnlyOnWorkChange() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
        client.connect(host: "127.0.0.1", microphone: false)
        defer { client.pause() }
        try transport.emit(["type": "ready"])
        try await eventually { client.connected }
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { transport.sent.contains { $0["type"] as? String == "voiceEnd" } }
        let turn = try XCTUnwrap(transport.sent.last?["turnId"] as? String)
        client.receive(["type": "transcript", "turnId": turn, "text": "我想再分一次", "action": "uncertain"])
        client.receive(["type": "transcript", "turnId": turn, "text": "我想再分一次", "action": "uncertain"])
        client.receive(["type": "responseStart", "turnId": turn, "responseId": "reply"])
        client.receive(["type": "responseDone", "turnId": turn, "responseId": "reply", "text": "你想怎么检验？"])
        XCTAssertEqual(client.messages.map(\.role), ["我", "老师"])
        XCTAssertEqual(client.messages.map(\.text), ["我想再分一次", "你想怎么检验？"])
        client.receive(["type": "corrected", "turnId": turn])
        XCTAssertTrue(client.messages.last?.contested == true)
        client.pause()
        XCTAssertEqual(client.messages.count, 2)
        client.resetForWorkChange()
        XCTAssertTrue(client.messages.isEmpty)
    }
    func testExplicitDiscussionFreezesPhotoAndStartsTeacherWithoutChildAudio() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        transport.onSend = { event in
            if event["type"] as? String == "hello" { try transport.emit(["type": "ready", "discussionOpeningSupported": true]) }
        }
        let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
        var frozen: String?
        client.evidence = { text in
            frozen = text
            return WorkspaceEvidence(submissionId: "snapshot", problemId: record.problem!.problemId,
                problemRevision: record.problem!.statement.revision, boardRevision: 0, previewId: "photo-preview", explanation: text)
        }
        client.connect(host: "127.0.0.1", microphone: false, conversationMode: "dialogue", leadDiscussion: true)
        defer { client.pause() }
        try await eventually { transport.sent.contains { $0["type"] as? String == "startDiscussion" } }
        XCTAssertEqual(frozen, "")
        XCTAssertEqual(transport.frames, 0)
        XCTAssertFalse(transport.sent.contains { $0["type"] as? String == "voiceStart" })
        XCTAssertTrue(client.working); XCTAssertFalse(client.listening)
        let opening = try XCTUnwrap(transport.sent.last)
        let turn = try XCTUnwrap(opening["turnId"] as? String)
        client.receive(["type": "responseStart", "turnId": turn, "responseId": "r"])
        client.receive(["type": "responseDone", "turnId": turn, "responseId": "r", "text": "我们先检查哪一题？"])
        try await eventually { !client.working }
        XCTAssertEqual(client.reply, "我们先检查哪一题？")
        XCTAssertTrue(client.connected)
    }
    func testOlderHostKeepsDialogueUsableWithoutSendingUnsupportedOpening() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        transport.onSend = { event in
            if event["type"] as? String == "hello" { try transport.emit(["type": "ready"]) }
        }
        let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
        client.connect(host: "127.0.0.1", microphone: false, conversationMode: "dialogue", leadDiscussion: true)
        defer { client.pause() }
        try await eventually { client.connected }
        XCTAssertFalse(client.working)
        XCTAssertFalse(transport.sent.contains { $0["type"] as? String == "startDiscussion" })
    }
    func testInterruptKeepsConnectionRejectsLateReplyAndAllowsNextTurn() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        transport.onSend = { event in
            if event["type"] as? String == "hello" { try transport.emit(["type": "ready"]) }
            if event["type"] as? String == "interrupt" {
                try transport.emit(["type": "responseStart", "turnId": event["turnId"]!, "responseId": "late"])
                try transport.emit(["type": "interrupted", "turnId": event["turnId"]!])
            }
        }
        let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
        client.connect(host: "127.0.0.1", microphone: false, conversationMode: "dialogue")
        defer { client.pause() }
        try await eventually { client.connected }
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { transport.sent.contains { $0["type"] as? String == "voiceEnd" } }
        let oldTurn = try XCTUnwrap(transport.sent.last?["turnId"] as? String)
        client.interruptReply()
        client.authorize("correct")
        try await eventually { !client.working }
        XCTAssertFalse(transport.sent.contains { $0["type"] as? String == "authorize" }, "取消回执前不启动竞争中的纠正")
        XCTAssertTrue(client.connected); XCTAssertFalse(transport.closed)
        client.receive(["type": "responseStart", "turnId": oldTurn, "responseId": "late"])
        client.receive(["type": "responseDone", "turnId": oldTurn, "responseId": "late", "text": "迟到旧答案"])
        XCTAssertFalse(client.working); XCTAssertEqual(client.reply, "")
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { transport.sent.filter { $0["type"] as? String == "voiceEnd" }.count == 2 }
        XCTAssertEqual(transport.sent.filter { $0["type"] as? String == "hello" }.count, 1)
        XCTAssertNotEqual(transport.sent.last?["turnId"] as? String, oldTurn)
    }
    func testThinkingUsesTurnAndResponseIdentityAndRejectsLateStartDuringInterrupt() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
        client.connect(host: "127.0.0.1", microphone: false)
        defer { client.pause() }
        try transport.emit(["type": "ready"])
        try await eventually { client.connected }
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { transport.sent.contains { $0["type"] as? String == "voiceEnd" } }
        let turn = try XCTUnwrap(transport.sent.last?["turnId"] as? String)
        client.receive(["type": "responseStart", "turnId": turn, "responseId": "r"])
        client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "old"])
        XCTAssertFalse(client.thinking)
        client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "r"])
        XCTAssertTrue(client.thinking)
        for type in ["thinkingEnd", "thinkingCancel"] {
            client.receive(["type": type, "turnId": turn, "responseId": "old"])
            client.receive(["type": type, "turnId": "old-turn", "responseId": "r"])
            XCTAssertTrue(client.thinking)
        }
        client.interruptReply()
        client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "r"])
        XCTAssertFalse(client.thinking)
        client.receive(["type": "interrupted", "turnId": turn])
        XCTAssertFalse(client.thinking)
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { transport.sent.filter { $0["type"] as? String == "voiceEnd" }.count == 2 }
        client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "r"])
        XCTAssertFalse(client.thinking)
    }
    func testThinkingClearsOnNormalCompletionAndIgnoresEventsDuringExit() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
        client.connect(host: "127.0.0.1", microphone: false)
        defer { client.pause() }
        try transport.emit(["type": "ready"])
        try await eventually { client.connected }
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { transport.sent.contains { $0["type"] as? String == "voiceEnd" } }
        let turn = try XCTUnwrap(transport.sent.last?["turnId"] as? String)
        client.receive(["type": "responseStart", "turnId": turn, "responseId": "r"])
        client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "r"])
        client.receive(["type": "responseDone", "turnId": turn, "responseId": "r", "text": "接着试试。"])
        XCTAssertFalse(client.thinking)
        client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "r"])
        XCTAssertFalse(client.thinking, "已完成回复不能被迟到思考事件重新打开")
        try await eventually { !client.working }
        client.receive(["type": "responseStart", "turnId": turn, "responseId": "r2"])
        client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "r2"])
        XCTAssertTrue(client.thinking)
        transport.onSend = { event in
            if event["type"] as? String == "interrupt" {
                try transport.emit(["type": "interrupted", "turnId": turn])
            }
        }
        // 退出保存期间连接尚未关闭，但 ending 已生效。
        var saved = false
        await client.finishSession {
            client.receive(["type": "thinkingStart", "turnId": turn, "responseId": "r2"])
            XCTAssertFalse(client.thinking)
            saved = true
        }
        XCTAssertTrue(saved)
    }
    func testHelpRetainsPrecedingExpressionAsEvidenceInsteadOfAuthorizationPhrase() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        let client = WorkspaceClient(transportFactory: { _ in transport })
        client.record = { record }
        var frozen: String?
        client.evidence = { text in
            frozen = text
            return WorkspaceEvidence(submissionId: "s", problemId: record.problem!.problemId,
                problemRevision: 0, boardRevision: 0, previewId: "preview", explanation: text)
        }
        client.connect(host: "127.0.0.1", microphone: false)
        defer { client.pause() }
        try transport.emit(["type": "ready"])
        try await eventually { client.connected }
        try transport.emit(["type": "transcript", "text": "这条线表示一升果汁。", "action": "uncertain"])
        try await eventually { client.transcript.contains("一升") }
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { transport.sent.contains { $0["type"] as? String == "voiceEnd" } }
        try transport.emit(["type": "transcript", "text": "帮我一下。", "action": "help"])
        try await eventually { frozen != nil }
        XCTAssertEqual(frozen, "这条线表示一升果汁。")
    }
    func testWorkChangeClearsPriorConversationAndDoesNotReconnect() async throws {
        let record = try fixture()
        let transport = WorkspaceTestTransport()
        let client = WorkspaceClient(transportFactory: { _ in transport })
        client.record = { record }
        client.connect(host: "127.0.0.1", microphone: false)
        try transport.emit(["type": "ready"])
        try await eventually { client.connected }
        try transport.emit(["type": "transcript", "text": "上一份作品的想法", "action": "express"])
        try await eventually { !client.transcript.isEmpty }
        client.resetForWorkChange()
        XCTAssertEqual(client.transcript, "")
        XCTAssertEqual(client.reply, "")
        XCTAssertEqual(client.completedTurns, 0)
        XCTAssertTrue(transport.closed)
        XCTAssertFalse(client.connected)
        XCTAssertFalse(client.listening)
    }
    private func fixture() throws -> WorkspaceRecord {
        struct Fixture: Decodable { var emptyRecord: WorkspaceRecord; var curated: WorkspaceProblem }
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "workspace-learning-v2", withExtension: "json"))
        let f = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        var record = f.emptyRecord; record.problem = f.curated; record.phase = "exploring"
        record.feedback = [.init(responseId: "prior-response", turnId: "prior-turn", summary: "上次的理解", contested: false)]
        return record
    }
    private func object(_ record: WorkspaceRecord) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<100 { if predicate() { return }; try await Task.sleep(for: .milliseconds(10)) }
        XCTFail("条件未满足")
    }
    func testRestoredFeedbackCanBeContestedWithoutOpeningMicrophoneOrSendingAudio() async throws {
        var record = try fixture()
        let transport = WorkspaceTestTransport()
        transport.onSend = { event in
            if event["type"] as? String == "hello" { try transport.emit(["type": "ready", "record": self.object(record)]) }
            if event["type"] as? String == "authorize" {
                XCTAssertEqual(event["action"] as? String, "correct")
                XCTAssertEqual(event["turnId"] as? String, "prior-turn")
                record.revision += 1; record.feedback[0].contested = true
                try transport.emit(["type": "corrected", "turnId": "prior-turn", "record": self.object(record)])
            }
        }
        let client = WorkspaceClient(transportFactory: { _ in transport })
        client.record = { record }; client.acceptRecord = { record = $0 }
        client.correctLastFeedback(host: "127.0.0.1")
        try await eventually { record.feedback[0].contested && transport.closed }
        XCTAssertFalse(client.connected); XCTAssertFalse(client.listening)
        XCTAssertEqual(transport.frames, 0)
        XCTAssertEqual(transport.sent.compactMap { $0["type"] as? String }, ["hello", "authorize"])
        XCTAssertTrue(client.status.contains("异议"))
    }
    func testFrameSendFailureDoesNotSendVoiceEndOrClaimSuccessfulSubmission() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        transport.failFrame = 2
        transport.onSend = { event in if event["type"] as? String == "hello" { try transport.emit(["type": "ready", "record": self.object(record)]) } }
        let client = WorkspaceClient(transportFactory: { _ in transport })
        client.record = { record }
        client.connect(host: "127.0.0.1", microphone: false)
        try await eventually { client.connected }
        client.submitPCM(Data(repeating: 0, count: 9600))
        try await eventually { transport.closed }
        XCTAssertFalse(client.working); XCTAssertFalse(client.listening)
        XCTAssertFalse(transport.sent.contains { $0["type"] as? String == "voiceEnd" })
        XCTAssertTrue(client.status.contains("没连上老师"), client.status)
    }
    func testExitSavesBeforeClosingTransportAndDoesNotRestartMicrophone() async throws {
        let record = try fixture(), transport = WorkspaceTestTransport()
        transport.onSend = { event in if event["type"] as? String == "hello" { try transport.emit(["type": "ready", "record": self.object(record)]) } }
        let client = WorkspaceClient(transportFactory: { _ in transport }); client.record = { record }
        client.connect(host: "127.0.0.1", microphone: false)
        try await eventually { client.connected }
        var saved = false
        await client.finishSession {
            XCTAssertFalse(transport.closed)
            XCTAssertFalse(client.listening)
            saved = true
        }
        XCTAssertTrue(saved); XCTAssertTrue(transport.closed); XCTAssertFalse(client.connected)
    }
    func testExitDuringResponseWaitsForStopReceiptAndSavesItsRevision() async throws {
        var record = try fixture()
        let transport = WorkspaceTestTransport()
        transport.onSend = { e in
            switch e["type"] as? String {
            case "hello": try transport.emit(["type": "ready", "record": self.object(record)])
            case "voiceEnd": try transport.emit(["type": "transcript", "turnId": e["turnId"]!, "text": "每米是什么意思", "action": "uncertain"])
            case "authorize": try transport.emit(["type": "responseStart", "turnId": e["turnId"]!, "responseId": e["eventId"]!])
            case "interrupt":
                record.revision += 1
                try transport.emit(["type": "interrupted", "turnId": e["turnId"]!, "record": self.object(record)])
            default: break
            }
        }
        let client = WorkspaceClient(transportFactory: { _ in transport })
        var local = record
        client.record = { local }; client.acceptRecord = { local = $0 }
        client.connect(host: "127.0.0.1", microphone: false)
        try await eventually { client.connected }
        client.submitPCM(Data(repeating: 0, count: 3200))
        try await eventually { client.canAuthorize }
        client.authorize("clarify")
        try await eventually { transport.sent.contains { $0["type"] as? String == "authorize" } }
        var saved = false
        await client.finishSession {
            XCTAssertEqual(local.revision, 1)
            XCTAssertFalse(transport.closed); XCTAssertFalse(client.listening)
            saved = true
        }
        XCTAssertTrue(saved); XCTAssertTrue(transport.closed)
        XCTAssertEqual(transport.sent.last?["type"] as? String, "interrupt")
    }
}
