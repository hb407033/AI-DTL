import XCTest
@testable import ScholarPad

final class LearningSessionCacheTests: XCTestCase {
    private var directories: [URL] = []

    override func tearDownWithError() throws {
        for url in directories { try? FileManager.default.removeItem(at: url) }
        directories = []
    }

    private func makeCache() -> (cache: LearningSessionCache, directory: URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        directories.append(directory)
        return (LearningSessionCache(directory: directory), directory)
    }

    private func makeDraft(sessionId: String = "session-1", revision: Int = 0, synced: Bool = false) -> LearningSessionDraft {
        LearningSessionDraft(
            schemaVersion: LearningSessionDraft.schemaVersion,
            sessionId: sessionId,
            packVersion: "fraction-pack-2026-09-17-v1",
            challengeId: "fraction-compare-01",
            phase: .exploring,
            revision: revision,
            childInkBase64: Data("opaque-pencilkit-bytes".utf8).base64EncodedString(),
            board: LearningBoard(revision: 0, rectangles: []),
            hintsVisible: false,
            hintUsed: false,
            submissions: [],
            feedback: [],
            synced: synced
        )
    }

    func testFixtureBoardAndSubmissionDecode() throws {
        // 与 packages/session-contracts/fixtures/fraction-learning-v1.json 中 boardStates[0] / submissions[0] 逐字段一致
        let boardJSON = """
        {"revision":3,"rectangles":[
          {"id":"rect-child-1","wholeGroupId":"whole-1","rows":3,"columns":4,"shadedCells":[0,1,2,3,4,5,6,7,8],"owner":"child"},
          {"id":"rect-child-2","wholeGroupId":"whole-1","rows":3,"columns":4,"shadedCells":[0,1,2,3,4,5,6,7],"owner":"child"},
          {"id":"rect-agent-1","wholeGroupId":"whole-2","rows":1,"columns":2,"shadedCells":[0],"owner":"agent"}]}
        """
        let board = try JSONDecoder().decode(LearningBoard.self, from: Data(boardJSON.utf8))
        XCTAssertEqual(board.revision, 3)
        XCTAssertEqual(board.rectangles.count, 3)
        XCTAssertEqual(board.rectangles[0].owner, .child)
        XCTAssertEqual(board.rectangles[0].shadedCells, [0, 1, 2, 3, 4, 5, 6, 7, 8])
        XCTAssertEqual(board.rectangles[2].owner, .agent)

        let submissionJSON = """
        {"submissionId":"submission-9","challengeId":"fraction-transfer-01","boardRevision":2,"hintUsed":true}
        """
        let submission = try JSONDecoder().decode(LearningSubmission.self, from: Data(submissionJSON.utf8))
        XCTAssertEqual(submission.submissionId, "submission-9")
        XCTAssertEqual(submission.challengeId, "fraction-transfer-01")
        XCTAssertEqual(submission.boardRevision, 2)
        XCTAssertTrue(submission.hintUsed)
    }

    func testFixtureInvalidShapesRejected() throws {
        // 夹具 invalid 节：越界格子、重复格子、超格数、非法角色、单 owner 超 4 个矩形
        let cellOutOfRange = """
        {"id":"r-bad-1","wholeGroupId":"w","rows":2,"columns":2,"shadedCells":[4],"owner":"child"}
        """
        let rect = try JSONDecoder().decode(LearningRectangle.self, from: Data(cellOutOfRange.utf8))
        var draft = makeDraft()
        draft.board = LearningBoard(revision: 0, rectangles: [rect])
        XCTAssertThrowsError(try draft.validated())

        let illegalOwner = """
        {"id":"r-bad-5","wholeGroupId":"w","rows":2,"columns":2,"shadedCells":[0],"owner":"teacher"}
        """
        XCTAssertThrowsError(try JSONDecoder().decode(LearningRectangle.self, from: Data(illegalOwner.utf8)))

        let fiveChildRectangles = (1...5).map {
            LearningRectangle(id: "c\($0)", wholeGroupId: "w", rows: 1, columns: 2, shadedCells: [], owner: .child)
        }
        draft.board = LearningBoard(revision: 0, rectangles: fiveChildRectangles)
        XCTAssertThrowsError(try draft.validated())
    }

    func testSaveLoadRoundtripPreservesAllFields() throws {
        let (cache, _) = makeCache()
        var draft = makeDraft(revision: 3)
        draft.phase = .reviewing
        draft.board = LearningBoard(revision: 3, rectangles: [
            LearningRectangle(id: "rect-child-1", wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2], owner: .child),
        ])
        draft.hintsVisible = true
        draft.hintUsed = true
        draft.submissions = [LearningSubmission(submissionId: "submission-9", challengeId: "fraction-transfer-01", boardRevision: 2, hintUsed: true)]
        draft.feedback = [LearningFeedback(feedbackId: "fb-1", submissionId: "submission-9", summary: "我看到你把两张纸都分成了 12 格。", contested: true)]
        try cache.saveDraft(draft)
        XCTAssertEqual(try cache.loadDraft(sessionId: draft.sessionId), draft)
    }

    func testDraftMarkedUnsyncedUntilReconciled() throws {
        let (cache, _) = makeCache()
        try cache.saveDraft(makeDraft(revision: 2, synced: false))
        XCTAssertEqual(try cache.loadDraft(sessionId: "session-1")?.synced, false)
    }

    func testUnsyncedLocalVersusNewerRemoteReportsConflictAndKeepsBoth() throws {
        let (cache, _) = makeCache()
        try cache.saveDraft(makeDraft(revision: 3, synced: false))
        let remote = makeDraft(revision: 5, synced: true)
        let result = try cache.reconcile(sessionId: "session-1", remote: remote)
        XCTAssertEqual(result, .conflict(localRevision: 3, remoteRevision: 5))
        // 本地未同步草稿原样保留，远端完整存入冲突副本，等待明确选择
        let local = try XCTUnwrap(cache.loadDraft(sessionId: "session-1"))
        XCTAssertEqual(local.revision, 3)
        XCTAssertFalse(local.synced)
        let conflict = try XCTUnwrap(cache.loadConflictDraft(sessionId: "session-1"))
        XCTAssertEqual(conflict.revision, 5)
    }

    func testSyncedLocalAdoptsNewerRemote() throws {
        let (cache, _) = makeCache()
        try cache.saveDraft(makeDraft(revision: 3, synced: true))
        let result = try cache.reconcile(sessionId: "session-1", remote: makeDraft(revision: 5, synced: true))
        XCTAssertEqual(result, .appliedRemote)
        let loaded = try XCTUnwrap(cache.loadDraft(sessionId: "session-1"))
        XCTAssertEqual(loaded.revision, 5)
        XCTAssertTrue(loaded.synced)
    }

    func testNoLocalDraftAdoptsRemote() throws {
        let (cache, _) = makeCache()
        let result = try cache.reconcile(sessionId: "session-1", remote: makeDraft(revision: 2, synced: true))
        XCTAssertEqual(result, .appliedRemote)
        XCTAssertEqual(try cache.loadDraft(sessionId: "session-1")?.revision, 2)
    }

    func testUnsyncedLocalAheadKeepsLocal() throws {
        let (cache, _) = makeCache()
        try cache.saveDraft(makeDraft(revision: 6, synced: false))
        let result = try cache.reconcile(sessionId: "session-1", remote: makeDraft(revision: 5, synced: true))
        XCTAssertEqual(result, .keptLocal)
        let loaded = try XCTUnwrap(cache.loadDraft(sessionId: "session-1"))
        XCTAssertEqual(loaded.revision, 6)
        XCTAssertFalse(loaded.synced)
    }

    func testSameRevisionIdenticalContentMarksSynced() throws {
        let (cache, _) = makeCache()
        try cache.saveDraft(makeDraft(revision: 4, synced: false))
        let result = try cache.reconcile(sessionId: "session-1", remote: makeDraft(revision: 4, synced: true))
        XCTAssertEqual(result, .appliedRemote)
        XCTAssertEqual(try cache.loadDraft(sessionId: "session-1")?.synced, true)
    }

    func testSameRevisionDifferentContentReportsConflict() throws {
        let (cache, _) = makeCache()
        try cache.saveDraft(makeDraft(revision: 4, synced: false))
        var remote = makeDraft(revision: 4, synced: true)
        remote.hintUsed = true
        let result = try cache.reconcile(sessionId: "session-1", remote: remote)
        XCTAssertEqual(result, .conflict(localRevision: 4, remoteRevision: 4))
        XCTAssertEqual(try cache.loadDraft(sessionId: "session-1")?.hintUsed, false)
    }

    func testCorruptedDraftIsKeptAndReported() throws {
        let (cache, _) = makeCache()
        try cache.saveDraft(makeDraft(revision: 1, synced: false))
        let url = cache.draftURL(for: "session-1")
        try Data("{ not json !!!".utf8).write(to: url)
        XCTAssertThrowsError(try cache.loadDraft(sessionId: "session-1")) { error in
            XCTAssertEqual(error as? LearningCacheError, .corruptedDraft)
        }
        // 原文件字节不被改动，等待人工或上层决定
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "{ not json !!!")
    }

    func testSaveFailureThrowsWhenDirectoryUnusable() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        directories.append(file)
        try Data("not a directory".utf8).write(to: file)
        let cache = LearningSessionCache(directory: file)
        XCTAssertThrowsError(try cache.saveDraft(makeDraft()))
    }

    func testInvalidSessionIdRejected() throws {
        let (cache, _) = makeCache()
        var draft = makeDraft()
        draft.sessionId = "../escape"
        XCTAssertThrowsError(try cache.saveDraft(draft))
        XCTAssertThrowsError(try cache.loadDraft(sessionId: "../escape")) { error in
            XCTAssertEqual(error as? LearningCacheError, .invalidSessionId)
        }
    }

    func testRemoveDraftClearsDraftAndConflictCopy() throws {
        let (cache, _) = makeCache()
        try cache.saveDraft(makeDraft(revision: 3, synced: false))
        _ = try cache.reconcile(sessionId: "session-1", remote: makeDraft(revision: 5, synced: true))
        try cache.removeDraft(sessionId: "session-1")
        XCTAssertNil(try cache.loadDraft(sessionId: "session-1"))
        XCTAssertNil(try cache.loadConflictDraft(sessionId: "session-1"))
    }
}
