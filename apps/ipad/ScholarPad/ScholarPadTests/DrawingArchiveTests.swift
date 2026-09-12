import XCTest
import PencilKit
@testable import ScholarPad

@MainActor
final class DrawingArchiveTests: XCTestCase {
    func testNativeRoundtripPreservesStrokeAndPreview() throws {
        let point = PKStrokePoint(location: CGPoint(x: 20, y: 30), timeOffset: 0, size: CGSize(width: 4, height: 4), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        let stroke = PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: [point], creationDate: Date()))
        let drawing = PKDrawing(strokes: [stroke])
        let snapshot = try DrawingArchive.snapshot(drawing)
        let restored = try PKDrawing(data: snapshot.drawing)
        XCTAssertEqual(restored.strokes.count, 1)
        XCTAssertEqual(restored.strokes[0].path[0].location, point.location)
        XCTAssertNotNil(UIImage(data: snapshot.preview))
        XCTAssertEqual(snapshot.preview[24], 8, "host 支持 native 8-bit PNG")
    }

    func testRestorationDoesNotEmitChildEvidence() {
        let canvas = PKCanvasView()
        var count = 0
        let coordinator = ChildCanvasView.Coordinator(clearToken: 0, onEvents: { count += $0.count }, onDrawing: { _ in count += 100 })
        let point = PKStrokePoint(location: CGPoint(x: 20, y: 30), timeOffset: 0, size: CGSize(width: 4, height: 4), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        let drawing = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: [point], creationDate: Date()))])
        coordinator.restore(drawing, into: canvas)
        coordinator.canvasViewDrawingDidChange(canvas)
        XCTAssertEqual(count, 0)
    }

    func testUserClearEmitsEraseAndPersistsEmptyDrawing() {
        let canvas = PKCanvasView()
        var events: [EventPayload] = [], snapshots: [PKDrawing] = []
        let coordinator = ChildCanvasView.Coordinator(clearToken: 0, onEvents: { events += $0 }, onDrawing: { snapshots.append($0) })
        let point = PKStrokePoint(location: CGPoint(x: 20, y: 30), timeOffset: 0, size: CGSize(width: 4, height: 4), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        coordinator.restore(PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: [point], creationDate: Date()))]), into: canvas)
        coordinator.clearByChild(canvas)
        XCTAssertEqual(snapshots.count, 1)
        XCTAssertEqual(snapshots.first?.strokes.count, 0)
        XCTAssertEqual(events.count, 1)
        if let first = events.first { guard case .erase = first else { return XCTFail("清空应产生擦除证据") } }
    }

    func testLocalPendingSurvivesRelaunchAndNewSessionOnlyClearsOwnCanvas() throws {
        let session = "test-\(UUID().uuidString)"
        let first = DrawingArchive()
        first.configure(host: "localhost", sessionId: session)
        let point = PKStrokePoint(location: CGPoint(x: 3, y: 9), timeOffset: 0, size: CGSize(width: 4, height: 4), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        first.changed(PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: [point], creationDate: Date()))]))
        first.configure(host: "localhost", sessionId: session + "-new")
        XCTAssertEqual(try PKDrawing(data: XCTUnwrap(first.restored)).strokes.count, 0)
        let reopened = DrawingArchive()
        reopened.configure(host: "localhost", sessionId: session)
        XCTAssertEqual(try PKDrawing(data: XCTUnwrap(reopened.restored)).strokes.count, 1)
    }

    func testFailedRestoreKeepsCurrentLocalDrawing() async throws {
        let archive = DrawingArchive(transport: { _ in throw URLError(.notConnectedToInternet) })
        archive.configure(host: "localhost", sessionId: UUID().uuidString)
        let before = archive.restored
        archive.reconnect()
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(archive.restored, before)
        XCTAssertFalse(archive.status.isEmpty)
    }

    func testDelayedDownloadDoesNotReplaceUnsavedInk() async throws {
        let remote = try JSONEncoder().encode(DrawingArchive.snapshot(PKDrawing()))
        let archive = DrawingArchive(transport: { request in
            try await Task.sleep(for: .milliseconds(100))
            return (remote, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        archive.configure(host: "localhost", sessionId: UUID().uuidString)
        let token = archive.restoreToken
        archive.reconnect()
        try await Task.sleep(for: .milliseconds(20))
        archive.changed(PKDrawing())
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(archive.restoreToken, token)
    }

    func testDebounceUploadsLatestSnapshotAndRetriesSameRevision() async throws {
        var bodies: [Data] = []
        let archive = DrawingArchive(transport: { request in
            bodies.append(request.httpBody ?? Data())
            throw URLError(.notConnectedToInternet)
        })
        archive.configure(host: "localhost", sessionId: UUID().uuidString)
        archive.changed(PKDrawing())
        archive.changed(PKDrawing())
        try await Task.sleep(for: .milliseconds(850))
        XCTAssertEqual(bodies.count, 1)
        archive.reconnect()
        try await Task.sleep(for: .milliseconds(850))
        XCTAssertEqual(bodies.count, 2)
        let first = try JSONDecoder().decode(DrawingArchive.Snapshot.self, from: bodies[0])
        let retry = try JSONDecoder().decode(DrawingArchive.Snapshot.self, from: bodies[1])
        XCTAssertEqual(first.revision, retry.revision)
        XCTAssertEqual(first.drawing, retry.drawing)
    }

    func testDeletedResponseClearsLocalCacheAndStopsRetriesAcrossRelaunch() async throws {
        for dirty in [false, true] {
            var requests = 0
            let session = UUID().uuidString
            let archive = DrawingArchive(transport: { request in
                requests += 1
                return (Data(), HTTPURLResponse(url: request.url!, statusCode: 410, httpVersion: nil, headerFields: nil)!)
            })
            archive.configure(host: "localhost", sessionId: session)
            if dirty { archive.changed(PKDrawing()) }
            archive.reconnect()
            try await Task.sleep(for: .milliseconds(850))
            XCTAssertTrue(archive.isDeleted)
            XCTAssertEqual(try PKDrawing(data: XCTUnwrap(archive.restored)).strokes.count, 0)
            archive.changed(PKDrawing()); archive.reconnect()
            let reopened = DrawingArchive(transport: { _ in XCTFail("墓碑不得重传"); throw URLError(.cancelled) })
            reopened.configure(host: "localhost", sessionId: session); reopened.reconnect()
            XCTAssertTrue(reopened.isDeleted)
            XCTAssertEqual(requests, 1)
        }
    }

    func testLateRestoreCannotResurrectAfterConcurrentDeletionResponse() async throws {
        var requests = 0
        let remote = try JSONEncoder().encode(DrawingArchive.snapshot(PKDrawing()))
        let archive = DrawingArchive(transport: { request in
            requests += 1
            let order = requests
            try await Task.sleep(for: .milliseconds(order == 1 ? 100 : 20))
            return (remote, HTTPURLResponse(url: request.url!, statusCode: order == 1 ? 200 : 410, httpVersion: nil, headerFields: nil)!)
        })
        archive.configure(host: "localhost", sessionId: UUID().uuidString)
        archive.reconnect(); archive.reconnect()
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertTrue(archive.isDeleted)
        let deletedToken = archive.restoreToken
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(archive.restoreToken, deletedToken)
        XCTAssertEqual(archive.status, "这幅作品已删除，请开始新一题")
    }

    func testNewSnapshotDuringInflightUploadEventuallySendsLatest() async throws {
        var revisions: [String] = []
        let archive = DrawingArchive(transport: { request in
            revisions.append(try JSONDecoder().decode(DrawingArchive.Snapshot.self, from: request.httpBody!).revision)
            if revisions.count == 1 {
                await withCheckedContinuation { continuation in
                    Task.detached { try? await Task.sleep(for: .milliseconds(1100)); continuation.resume() }
                }
            }
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        archive.configure(host: "localhost", sessionId: UUID().uuidString)
        archive.changed(PKDrawing())
        try await Task.sleep(for: .milliseconds(800))
        archive.changed(PKDrawing())
        try await Task.sleep(for: .milliseconds(2000))
        XCTAssertEqual(revisions.count, 2)
        XCTAssertNotEqual(revisions.first, revisions.last)
    }
}
