import XCTest
@testable import ScholarPad

@MainActor
final class InquiryJournalTests: XCTestCase {
    func testSelectedEvidenceSurvivesDraftRestartAndRevision() async {
        let path = cache()
        let first = InquiryJournalModel(sessionId: "s", host: "localhost", cacheURL: path)
        first.draft.text = "这份图表示我想到的整体"
        first.draft.evidenceIds = ["drawing-1"]
        let restored = InquiryJournalModel(sessionId: "s", host: "localhost", cacheURL: path,
            fetch: { .init(revision: 0, entries: []) }, append: { entry, _ in .init(revision: 1, entries: [entry]) })
        await restored.save()
        XCTAssertEqual(restored.journal.entries.first?.evidenceIds, ["drawing-1"])
        if let entry = restored.journal.entries.first { restored.revise(entry) }
        XCTAssertEqual(restored.draft.evidenceIds, ["drawing-1"])
    }
    private func cache() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("draft.json")
    }

    func testDraftSurvivesReopening() {
        let path = cache()
        let model = InquiryJournalModel(sessionId: "test-session", host: "localhost", cacheURL: path)
        model.draft.text = "为什么乘完变小了？"
        model.draft.kind = .question
        let restored = InquiryJournalModel(sessionId: "test-session", host: "localhost", cacheURL: path)
        XCTAssertEqual(restored.draft.text, "为什么乘完变小了？")
        XCTAssertEqual(restored.draft.kind, .question)
    }

    func testRetryKeepsEntryIdentityAfterLostReceiptAndRestart() async {
        let path = cache()
        var attempts: [InquiryEntry] = []
        let model = InquiryJournalModel(sessionId: "test-session", host: "localhost", cacheURL: path,
            fetch: { .init(revision: 0, entries: []) }, append: { entry, _ in
                attempts.append(entry)
                throw WorkspaceError.unavailable
            })
        model.draft.text = "我觉得结果会变小"
        await model.save()
        XCTAssertNotNil(model.pending)
        let restored = InquiryJournalModel(sessionId: "test-session", host: "localhost", cacheURL: path,
            fetch: { .init(revision: 0, entries: []) }, append: { entry, _ in
                attempts.append(entry)
                return .init(revision: 1, entries: [entry])
            })
        await restored.save()
        XCTAssertEqual(attempts.count, 2)
        XCTAssertEqual(attempts.first?.entryId, attempts.last?.entryId)
        XCTAssertNil(restored.pending)
        XCTAssertEqual(restored.journal.entries.count, 1)
        XCTAssertTrue(restored.draft.text.isEmpty)
    }

    func testRevisionKeepsOldEntryAndConflictPreservesDraft() async {
        let old = InquiryEntry(entryId: "old", kind: .conjecture, author: "child", text: "乘法总会变大", evidenceIds: [], revises: nil, transfer: nil)
        let model = InquiryJournalModel(sessionId: "test-session", host: "localhost", cacheURL: cache(),
            fetch: { .init(revision: 1, entries: [old]) }, append: { _, _ in throw WorkspaceError.server(409, nil) })
        await model.load()
        model.revise(old)
        model.draft.text = "乘小于一的数不一定变大"
        await model.save()
        XCTAssertEqual(model.journal.entries.first?.text, old.text)
        XCTAssertEqual(model.pending?.entry.revises, old.entryId)
        XCTAssertEqual(model.draft.text, "乘小于一的数不一定变大")
        XCTAssertTrue(model.conflict)
    }

    func testTransferRequiresActualAttemptFields() async {
        var called = false
        let model = InquiryJournalModel(sessionId: "test-session", host: "localhost", cacheURL: cache(),
            fetch: { .init(revision: 0, entries: []) }, append: { entry, _ in
                called = true; return .init(revision: 1, entries: [entry])
            })
        model.draft.kind = .transfer
        model.draft.text = "换一个情境试试"
        await model.save()
        XCTAssertFalse(called)
        model.draft.transfer = .init(context: "半杯牛奶", method: "画整体", check: "对照容量", outcome: "还没有弄清楚")
        await model.save()
        XCTAssertTrue(called)
        XCTAssertEqual(model.journal.entries.first?.transfer?.outcome, "还没有弄清楚")
    }

    func testUnrelatedReceiptCannotClearDraft() async {
        let model = InquiryJournalModel(sessionId: "test-session", host: "localhost", cacheURL: cache(),
            fetch: { .init(revision: 0, entries: []) }, append: { _, _ in .init(revision: 1, entries: []) })
        model.draft.text = "这份想法尚未确认收到"
        await model.save()
        XCTAssertNotNil(model.pending)
        XCTAssertEqual(model.draft.text, "这份想法尚未确认收到")
    }

    func testConflictRetryUsesReviewedRevisionWithoutChangingIdentity() async {
        var expectedRevisions: [Int] = []
        var ids: [String] = []
        let model = InquiryJournalModel(sessionId: "test-session", host: "localhost", cacheURL: cache(),
            fetch: { .init(revision: 3, entries: []) }, append: { entry, expected in
                expectedRevisions.append(expected); ids.append(entry.entryId)
                if expected != 3 { throw WorkspaceError.server(409, nil) }
                return .init(revision: 4, entries: [entry])
            })
        model.draft.text = "我再试一次"
        await model.save()
        XCTAssertTrue(model.conflict)
        await model.retryAfterReview()
        XCTAssertEqual(expectedRevisions, [0, 3])
        XCTAssertEqual(ids.first, ids.last)
        XCTAssertFalse(model.conflict)
        XCTAssertNil(model.pending)
    }
}
