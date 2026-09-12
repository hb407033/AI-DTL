import XCTest
@testable import ScholarPad

final class ChildLedgerTests: XCTestCase {
    func testContestRequiresTypedTarget() throws {
        let payload = EventPayload.contest(target: ContestTarget(kind: .record, id: "r1"))
        XCTAssertEqual(try JSONDecoder().decode(EventPayload.self, from: JSONEncoder().encode(payload)), payload)
        XCTAssertThrowsError(try JSONDecoder().decode(EventPayload.self, from: Data(#"{"type":"CONTEST"}"#.utf8)))
    }

    func testContestPriorityAndFallback() {
        var state = SessionViewState()
        XCTAssertEqual(state.contestTarget(sessionId: "s"), ContestTarget(kind: .session, id: "s"))
        SessionViewState.reduce(&state, .learnerTask(id: "t", text: "题", contestTarget: ContestTarget(kind: .hypothesis, id: "h")))
        XCTAssertEqual(state.contestTarget(sessionId: "s").id, "h")
        SessionViewState.reduce(&state, .speak(id: "p", text: "话", hintLevel: 1, interruptible: true, contestTarget: ContestTarget(kind: .proposal, id: "p")))
        XCTAssertEqual(state.contestTarget(sessionId: "s").id, "p")
        SessionViewState.reduce(&state, .memoryPreview(MemoryPreview(id: "m", candidateId: "c", previewNonce: "n", tier: .session, childFacingText: "试", evidenceSummaryText: "依据", contestTarget: ContestTarget(kind: .candidate, id: "c"))))
        XCTAssertEqual(state.contestTarget(sessionId: "s").id, "c")
    }

    func testHTTPURLUsesChildPortAndPreservesSecureScheme() throws {
        XCTAssertEqual(try ChildLedgerClient.httpBaseURL(webSocketURL: URL(string: "ws://host:8788/session?sessionId=s")!).absoluteString, "http://host:8788")
        XCTAssertEqual(try ChildLedgerClient.httpBaseURL(webSocketURL: URL(string: "wss://host/session")!).absoluteString, "https://host")
    }

    func testNoticeAndDeletionPreviewDecode() throws {
        let notice = try JSONDecoder().decode(ChildFirstUseNotice.self, from: Data(#"{"version":1,"text":"先看看","acknowledged":false}"#.utf8))
        XCTAssertFalse(notice.acknowledged)
        let preview = try JSONDecoder().decode(ChildDeletionPreview.self, from: Data(#"{"preview":{"records":2},"text":"会影响两条记录","previewComputedAt":123}"#.utf8))
        XCTAssertEqual(preview.preview["records"], 2)
    }

    @MainActor
    func testRightsRequestsUseIndependentHTTPAndReportFailures() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LedgerURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); LedgerURLProtocol.handler = nil }
        let client = try ChildLedgerClient(webSocketURL: URL(string: "ws://localhost:8788/session?sessionId=old")!, session: session)
        LedgerURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/child/contest")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertNil(request.url?.query)
            return (200, #"{"ok":true}"#)
        }
        try await client.contest(.init(kind: .record, id: "r"))
        LedgerURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/child/deletion-preview")
            XCTAssertEqual(request.httpMethod, "POST")
            return (200, #"{"preview":{"records":1},"text":"一个记录","previewComputedAt":123}"#)
        }
        let preview = try await client.deletionPreview(.init(subjectKind: .growthRecord, subjectId: "r"))
        XCTAssertEqual(preview.text, "一个记录")
        LedgerURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/child/deletion-requests")
            XCTAssertEqual(request.httpMethod, "POST")
            return (200, #"{"requestId":"d","preview":{"records":1}}"#)
        }
        let receipt = try await client.requestDeletion(.init(subjectKind: .growthRecord, subjectId: "r"))
        XCTAssertEqual(receipt.requestId, "d")
        LedgerURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/child/first-use-notice/ack")
            XCTAssertEqual(request.httpMethod, "POST")
            return (503, #"{"error":"unavailable"}"#)
        }
        do { try await client.acknowledgeNotice(version: 1); XCTFail("HTTP失败不能当作确认成功") }
        catch { XCTAssertTrue(error.localizedDescription.contains("503")) }
    }
}

private final class LedgerURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else { client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return }
        let (status, body) = handler(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
