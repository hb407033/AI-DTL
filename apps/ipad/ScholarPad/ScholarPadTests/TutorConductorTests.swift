import XCTest
@testable import ScholarPad

@MainActor
final class TutorConductorTests: XCTestCase {
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<100 { if predicate() { return }; try await Task.sleep(for: .milliseconds(10)) }
        XCTFail("条件未满足")
    }

    private func make(slow: SlowPath? = nil, context: GateContext? = nil, clock: @escaping () -> Date = Date.init) throws -> (TutorConductor, FakeRealtimeSession, FakeTutorAudio) {
        let session = FakeRealtimeSession()
        let audio = FakeTutorAudio()
        let gate = try context ?? RealtimeTestSupport.sampleContext()
        let conductor = TutorConductor(session: session, gates: try RealtimeTestSupport.gates(), audio: audio, slowPath: slow,
                                       context: { gate }, clock: clock)
        return (conductor, session, audio)
    }

    func testSelfTalkSendsNoReplyRequestAndAcknowledgesOnly() async throws {
        let (conductor, session, audio) = try make()
        conductor.childStartedSpeaking()
        conductor.childFinishedSpeaking()
        try await eventually { session.calls.contains("header") }
        session.emitHeader("{\"transcript\":\"我自己想想\",\"kind\":\"selfTalk\"}")
        XCTAssertFalse(session.calls.contains("reply"))
        XCTAssertEqual(audio.said, [WorkspaceClient.acknowledgements[0]])
        XCTAssertTrue(audio.played.isEmpty)
    }

    func testHeaderTextIsNeverPlayedOrShown() async throws {
        let (conductor, session, audio) = try make()
        conductor.childStartedSpeaking()
        conductor.childFinishedSpeaking()
        try await eventually { session.calls.contains("header") }
        session.emitHeader("{\"transcript\":\"帮我看看\",\"kind\":\"help\"}")
        session.emitReply(text: RealtimeTestSupport.passingUtterance, audio: [Data([1, 0]), Data([2, 0])])
        try await eventually { !audio.played.isEmpty }
        XCTAssertFalse(conductor.messages.contains { $0.text.contains("帮我看看") })
        XCTAssertFalse(audio.said.contains { $0.contains("帮我看看") })
        XCTAssertEqual(conductor.messages.map(\.text), [RealtimeTestSupport.passingUtterance])
    }

    func testImageAttachedOnlyWhenInkChanged() async throws {
        var gate = try RealtimeTestSupport.sampleContext()
        gate.inkChanged = false
        gate.canvasJPEG = Data([9])
        let (without, session, _) = try make(context: gate)
        without.childStartedSpeaking(); without.childFinishedSpeaking()
        try await eventually { session.calls.contains("header") }
        session.emitHeader("{\"transcript\":\"帮我\",\"kind\":\"help\"}")
        XCTAssertTrue(session.images.isEmpty)
        gate.inkChanged = true
        let (withInk, second, _) = try make(context: gate)
        withInk.childStartedSpeaking(); withInk.childFinishedSpeaking()
        try await eventually { second.calls.contains("header") }
        second.emitHeader("{\"transcript\":\"帮我\",\"kind\":\"question\"}")
        XCTAssertEqual(second.images, [Data([9])])
    }

    func testHelpBuffersAudioUntilDoneThenPlaysWhenGatePasses() async throws {
        let (conductor, session, audio) = try make()
        conductor.childStartedSpeaking(); conductor.childFinishedSpeaking()
        try await eventually { session.calls.contains("header") }
        session.emitHeader("{\"transcript\":\"帮我\",\"kind\":\"help\"}")
        session.onTextDelta?(RealtimeTestSupport.passingUtterance)
        session.onAudioDelta?(Data([1, 0]))
        session.onAudioDelta?(Data([2, 0]))
        XCTAssertTrue(audio.played.isEmpty)
        session.onResponseDone?(RealtimeUsage(inputTokens: 1, outputTokens: 1, totalTokens: 2))
        try await eventually { audio.played.count == 2 }
        XCTAssertEqual(audio.began, 1)
        XCTAssertEqual(audio.completed, 1)
    }

    func testGateRejectionDoesNotPlayAndReportsSlowPathRequest() async throws {
        let (conductor, session, audio) = try make()
        var reasons: [String] = []
        conductor.onNeedsSlowPath = { _, reason in reasons.append(reason) }
        conductor.childStartedSpeaking(); conductor.childFinishedSpeaking()
        try await eventually { session.calls.contains("header") }
        session.emitHeader("{\"transcript\":\"帮我\",\"kind\":\"help\"}")
        session.emitReply(text: "答案是12吗？你算出来了吗？", audio: [Data([1, 0])])
        try await eventually { !reasons.isEmpty }
        XCTAssertTrue(audio.played.isEmpty)
        XCTAssertFalse(reasons.isEmpty)
    }

    func testLatencyMeasuredFromChildFinishedToFirstPlay() async throws {
        var now = Date(timeIntervalSince1970: 1_000)
        let (conductor, session, audio) = try make(clock: { now })
        conductor.childStartedSpeaking()
        conductor.childFinishedSpeaking()
        now = now.addingTimeInterval(1.25)
        try await eventually { session.calls.contains("header") }
        session.emitHeader("{\"transcript\":\"帮我\",\"kind\":\"help\"}")
        session.emitReply(text: RealtimeTestSupport.passingUtterance, audio: [Data([1, 0])])
        try await eventually { !audio.played.isEmpty }
        XCTAssertEqual(conductor.latencyFromChildFinishedToFirstPlay ?? -1, 1.25, accuracy: 0.01)
    }

    func testAcknowledgementRotates() async throws {
        let (conductor, session, audio) = try make()
        for index in 0..<2 {
            conductor.childStartedSpeaking(); conductor.childFinishedSpeaking()
            try await eventually { session.calls.filter { $0 == "header" }.count == index + 1 }
            session.emitHeader("{\"transcript\":\"我再说\",\"kind\":\"idea\"}")
        }
        XCTAssertEqual(audio.said, [WorkspaceClient.acknowledgements[0], WorkspaceClient.acknowledgements[1]])
    }

    func testGateRejectionRunsSlowPathAndPlaysRewrite() async throws {
        let gates = try RealtimeTestSupport.gates()
        let context = try RealtimeTestSupport.sampleContext()
        let slow = SlowPath(gates: gates, requestText: { instructions, _ in
            if instructions.contains("抢答复核器") { return "{\"allowed\":true,\"reason\":\"none\"}" }
            return "{\"focus\":\"clarify\",\"observation\":\"孩子求助\",\"evidenceIds\":[\"t\"],\"utterance\":\"\(RealtimeTestSupport.passingUtterance)\",\"method\":\"ordinary\",\"handoff\":false}"
        }, speak: { text in (Data([4, 0]), text) })
        let (conductor, session, audio) = try make(slow: slow, context: context)
        conductor.childStartedSpeaking(); conductor.childFinishedSpeaking()
        try await eventually { session.calls.contains("header") }
        try await eventually { session.calls.contains("header") }
        session.emitHeader("{\"transcript\":\"帮我\",\"kind\":\"help\"}")
        session.emitReply(text: "答案是12吗？你算出来了吗？", audio: [Data([1, 0])])
        try await eventually { audio.played == [Data([4, 0])] }
        XCTAssertEqual(conductor.messages.last?.text, RealtimeTestSupport.passingUtterance)
    }

    func testSlowPathFailureSpeaksUnsurePrompt() async throws {
        let gates = try RealtimeTestSupport.gates()
        let slow = SlowPath(gates: gates, requestText: { _, _ in throw RealtimeKeyError.unavailable }, speak: { text in (Data(), text) })
        let (conductor, session, audio) = try make(slow: slow)
        conductor.childStartedSpeaking(); conductor.childFinishedSpeaking()
        try await eventually { session.calls.contains("header") }
        session.emitHeader("{\"transcript\":\"帮我\",\"kind\":\"help\"}")
        session.emitReply(text: "答案是12吗？你算出来了吗？", audio: [])
        try await eventually { audio.said.contains("老师刚才没想好，你再说一遍好吗？") }
    }

    func testAudioWithoutHeaderIsTreatedAsIdea() async throws {
        let (conductor, session, audio) = try make()
        conductor.childStartedSpeaking(); conductor.childFinishedSpeaking()
        try await eventually { session.calls.contains("header") }
        session.onAudioDelta?(Data([9, 0]))
        session.onResponseDone?(RealtimeUsage(inputTokens: 1, outputTokens: 0, totalTokens: 1))
        XCTAssertTrue(audio.played.isEmpty)
        XCTAssertEqual(audio.said, [WorkspaceClient.acknowledgements[0]])
        XCTAssertTrue(conductor.messages.isEmpty)
    }

    func testConnectionFailureBeforeReadyDropsBufferedAudioAndSpeaksUnheard() async throws {
        let (conductor, session, audio) = try make()
        session.state = .connecting
        session.failCommit = true
        conductor.childStartedSpeaking()
        conductor.childAudio(Data(repeating: 1, count: 3200))
        conductor.childFinishedSpeaking()
        try await eventually { audio.said.contains("刚才没听清，你再说一遍好吗？") }
        XCTAssertTrue(audio.played.isEmpty)
        XCTAssertEqual(audio.diskWrites, 0)
        XCTAssertFalse(session.closedReasons.isEmpty)
    }

    func testSpeechMismatchGoesSlowPath() async throws {
        let gates = try RealtimeTestSupport.gates()
        let slow = SlowPath(gates: gates, requestText: { instructions, _ in
            if instructions.contains("抢答复核器") { return "{\"allowed\":true,\"reason\":\"none\"}" }
            return "{\"focus\":\"clarify\",\"observation\":\"孩子求助\",\"evidenceIds\":[\"t\"],\"utterance\":\"\(RealtimeTestSupport.passingUtterance)\",\"method\":\"ordinary\",\"handoff\":false}"
        }, speak: { text in (Data([8, 0]), text) })
        let (conductor, session, audio) = try make(slow: slow)
        conductor.childStartedSpeaking(); conductor.childFinishedSpeaking()
        try await eventually { session.calls.contains("header") }
        session.emitHeader("{\"transcript\":\"帮我\",\"kind\":\"help\"}")
        session.emitReply(text: RealtimeTestSupport.passingUtterance, spoken: "完全另一句", audio: [Data([1, 0])])
        try await eventually { audio.played == [Data([8, 0])] }
    }

    func testInterruptStopsPlaybackAndMarksTurn() async throws {
        let (conductor, session, audio) = try make()
        conductor.interrupt()
        XCTAssertEqual(audio.stopped, 1)
        XCTAssertEqual(session.cancelled, 1)
        XCTAssertTrue(conductor.mergedContext().history.contains { $0.observation == "上一句没说完" })
    }

}
