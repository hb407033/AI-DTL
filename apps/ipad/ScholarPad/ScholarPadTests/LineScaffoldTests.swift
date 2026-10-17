import XCTest
@testable import ScholarPad

@MainActor
final class LineScaffoldTests: XCTestCase {
    func testCorruptRevocationCacheFailsClosedForOptionalHints() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("broken".utf8).write(to: url)
        let model = LineScaffoldModel(revocationsURL: url)
        model.bind(sessionId: "session-a")
        model.accept(try fixture(), sessionId: "session-a")
        XCTAssertNil(model.current)
        XCTAssertFalse(model.syncMessage.isEmpty)
    }
    func testLiveOfflineRestartConflictAndLostAcknowledgement() async throws {
        guard let host = ProcessInfo.processInfo.environment["AI_DTL_REVOCATION_HOST"] else { throw XCTSkip("需要隔离故障注入主机") }
        struct Control: Decodable { var ok: Bool }
        func control(_ body: [String: Any]) async throws {
            let _: Control = try await ProblemCaptureModel.request(host, path: "/test-control", body: body)
        }
        try await control(["reset": true])
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let model = LineScaffoldModel(revocationsURL: url)
        model.verifiedHostId = await LearningHostHealth.probe(host)
        model.bind(sessionId: "session-a")
        await model.refresh(host: host)
        XCTAssertNotNil(model.current)
        try await control(["offline": true])
        await model.act("hide", host: host)
        XCTAssertNil(model.current)
        XCTAssertEqual(model.pendingRevocations, 1)
        let restored = LineScaffoldModel(revocationsURL: url)
        restored.bind(sessionId: "session-a")
        XCTAssertEqual(restored.pendingRevocations, 1)
        try await control(["conflict": true, "loseAck": true])
        await restored.syncRevocations(host: host)
        XCTAssertEqual(restored.pendingRevocations, 1, "主机已处理但回执丢失时不能假报成功")
        XCTAssertNil(restored.current)
        await restored.syncRevocations(host: host)
        XCTAssertEqual(restored.pendingRevocations, 0)
        await restored.refresh(host: host)
        XCTAssertEqual(restored.journal.revision, 5, "选择冲突加一次，撤下只写一次")
        XCTAssertEqual(restored.journal.items.first?.status, "hidden")
        XCTAssertNil(restored.current)
    }
    func testRevocationSurvivesRecreation() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let model = LineScaffoldModel(revocationsURL: url)
        model.bind(sessionId: "session-a")
        model.accept(try fixture(), sessionId: "session-a")
        model.dismissLocally()
        let restored = LineScaffoldModel(revocationsURL: url)
        restored.bind(sessionId: "session-a")
        restored.accept(try fixture(), sessionId: "session-a")
        XCTAssertNil(restored.current)
    }
    func testRevokedOfferCannotReappearFromLateResponse() throws {
        let model = LineScaffoldModel()
        model.bind(sessionId: "session-a")
        let journal = try fixture()
        model.accept(journal, sessionId: "session-a")
        XCTAssertNotNil(model.current)
        model.dismissLocally()
        model.accept(journal, sessionId: "session-a")
        XCTAssertNil(model.current)
    }

    func testOtherSessionAndOlderRevisionAreIgnored() throws {
        let model = LineScaffoldModel()
        model.bind(sessionId: "session-a")
        let journal = try fixture()
        model.accept(journal, sessionId: "session-b")
        XCTAssertNil(model.current)
        model.accept(journal, sessionId: "session-a")
        model.accept(.init(revision: 0, items: []), sessionId: "session-a")
        XCTAssertNotNil(model.current)
        model.bind(sessionId: "session-b")
        XCTAssertNil(model.current)
    }

    func testExactQuantityAndInvalidPartitions() throws {
        let line = try XCTUnwrap(try fixture().items.first?.line)
        XCTAssertEqual(line.quantityLabel(selected: 1), "1/2 升")
        var third = line
        third.whole = "0.3"; third.partitions = 3
        XCTAssertEqual(third.quantityLabel(selected: 1), "1/10 升")
        third.partitions = 0
        XCTAssertNil(third.quantityLabel(selected: 1))
    }

    private func fixture() throws -> LineScaffoldJournal {
        try JSONDecoder().decode(LineScaffoldJournal.self, from: Data(#"{"revision":2,"items":[{"offerId":"offer-a","basis":{"problemId":"p","problemRevision":0,"submissionId":"s","responseId":"r"},"meaning":"一升果汁","anchor":{"whole":"1","unit":"升","sourceQuote":"一升"},"status":"visible","selectedParts":[],"line":{"kind":"line","whole":"1","unit":"升","partitions":2,"meaning":"一升果汁","sourceQuote":"一升"}}]}"#.utf8))
    }
}
