import XCTest
import PencilKit
@testable import ScholarPad

@MainActor
final class WorkspaceResumeTests: XCTestCase {
    func testCurrentVersionQuoteWithoutInternalTranscript() throws {
        var record = fixture()
        record.submissions = [evidence("old", revision: 0, text: "旧题意"), evidence("new", revision: 1,
            text: "我把一升分两份\n近期原话转写（可能有误，非学习结论）：\n帮我一下")]
        let summary = try XCTUnwrap(WorkspaceResumeSummary.make(record))
        XCTAssertEqual(summary.childExpression, "我把一升分两份")
        XCTAssertEqual(summary.submissionId, "new")
        record.problem?.statement.confirmed = false
        XCTAssertNil(WorkspaceResumeSummary.make(record))
    }
    func testNoPriorExpressionDoesNotInventProgress() throws {
        let summary = try XCTUnwrap(WorkspaceResumeSummary.make(fixture()))
        XCTAssertNil(summary.childExpression)
        XCTAssertNil(summary.submissionId)
    }
    func testLocalRestoreAndDismissKeepOriginalBytes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let ink = PKDrawing().dataRepresentation()
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 30, height: 30)).image { _ in }.pngData()!
        try cache.save(.init(photo: photo, drawing: ink, record: fixture()))
        let model = ProblemCaptureModel(cache: cache)
        XCTAssertTrue(model.offersResumption)
        model.dismissResumption()
        XCTAssertFalse(model.offersResumption)
        XCTAssertEqual(try cache.load()?.drawing, ink)
        XCTAssertTrue(ProblemCaptureModel(cache: cache).offersResumption)
    }
    private func evidence(_ id: String, revision: Int, text: String) -> WorkspaceEvidence {
        .init(submissionId: id, problemId: "p", problemRevision: revision, boardRevision: 1, previewId: "preview", explanation: text)
    }
    private func fixture() -> WorkspaceRecord {
        .init(schemaVersion: 2, sessionId: "resume-work", eventId: "e", revision: 1,
              problem: .init(problemId: "p", source: "curated", challengeId: "c", packVersion: "v1",
                             curriculum: .init(currentUnit: "小数乘法"), statement: .init(text: "半升果汁多少钱？", revision: 1, confirmed: true)),
              phase: "exploring", childInkBase64: "", board: .init(revision: 0, rectangles: []), submissions: [], feedback: [], openQuestions: [])
    }
}
