import XCTest
@testable import ScholarPad

final class MemoryPreviewTests: XCTestCase {
    private let json = #"{"type":"memoryPreview","id":"m1","candidateId":"c1","previewNonce":"n1","tier":2,"childFacingText":"你试了画图","evidenceSummaryText":"这次你画了两条线","contestTarget":{"kind":"candidate","id":"c1"}}"#

    func testPreviewLifecycleAndReplay() throws {
        let message = try JSONDecoder().decode(ChildOutbound.self, from: Data(json.utf8))
        var state = SessionViewState()
        SessionViewState.reduce(&state, message)
        let preview = try XCTUnwrap(state.memoryPreview)
        SessionViewState.reduce(&state, message)
        XCTAssertEqual(state.memoryPreview, preview)
        for phase in ["MEMORY_PENDING", "WAITING_CONFIRMATION", "PAUSED_CHILD", "PAUSED_TECH"] {
            SessionViewState.reduce(&state, .stateChanged(id: "s", state: phase, hintLevel: 0, presence: "waiting"))
            XCTAssertEqual(state.memoryPreview, preview)
        }
        state.resetForResume()
        XCTAssertNil(state.memoryPreview)
        XCTAssertEqual(state.memoryPreviewNonce, "n1")
        SessionViewState.reduce(&state, message)
        XCTAssertEqual(state.memoryPreview, preview)
        SessionViewState.reduce(&state, .memoryDismissed(id: "d", candidateId: "other", reason: .held))
        XCTAssertNotNil(state.memoryPreview)
        SessionViewState.reduce(&state, .memoryDismissed(id: "d", candidateId: "c1", reason: .recorded))
        XCTAssertNil(state.memoryPreview)
        SessionViewState.reduce(&state, message)
        SessionViewState.reduce(&state, .stateChanged(id: "s", state: "COMPLETED", hintLevel: 0, presence: "waiting"))
        XCTAssertNil(state.memoryPreview)
        XCTAssertNil(state.memoryPreviewNonce)
    }

    func testAssentRequiresCandidateNonceAndValidChoice() throws {
        let payload = EventPayload.memoryAssent(candidateId: "c1", previewNonce: "n1", choice: .unsure)
        let encoded = try JSONEncoder().encode(payload)
        XCTAssertEqual(try JSONDecoder().decode(EventPayload.self, from: encoded), payload)
        for invalid in [#"{"type":"MEMORY_ASSENT","choice":"record"}"#,
                        #"{"type":"MEMORY_ASSENT","candidateId":"c","previewNonce":"n","choice":"yes"}"#] {
            XCTAssertThrowsError(try JSONDecoder().decode(EventPayload.self, from: Data(invalid.utf8)))
        }
        XCTAssertThrowsError(try JSONDecoder().decode(ChildOutbound.self, from: Data(json.replacingOccurrences(of: "\"tier\":2", with: "\"tier\":1").utf8)))
    }

    func testPreviewPersistsNonceAndContent() throws {
        guard case .memoryPreview(let preview) = try JSONDecoder().decode(ChildOutbound.self, from: Data(json.utf8)) else { return XCTFail() }
        XCTAssertEqual(try JSONDecoder().decode(MemoryPreview.self, from: JSONEncoder().encode(preview)), preview)
    }

    func testCardHasEqualVisualWeightAndNoAutomaticChoice() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "ScholarPad/Session/MemoryPreviewCard.swift")
        let source = try String(contentsOf: url, encoding: .utf8)
        for forbidden in ["borderedProminent", "keyboardShortcut", "defaultFocus", ".tint(", "Task.sleep", "onTapGesture"] {
            XCTAssertFalse(source.contains(forbidden), forbidden)
        }
        XCTAssertTrue(source.contains("ForEach(MemoryAssentChoice.allCases"))
    }
}
