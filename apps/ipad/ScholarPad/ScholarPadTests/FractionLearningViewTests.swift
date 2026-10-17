// 分数探索视图模型测试（工作包 E）：恢复决策、按钮状态机、迁移新作答空间、删除与清空分离、voiceIntent 不自动提交。
// 不触网、不触音频硬件：传输、删除、lastSessionId 存储均注入；草稿落在临时目录。
import XCTest
import PencilKit
@testable import ScholarPad

final class FractionLearningViewTests: XCTestCase {
    @MainActor
    func testBackgroundReturnsToManualResumeEntryAndKeepsDraft() throws {
        let harness = makeHarness()
        harness.model.startFresh(host: "127.0.0.1")
        harness.client.handleIncoming(#"{"type":"ready","sessionId":"background-session","revision":0,"phase":"exploring","challengeId":"fraction-compare-01","prompt":"题干","restored":false,"packVersion":"fraction-pack-2026-09-17-v1"}"#)
        harness.model.addPaper()
        harness.model.leaveForBackground()
        XCTAssertEqual(harness.model.stage, .entry)
        XCTAssertFalse(harness.client.connected)
        XCTAssertNotNil(harness.model.draftSummary)
        let draft = try XCTUnwrap(harness.cache.loadDraft(sessionId: "background-session"))
        XCTAssertEqual(draft.board.rectangles.count, 1)
        XCTAssertFalse(draft.synced)
        let messages = harness.transport.sent.count
        harness.model.prepareEntry()
        XCTAssertEqual(harness.transport.sent.count, messages, "恢复入口不能自动连接或提交")
    }

    @MainActor
    final class MockTransport: LearningTransport {
        var sent: [String] = []
        var onMessage: ((String) -> Void)?
        var onClose: (() -> Void)?
        func send(_ text: String) { sent.append(text) }
        func close() {}
    }

    @MainActor
    final class SessionIdBox {
        var value: String?
    }

    @MainActor
    private struct Harness {
        let model: FractionLearningModel
        let client: LearningSessionClient
        let transport: MockTransport
        let cache: LearningSessionCache
        let directory: URL
        let sessionIdBox: SessionIdBox
        let deleted: SessionIdBox // value 复用为「已删除的 sessionId」
    }

    @MainActor
    private func makeHarness() -> Harness {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let transport = MockTransport()
        let client = LearningSessionClient(makeTransport: { _ in transport }, audioPlayback: { _ in })
        let box = SessionIdBox()
        let deleted = SessionIdBox()
        let model = FractionLearningModel(client: client,
                                          cache: LearningSessionCache(directory: directory),
                                          deleteRemote: { _, sessionId in deleted.value = sessionId },
                                          loadLastSessionId: { box.value },
                                          storeLastSessionId: { box.value = $0 })
        return Harness(model: model, client: client, transport: transport,
                       cache: LearningSessionCache(directory: directory), directory: directory,
                       sessionIdBox: box, deleted: deleted)
    }

    private func makeDraft(sessionId: String = "s-1", revision: Int = 3, phase: LearningPhase = .exploring,
                           synced: Bool = true) throws -> LearningSessionDraft {
        let draft = LearningSessionDraft(
            schemaVersion: LearningSessionDraft.schemaVersion,
            sessionId: sessionId,
            packVersion: "fraction-pack-2026-09-17-v1",
            challengeId: "fraction-compare-01",
            phase: phase,
            revision: revision,
            childInkBase64: PKDrawing().dataRepresentation().base64EncodedString(),
            board: LearningBoard(revision: 2, rectangles: [
                LearningRectangle(id: "r1", wholeGroupId: "whole-explore", rows: 2, columns: 2,
                                  shadedCells: [0, 3], owner: .child),
            ]),
            hintsVisible: false,
            hintUsed: false,
            submissions: [],
            feedback: [],
            synced: synced)
        return try draft.validated()
    }

    @MainActor
    private func connectReady(_ harness: Harness, restored: Bool = false, revision: Int = 0) {
        harness.model.startFresh(host: "127.0.0.1")
        harness.client.handleIncoming("""
        {"type":"ready","sessionId":"s-1","revision":\(revision),"phase":"exploring","challengeId":"fraction-compare-01","prompt":"题干","restored":\(restored),"packVersion":"fraction-pack-2026-09-17-v1"}
        """)
    }

    @MainActor
    private func acceptSubmit(_ harness: Harness, revision: Int = 1) {
        harness.client.handleIncoming(#"{"type":"accepted","eventId":"e-1","command":"submit","revision":\#(revision),"phase":"reviewing","submissionId":"sub-1"}"#)
    }

    // MARK: 入口与恢复

    @MainActor
    func testEntryShowsDraftSummaryAndNeverAutoConnects() throws {
        let harness = makeHarness()
        let cache = LearningSessionCache(directory: harness.directory)
        try cache.saveDraft(makeDraft())
        harness.sessionIdBox.value = "s-1"
        harness.model.prepareEntry()
        XCTAssertEqual(harness.model.draftSummary, "题目 fraction-compare-01 · 阶段 exploring")
        XCTAssertEqual(harness.model.stage, .entry)
        XCTAssertFalse(harness.client.connected)
        XCTAssertTrue(harness.transport.sent.isEmpty, "进入视图绝不自动连接")
    }

    @MainActor
    func testResumeConnectsWithSessionIdAndRestoresCanvasFromDraft() throws {
        let harness = makeHarness()
        try harness.cache.saveDraft(makeDraft(revision: 3, synced: true))
        harness.sessionIdBox.value = "s-1"
        harness.model.prepareEntry()
        harness.model.resumeLastSession(host: "127.0.0.1")
        let hello = try XCTUnwrap(harness.transport.sent.first.flatMap { $0.data(using: .utf8) }.flatMap {
            try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
        })
        XCTAssertEqual(hello["sessionId"] as? String, "s-1", "恢复连接必须带 sessionId")
        harness.client.handleIncoming(#"{"type":"ready","sessionId":"s-1","revision":3,"phase":"exploring","challengeId":"fraction-compare-01","prompt":"题干","restored":true,"packVersion":"fraction-pack-2026-09-17-v1"}"#)
        XCTAssertEqual(harness.model.boardState.board.rectangles.count, 1)
        XCTAssertEqual(harness.model.boardState.board.rectangles[0].shadedCells, [0, 3])
        XCTAssertTrue(harness.model.boardState.hintsHidden, "草稿 hintsVisible=false 恢复后提示保持隐藏")
        XCTAssertNil(harness.model.conflict)
    }

    @MainActor
    func testConflictKeepsBothSidesAndRequiresExplicitChoice() throws {
        let harness = makeHarness()
        try harness.cache.saveDraft(makeDraft(revision: 2, synced: false)) // 本机有未同步修改
        harness.sessionIdBox.value = "s-1"
        harness.model.prepareEntry()
        harness.model.resumeLastSession(host: "127.0.0.1")
        harness.client.handleIncoming(#"{"type":"ready","sessionId":"s-1","revision":5,"phase":"reviewing","challengeId":"fraction-compare-01","prompt":"题干","restored":true,"packVersion":"fraction-pack-2026-09-17-v1"}"#)
        XCTAssertEqual(harness.model.conflict?.localRevision, 2)
        XCTAssertEqual(harness.model.conflict?.remoteRevision, 5)
        // 双方保留：本地草稿未被覆盖，远端副本另存
        XCTAssertEqual(try harness.cache.loadDraft(sessionId: "s-1")?.revision, 2)
        XCTAssertEqual(try harness.cache.loadConflictDraft(sessionId: "s-1")?.revision, 5)
        harness.model.chooseRemoteDraft()
        XCTAssertEqual(try harness.cache.loadDraft(sessionId: "s-1")?.revision, 5)
        XCTAssertNil(harness.model.conflict)
    }

    // MARK: 按钮状态机

    func testControlsStateMachine() {
        var controls = FractionLearningControls()
        XCTAssertFalse(controls.canSubmit)
        controls.connected = true
        XCTAssertFalse(controls.canSubmit, "未 ready 前不可提交")
        controls.phase = "exploring"
        XCTAssertTrue(controls.canSubmit)
        XCTAssertTrue(controls.canRequestHelp)
        XCTAssertFalse(controls.canStartTransfer, "探索题未提交不可迁移")
        XCTAssertFalse(controls.canContest, "没有反馈时「你理解错了」不可用")
        controls.phase = "reviewing"
        XCTAssertFalse(controls.canSubmit, "reviewing 中等待反馈，不重复提交")
        XCTAssertFalse(controls.canStartTransfer)
        controls.explorationSubmitted = true
        controls.hasFeedback = true
        XCTAssertTrue(controls.canStartTransfer, "探索题提交完成后可开始迁移")
        XCTAssertTrue(controls.canContest)
        controls.phase = "transfer"
        XCTAssertTrue(controls.canSubmit, "迁移阶段是新的独立作答空间")
        XCTAssertFalse(controls.canStartTransfer, "迁移中不可再次迁移")
        controls.phase = "paused"
        XCTAssertFalse(controls.canPause)
        XCTAssertTrue(controls.canResume)
    }

    // MARK: 提交与图形动作

    @MainActor
    func testSubmitFreezesEvidenceWithBoardRevision() throws {
        let harness = makeHarness()
        connectReady(harness)
        harness.model.addPaper()
        harness.model.toggleCell(rectangleId: "child-whole-explore-1", cell: 0)
        harness.model.submit()
        let last = try XCTUnwrap(harness.transport.sent.last.flatMap { $0.data(using: .utf8) }.flatMap {
            try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
        })
        XCTAssertEqual(last["type"] as? String, "submit")
        XCTAssertEqual((last["payload"] as? [String: Any])?["boardRevision"] as? Int, harness.model.boardState.boardRevision)
        XCTAssertNotNil(last["image"], "提交必须带合成证据预览")
        XCTAssertNotNil(last["board"], "提交必须带结构化画布状态")
    }

    @MainActor
    func testBoardActionAppliedThroughWhitelistAndReplayIgnored() throws {
        let harness = makeHarness()
        connectReady(harness)
        harness.model.submit()
        acceptSubmit(harness)
        let action = #"{"type":"action","responseId":"r1","submissionId":"sub-1","boardRevision":1,"command":{"type":"showHintRectangle","rectangle":{"id":"hint-1","wholeGroupId":"whole-explore","rows":1,"columns":2,"shadedCells":[0],"owner":"agent"}}}"#
        harness.client.handleIncoming(action)
        XCTAssertEqual(harness.model.boardState.board.rectangles.filter { $0.owner == .agent }.count, 1)
        let revision = harness.model.boardState.boardRevision
        harness.client.handleIncoming(action)
        XCTAssertEqual(harness.model.boardState.board.rectangles.count, 1)
        XCTAssertEqual(harness.model.boardState.boardRevision, revision, "同一动作重放只生效一次")
    }

    @MainActor
    func testTransferOpensFreshSpaceAndClearsAgentLayer() throws {
        let harness = makeHarness()
        connectReady(harness)
        harness.model.addPaper()
        harness.model.submit()
        acceptSubmit(harness)
        harness.client.handleIncoming(#"{"type":"action","responseId":"r1","submissionId":"sub-1","boardRevision":1,"command":{"type":"showHintRectangle","rectangle":{"id":"hint-1","wholeGroupId":"whole-explore","rows":1,"columns":2,"shadedCells":[0],"owner":"agent"}}}"#)
        XCTAssertEqual(harness.model.boardState.board.rectangles.count, 2)
        let inkToken = harness.model.inkClearToken
        harness.model.startTransfer()
        XCTAssertTrue(harness.transport.sent.contains { $0.contains(#""type":"startTransfer""#) })
        harness.client.handleIncoming(#"{"type":"accepted","eventId":"e-2","command":"startTransfer","revision":2,"phase":"transfer"}"#)
        XCTAssertTrue(harness.model.boardState.board.rectangles.isEmpty, "迁移是新作答空间：孩子矩形与 AI 提示层都清空")
        XCTAssertGreaterThan(harness.model.inkClearToken, inkToken, "迁移清空笔迹层")
        harness.model.addPaper()
        XCTAssertEqual(harness.model.boardState.board.rectangles[0].wholeGroupId, "whole-transfer", "迁移使用新 wholeGroupId")
    }

    // MARK: 语音意图与删除

    @MainActor
    func testVoiceIntentOnlyShowsConfirmationNeverSubmits() throws {
        let harness = makeHarness()
        connectReady(harness)
        harness.client.handleIncoming(#"{"type":"voiceIntent","intent":"submit","transcript":"我做好了。"}"#)
        XCTAssertNotNil(harness.model.voicePrompt)
        let nonHello = harness.transport.sent.filter { !$0.contains(#""type":"hello""#) }
        XCTAssertTrue(nonHello.isEmpty, "语音意图绝不自动提交")
    }

    @MainActor
    func testDeleteRecordIsSeparateFromClearCanvas() async throws {
        let harness = makeHarness()
        connectReady(harness)
        harness.model.persistDraft(synced: true)
        XCTAssertNotNil(try harness.cache.loadDraft(sessionId: "s-1"))
        // 清空画布：不触删除、不动草稿文件
        harness.model.clearCanvas()
        XCTAssertNil(harness.deleted.value)
        // 删除记录：HTTP DELETE + 删除本地草稿，回到入口
        harness.model.deleteRecord(host: "127.0.0.1")
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(harness.deleted.value, "s-1")
        XCTAssertNil(try harness.cache.loadDraft(sessionId: "s-1"))
        XCTAssertNil(harness.sessionIdBox.value)
        XCTAssertEqual(harness.model.stage, .entry)
    }
}
