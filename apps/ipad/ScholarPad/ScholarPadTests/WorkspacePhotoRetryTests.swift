import XCTest
import PencilKit
@testable import ScholarPad

/// Task 3: 照片请求阶段持久化重试（真实网络版本）。
/// 这些测试用 127.0.0.1 发真实失败；离线可控版本见 WorkspacePhotoRetryOfflineTests。
final class WorkspacePhotoRetryTests: XCTestCase {
    private func makeImage() -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 200))
        return renderer.image { ctx in
            UIColor.blue.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 200, height: 200))
        }
    }

    @MainActor
    func testRetryReusesPreSetPendingSession() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("retry-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let presetSessionId = UUID().uuidString
        let presetEventId = UUID().uuidString
        let draft = WorkspaceLocalDraft(
            photo: makeImage().pngData()!,
            drawing: PKDrawing().dataRepresentation(),
            record: nil,
            pendingPhotoRecognition: PendingPhotoRecognition(
                host: "127.0.0.1",
                sessionId: presetSessionId,
                photoEventId: UUID().uuidString, photoId: nil,
                previewEventId: UUID().uuidString, previewId: nil,
                recognizeEventId: presetEventId,
                expectedRevision: 0, unit: "小数乘法"))
        try cache.save(draft)
        let model = ProblemCaptureModel(cache: cache)
        model.host = "127.0.0.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        let after = try cache.load()
        XCTAssertEqual(after?.pendingPhotoRecognition?.sessionId, presetSessionId, "重试应复用同一 sessionId")
    }

    @MainActor
    func testErrorReasonCapturedFromResponseBody() async {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("retry-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let model = ProblemCaptureModel(cache: cache)
        model.capture(makeImage())
        model.host = "127.0.0.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        XCTAssertFalse(model.status.contains("HTTP"), "status 不应含裸 HTTP: \(model.status)")
        XCTAssertFalse(model.status.isEmpty, "status 不应为空")
    }

    @MainActor
    func testNewPhotoClearsPendingRecognition() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("retry-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let draft = WorkspaceLocalDraft(
            photo: makeImage().pngData()!,
            drawing: PKDrawing().dataRepresentation(),
            record: nil,
            pendingPhotoRecognition: PendingPhotoRecognition(
                host: "127.0.0.1",
                sessionId: UUID().uuidString,
                photoEventId: UUID().uuidString, photoId: nil,
                previewEventId: UUID().uuidString, previewId: nil,
                recognizeEventId: UUID().uuidString,
                expectedRevision: 0, unit: "小数乘法"))
        try cache.save(draft)
        let model = ProblemCaptureModel(cache: cache)
        model.capture(makeImage())
        let after = try cache.load()
        XCTAssertNil(after?.pendingPhotoRecognition, "重新拍照应清除 pendingPhotoRecognition")
    }

    @MainActor
    func testPendingPhotoRecognitionCodableRoundTrip() throws {
        let pending = PendingPhotoRecognition(
            host: "192.0.2.1",
            sessionId: "s1", photoEventId: "pe1", photoId: "p1",
            previewEventId: "ve1", previewId: "v1",
            recognizeEventId: "re1", expectedRevision: 3, unit: "分数除法")
        let data = try JSONEncoder().encode(pending)
        let decoded = try JSONDecoder().decode(PendingPhotoRecognition.self, from: data)
        XCTAssertEqual(pending, decoded, "Codable 往返应保持一致")
    }
}
