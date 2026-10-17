import XCTest
import PencilKit
@testable import ScholarPad

final class WorkspaceCacheTests: XCTestCase {
    func testOwnQuestionDraftAndRetryIdentitySurviveRestart() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let question = "照片中的果汁，半升要多少钱？"
        try cache.save(.init(photo: Data([1]), drawing: PKDrawing().dataRepresentation(), record: nil,
            questionDraft: question, pendingOwnQuestion: .init(sessionId: "s", photoEventId: "photo-event", photoId: "photo",
                eventId: "question-event", text: question, unit: "小数乘法")))
        let restored = try XCTUnwrap(WorkspaceCache(directory: root).load())
        XCTAssertEqual(restored.questionDraft, question)
        XCTAssertEqual(restored.pendingOwnQuestion?.eventId, "question-event")
        XCTAssertEqual(restored.pendingOwnQuestion?.photoId, "photo")
    }
    func testPendingEvidenceIdentitySurvivesDiskRoundTrip() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let evidence = WorkspaceEvidence(submissionId: "snapshot", problemId: "p", problemRevision: 0, boardRevision: 3, previewId: "media", explanation: "")
        try cache.save(.init(photo: Data([1]), drawing: PKDrawing().dataRepresentation(), record: nil,
            pendingEvidence: .init(eventId: "retry-event", expectedRevision: 2, evidence: evidence)))
        XCTAssertEqual(try cache.load()?.pendingEvidence?.eventId, "retry-event")
        XCTAssertEqual(try cache.load()?.pendingEvidence?.evidence, evidence)
    }
    func testOriginalDrawingAndPhotoRoundTripSeparately() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let ink = PKDrawing().dataRepresentation()
        let draft = WorkspaceLocalDraft(photo: Data([1, 2, 3]), drawing: ink, record: nil)
        try cache.save(draft)
        let loaded = try XCTUnwrap(cache.load())
        XCTAssertEqual(loaded.photo, draft.photo)
        XCTAssertEqual(loaded.drawing, ink)
        XCTAssertNoThrow(try PKDrawing(data: loaded.drawing))
    }
    func testInvalidDrawingDoesNotReplaceExistingDraft() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let valid = WorkspaceLocalDraft(photo: Data([1]), drawing: PKDrawing().dataRepresentation(), record: nil)
        try cache.save(valid)
        XCTAssertThrowsError(try cache.save(WorkspaceLocalDraft(photo: Data([2]), drawing: Data("jpeg-not-ink".utf8), record: nil)))
        XCTAssertEqual(try cache.load()?.photo, valid.photo)
    }
    func testSwitchPreservesUnsubmittedPhotoAndDrawingAsReopenableDraft() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let first = WorkspaceLocalDraft(photo: Data([1]), drawing: PKDrawing().dataRepresentation(), record: nil)
        try cache.save(first)
        try cache.preserveCurrent()
        try cache.save(.init(photo: Data([2]), drawing: PKDrawing().dataRepresentation(), record: nil))
        let entries = try cache.archives()
        XCTAssertEqual(entries.count, 1)
        let restored = try cache.loadArchive(try XCTUnwrap(entries.first).id)
        XCTAssertEqual(restored.photo, first.photo)
        XCTAssertEqual(restored.drawing, first.drawing)
        XCTAssertEqual(try cache.load()?.photo, Data([2]))
        XCTAssertThrowsError(try cache.loadArchive("../current"))
    }
}
