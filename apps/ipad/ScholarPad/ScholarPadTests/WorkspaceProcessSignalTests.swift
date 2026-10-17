import XCTest
import UIKit
import PencilKit
@testable import ScholarPad

final class WorkspaceProcessSignalTests: XCTestCase {
    private func stroke(_ id: String) -> EventPayload {
        .stroke(strokeId: id, contentHash: id, bounds: .init(x: 0, y: 0, width: 10, height: 10))
    }
    func testOnlyObservedInkEventsContributeFactsAndGaps() {
        var tracker = WorkspaceProcessSignalTracker()
        XCTAssertNil(tracker.snapshot)
        tracker.record([.utterance(text: "不会"), .helpRequest], at: 0)
        XCTAssertNil(tracker.snapshot)
        tracker.record([stroke("st-a")], at: 1)
        tracker.record([.erase(strokeId: "st-a", contentHash: "a"), stroke("st-b")], at: 3.5)
        XCTAssertEqual(tracker.snapshot, .init(eraseCount: 1, longestPauseMs: 2500,
            strokeOrder: ["stroke:st-a", "erase:st-a", "stroke:st-b"]))
        let frozen = tracker.snapshot
        tracker.record([stroke("st-c")], at: 4)
        XCTAssertEqual(frozen?.strokeOrder.count, 3, "冻结是值副本，后续事件不改变旧证据")
        tracker.reset()
        XCTAssertNil(tracker.snapshot)
        tracker.record([stroke("st-d")], at: 100)
        XCTAssertEqual(tracker.snapshot?.longestPauseMs, 0, "换题前的时间不能计入新题停顿")
    }
    func testFactSummaryIsBoundedAndInvalidClockValuesAreIgnored() {
        var tracker = WorkspaceProcessSignalTracker()
        tracker.record([stroke("st-a")], at: 10)
        tracker.record([stroke("st-b")], at: .nan)
        tracker.record([stroke("st-c")], at: 9)
        XCTAssertEqual(tracker.snapshot?.longestPauseMs, 0)
        tracker.record([stroke("st-d")], at: 4000)
        tracker.record(Array(repeating: .erase(strokeId: "st-a", contentHash: "a"), count: 10001), at: 4001)
        XCTAssertEqual(tracker.snapshot?.eraseCount, 10000)
        XCTAssertEqual(tracker.snapshot?.longestPauseMs, 3600000)
        XCTAssertEqual(tracker.snapshot?.strokeOrder.count, 256)
    }
    func testOptionalSignalRoundTripsAndOldEvidenceDecodes() throws {
        let old = Data(#"{"submissionId":"s","problemId":"p","problemRevision":0,"boardRevision":0,"previewId":"v","explanation":""}"#.utf8)
        var evidence = try JSONDecoder().decode(WorkspaceEvidence.self, from: old)
        XCTAssertNil(evidence.processSignal)
        evidence.processSignal = .init(eraseCount: 1, longestPauseMs: 1000, strokeOrder: ["erase:st-a", "stroke:st-b"])
        XCTAssertEqual(try JSONDecoder().decode(WorkspaceEvidence.self, from: JSONEncoder().encode(evidence)), evidence)
    }
    @MainActor func testFreezeCapturesProcessFactsBeforeUploadAndNewPhotoResets() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        LearningWorkspaceView.writeConfirmedFixture(to: root)
        var model: ProblemCaptureModel!
        model = ProblemCaptureModel(transport: { req in
            model.recordDrawingEvents([.erase(strokeId: "st-late", contentHash: "late")])
            let response = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"mediaId":"uploaded-preview"}"#.utf8), response)
        }, cache: WorkspaceCache(directory: root))
        model.host = "127.0.0.1"
        model.recordDrawingEvents([stroke("st-a")])
        let first = try await model.freezeEvidence("")
        XCTAssertEqual(first.processSignal?.eraseCount, 0)
        XCTAssertEqual(first.processSignal?.strokeOrder, ["stroke:st-a"])
        let second = try await model.freezeEvidence("")
        XCTAssertEqual(second.processSignal?.eraseCount, 1)
        let image = UIGraphicsImageRenderer(size: .init(width: 20, height: 20)).image { context in
            UIColor.white.setFill(); context.fill(.init(x: 0, y: 0, width: 20, height: 20))
        }
        model.capture(image)
        XCTAssertNil(model.processSignal)
    }
}
