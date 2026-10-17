import XCTest
import PencilKit
@testable import ScholarPad

/// Task 5: 离线可控单测覆盖照片识别重试/换主机/回执校验/旧缓存。
/// 用注入 Transport 完全控制每阶段 HTTP 响应，不依赖真实网络。
final class WorkspacePhotoRetryOfflineTests: XCTestCase {
    @MainActor func testMultipleProblemsAreNotAStatementAndRemainSelectableAfterRestart() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let cache = WorkspaceCache(directory: dir)
        let transport: ProblemCaptureModel.Transport = { request in
            let url = request.url!
            if url.path == "/workspace/sessions" { return self.makeResponse(url: url, status: 201, body: self.emptySessionBody(sessionId: "multi-session")) }
            if url.path.hasSuffix("/media") { return self.makeResponse(url: url, status: 201, body: ["mediaId": "photo"]) }
            return self.makeResponse(url: url, status: 200, body: ["status": "multiple", "candidates": ["2.4×0.3=?", "3.6÷0.4=?"], "message": "选择一道题"])
        }
        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.host = "192.0.2.1"; model.currentUnit = "小数乘法"; model.capture(makeImage())
        await model.usePhoto()
        XCTAssertNil(model.record)
        XCTAssertTrue(model.status.contains("选择"), model.status)
        let reopened = ProblemCaptureModel(transport: transport, cache: cache)
        XCTAssertTrue(reopened.status.contains("选择"), "恢复后不能把多题选择退回普通上传状态")
        XCTAssertEqual(reopened.photoCandidates, ["2.4×0.3=?", "3.6÷0.4=?"])
    }
    @MainActor func testSelectionReceiptLossRetainsCandidatesAndReplaysOnlySelectedProblem() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let cache = WorkspaceCache(directory: dir)
        var recognitionCalls = 0
        var selectedEvents: [String] = []
        let transport: ProblemCaptureModel.Transport = { request in
            let url = request.url!
            if url.path == "/workspace/sessions" { return self.makeResponse(url: url, status: 201, body: self.emptySessionBody(sessionId: "selection-session")) }
            if url.path.hasSuffix("/media") { return self.makeResponse(url: url, status: 201, body: ["mediaId": "photo"]) }
            if url.path.hasSuffix("/recognize") {
                recognitionCalls += 1
                return self.makeResponse(url: url, status: 200, body: ["status": "multiple", "candidates": ["2.4×0.3=?", "3.6÷0.4=?"]])
            }
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            XCTAssertEqual(body["text"] as? String, "3.6÷0.4=?")
            selectedEvents.append(try XCTUnwrap(body["eventId"] as? String))
            if selectedEvents.count == 1 { throw URLError(.networkConnectionLost) }
            var record = self.recognizedBody(sessionId: "selection-session", photoId: "photo", unit: "小数乘法")
            var problem = record["problem"] as! [String: Any]
            problem["statement"] = ["text": "3.6÷0.4=?", "revision": 0, "confirmed": false] as [String: Any]
            record["problem"] = problem
            return self.makeResponse(url: url, status: 200, body: record)
        }
        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.host = "192.0.2.1"; model.currentUnit = "小数乘法"; model.capture(makeImage())
        await model.usePhoto(); await model.selectPhotoCandidate(1)
        XCTAssertNil(model.record)
        XCTAssertEqual(model.photoCandidates.count, 2)
        let reopened = ProblemCaptureModel(transport: transport, cache: cache)
        reopened.host = "192.0.2.1"; reopened.currentUnit = "小数乘法"
        await reopened.selectPhotoCandidate(0)
        XCTAssertEqual(selectedEvents.count, 1, "未收到回执时不能另选一题导致错配")
        await reopened.selectPhotoCandidate(1)
        XCTAssertEqual(selectedEvents.count, 2)
        XCTAssertEqual(selectedEvents.first, selectedEvents.last)
        XCTAssertEqual(recognitionCalls, 1, "选择重试不能再次调用识别模型")
        XCTAssertEqual(reopened.record?.problem?.statement.text, "3.6÷0.4=?")
        XCTAssertEqual(reopened.record?.problem?.statement.confirmed, false)
        XCTAssertNotNil(reopened.photo)
        XCTAssertNil(try cache.load()?.pendingPhotoRecognition)
    }
    private var originalHost: String?
    private var originalUnit: String?
    override func setUp() {
        super.setUp()
        originalHost = UserDefaults.standard.string(forKey: "workspaceHost")
        originalUnit = UserDefaults.standard.string(forKey: "workspaceCurrentUnit")
    }
    override func tearDown() {
        UserDefaults.standard.set(originalHost, forKey: "workspaceHost")
        UserDefaults.standard.set(originalUnit, forKey: "workspaceCurrentUnit")
        super.tearDown()
    }

    @MainActor func testSwitchUnitDoesNotSendOldCurriculumRequest() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let cache = WorkspaceCache(directory: dir)
        let session = UUID().uuidString
        var requests = 0
        let model = ProblemCaptureModel(transport: { request in
            requests += 1
            if request.url!.path == "/workspace/sessions" {
                return self.makeResponse(url: request.url!, status: 201, body: self.emptySessionBody(sessionId: session))
            }
            if request.url!.path.contains("/media") {
                return self.makeResponse(url: request.url!, status: 201, body: ["mediaId": UUID().uuidString])
            }
            throw URLError(.timedOut)
        }, cache: cache)
        model.host = "192.0.2.1"; model.currentUnit = "小数乘法"
        model.capture(makeImage()); await model.usePhoto()
        XCTAssertEqual(try cache.load()?.pendingPhotoRecognition?.unit, "小数乘法")
        let before = requests
        model.currentUnit = "小数除法"
        await model.usePhoto()
        XCTAssertEqual(requests, before, "更换课程不能发送旧课程的待识别请求")
        XCTAssertNil(try cache.load()?.pendingPhotoRecognition)
        XCTAssertNotNil(model.photo)
        XCTAssertTrue(model.status.contains("课程"))
    }
    @MainActor func testLostPhotoReceiptReplaysSameEventAfterRestart() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let cache = WorkspaceCache(directory: dir)
        let session = UUID().uuidString, photo = UUID().uuidString, preview = UUID().uuidString
        var creations = 0
        var photoEvents: [String] = []
        let transport: ProblemCaptureModel.Transport = { request in
            let url = request.url!
            if url.path == "/workspace/sessions" {
                creations += 1
                return self.makeResponse(url: url, status: 201, body: self.emptySessionBody(sessionId: session))
            }
            if url.path.contains("/media") {
                let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                if body["kind"] as? String == "problemPhoto" {
                    photoEvents.append(try XCTUnwrap(body["eventId"] as? String))
                    if photoEvents.count == 1 { throw URLError(.networkConnectionLost) }
                    return self.makeResponse(url: url, status: 201, body: ["mediaId": photo])
                }
                return self.makeResponse(url: url, status: 201, body: ["mediaId": preview])
            }
            return self.makeResponse(url: url, status: 200, body: self.recognizedBody(sessionId: session, photoId: photo, unit: "小数乘法"))
        }
        let first = ProblemCaptureModel(transport: transport, cache: cache)
        first.host = "192.0.2.1"; first.currentUnit = "小数乘法"
        first.capture(makeImage()); await first.usePhoto()
        XCTAssertNil(try cache.load()?.pendingPhotoRecognition?.photoId)
        let reopened = ProblemCaptureModel(transport: transport, cache: cache)
        reopened.host = "192.0.2.1"; reopened.currentUnit = "小数乘法"
        await reopened.usePhoto()
        XCTAssertEqual(creations, 1)
        XCTAssertEqual(photoEvents.count, 2)
        XCTAssertEqual(photoEvents.first, photoEvents.last)
        XCTAssertEqual(reopened.record?.sessionId, session)
        XCTAssertEqual(reopened.record?.problem?.photoId, photo)
        XCTAssertNil(try cache.load()?.pendingPhotoRecognition)
    }

    private func makeImage() -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 200))
        return renderer.image { ctx in UIColor.blue.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 200, height: 200)) }
    }

    private func makeResponse(url: URL, status: Int, body: [String: Any]) -> (Data, URLResponse) {
        let data = try! JSONSerialization.data(withJSONObject: body)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
        return (data, response)
    }

    private func emptySessionBody(sessionId: String, revision: Int = 0) -> [String: Any] {
        ["schemaVersion": 2, "sessionId": sessionId, "eventId": UUID().uuidString, "revision": revision,
         "problem": NSNull(), "phase": "confirming", "childInkBase64": "",
         "board": ["revision": 0, "rectangles": []] as [String: Any],
         "submissions": [], "feedback": [], "openQuestions": []]
    }

    private func recognizedBody(sessionId: String, photoId: String, unit: String, revision: Int = 1, confirmed: Bool = false) -> [String: Any] {
        ["schemaVersion": 2, "sessionId": sessionId, "eventId": UUID().uuidString, "revision": revision,
         "problem": ["problemId": UUID().uuidString, "source": "camera", "photoId": photoId,
                      "curriculum": ["edition": "人教版", "grade": 5, "term": "上", "currentUnit": unit] as [String: Any],
                      "statement": ["text": "每米彩带2.4元", "revision": 0, "confirmed": confirmed] as [String: Any]] as [String: Any],
         "phase": "confirming", "childInkBase64": "",
         "board": ["revision": 0, "rectangles": []] as [String: Any],
         "submissions": [], "feedback": [], "openQuestions": []]
    }

    // 1. 上传成功但识别失败 → 重试复用同一 session/photoId/previewId
    @MainActor func testUploadSuccessRecognizeFailRetryReusesSession() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("off-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let testSessionId = UUID().uuidString
        var recognizeCalls = 0
        var mediaCalls = 0

        let transport: ProblemCaptureModel.Transport = { req in
            let path = req.url!.path
            if path == "/workspace/sessions" {
                return self.makeResponse(url: req.url!, status: 201, body: self.emptySessionBody(sessionId: testSessionId))
            }
            if path.contains("/media") {
                mediaCalls += 1
                return self.makeResponse(url: req.url!, status: 201, body: ["mediaId": UUID().uuidString])
            }
            if path.contains("/recognize") {
                recognizeCalls += 1
                throw URLError(.timedOut) // 识别失败
            }
            fatalError("unexpected path: \(path)")
        }

        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.capture(makeImage())
        model.host = "192.0.2.1" // 不会真正联网，transport 截获
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        // 第一次：session 创建 + 2 次 media + recognize 失败
        let firstSession = try cache.load()?.pendingPhotoRecognition?.sessionId
        XCTAssertEqual(firstSession, testSessionId)
        XCTAssertEqual(mediaCalls, 2, "应上传 photo + preview")
        XCTAssertEqual(recognizeCalls, 1)
        XCTAssertNotNil(try cache.load()?.pendingPhotoRecognition?.photoId, "photoId 应已持久化")
        XCTAssertNotNil(try cache.load()?.pendingPhotoRecognition?.previewId, "previewId 应已持久化")

        // 重试：不应再上传 media，只重试 recognize
        await model.usePhoto()
        XCTAssertEqual(mediaCalls, 2, "重试不应重复上传 media")
        XCTAssertEqual(recognizeCalls, 2, "应重试 recognize")
        XCTAssertEqual(try cache.load()?.pendingPhotoRecognition?.sessionId, testSessionId, "同一 session")
    }

    // 2. 重启后从缓存恢复同一 pending，继续重试
    @MainActor func testRestartFromCacheReusesPending() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("off-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let testSessionId = UUID().uuidString
        var recognizeCalls = 0

        let transport: ProblemCaptureModel.Transport = { req in
            let path = req.url!.path
            if path == "/workspace/sessions" { return self.makeResponse(url: req.url!, status: 201, body: self.emptySessionBody(sessionId: testSessionId)) }
            if path.contains("/media") { return self.makeResponse(url: req.url!, status: 201, body: ["mediaId": UUID().uuidString]) }
            if path.contains("/recognize") { recognizeCalls += 1; throw URLError(.timedOut) }
            fatalError("unexpected")
        }

        let model1 = ProblemCaptureModel(transport: transport, cache: cache)
        model1.capture(makeImage())
        model1.host = "192.0.2.1"
        model1.currentUnit = "小数乘法"
        await model1.usePhoto()

        // 显式模拟家长已配置的主机；不能依赖别的成功用例污染全局配置。
        UserDefaults.standard.set("192.0.2.1", forKey: "workspaceHost")
        UserDefaults.standard.set("小数乘法", forKey: "workspaceCurrentUnit")
        // 重启：新 model 从缓存加载 pending
        let model2 = ProblemCaptureModel(transport: transport, cache: cache)
        XCTAssertEqual(model2.host, "192.0.2.1", "host 应从 UserDefaults 恢复")
        await model2.usePhoto()
        XCTAssertEqual(recognizeCalls, 2, "重启后应继续重试 recognize")
        XCTAssertEqual(try cache.load()?.pendingPhotoRecognition?.sessionId, testSessionId)
    }

    // 3. 换主机不发送旧 session/photoId
    @MainActor func testSwitchHostClearsPending() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("off-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let testSessionId = UUID().uuidString
        var anyRequest = false

        let transport: ProblemCaptureModel.Transport = { req in
            anyRequest = true
            let path = req.url!.path
            if path == "/workspace/sessions" { return self.makeResponse(url: req.url!, status: 201, body: self.emptySessionBody(sessionId: testSessionId)) }
            if path.contains("/media") { return self.makeResponse(url: req.url!, status: 201, body: ["mediaId": UUID().uuidString]) }
            if path.contains("/recognize") { throw URLError(.timedOut) }
            fatalError("unexpected")
        }

        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.capture(makeImage())
        model.host = "192.0.2.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        XCTAssertNotNil(try cache.load()?.pendingPhotoRecognition)

        // 换主机
        anyRequest = false
        model.host = "192.0.2.2"
        await model.usePhoto()
        XCTAssertFalse(anyRequest, "换主机不应发送任何请求到旧 session")
        XCTAssertNil(try cache.load()?.pendingPhotoRecognition, "pending 应已清除")
        XCTAssertTrue(model.status.contains("照片保留"), "应提示照片保留: \(model.status)")
    }

    // 4. 错误回执：sessionId 不匹配 → 拒绝，不清除 pending
    @MainActor func testRejectBadSessionIdInReceipt() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("off-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let testSessionId = UUID().uuidString
        let wrongSessionId = UUID().uuidString
        let testPhotoId = UUID().uuidString

        let transport: ProblemCaptureModel.Transport = { req in
            let path = req.url!.path
            if path == "/workspace/sessions" { return self.makeResponse(url: req.url!, status: 201, body: self.emptySessionBody(sessionId: testSessionId)) }
            if path.contains("/media") { return self.makeResponse(url: req.url!, status: 201, body: ["mediaId": testPhotoId]) }
            if path.contains("/recognize") {
                // 返回错误的 sessionId
                return self.makeResponse(url: req.url!, status: 200, body: self.recognizedBody(sessionId: wrongSessionId, photoId: testPhotoId, unit: "小数乘法"))
            }
            fatalError("unexpected")
        }

        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.capture(makeImage())
        model.host = "192.0.2.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        XCTAssertNotNil(try cache.load()?.pendingPhotoRecognition, "sessionId 不匹配不应清除 pending")
        XCTAssertNil(model.record, "不应接受错误回执")
    }

    // 5. 错误回执：photoId 不匹配 → 拒绝
    @MainActor func testRejectBadPhotoIdInReceipt() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("off-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let testSessionId = UUID().uuidString

        let transport: ProblemCaptureModel.Transport = { req in
            let path = req.url!.path
            if path == "/workspace/sessions" { return self.makeResponse(url: req.url!, status: 201, body: self.emptySessionBody(sessionId: testSessionId)) }
            if path.contains("/media") { return self.makeResponse(url: req.url!, status: 201, body: ["mediaId": UUID().uuidString]) }
            if path.contains("/recognize") {
                return self.makeResponse(url: req.url!, status: 200, body: self.recognizedBody(sessionId: testSessionId, photoId: UUID().uuidString, unit: "小数乘法"))
            }
            fatalError("unexpected")
        }

        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.capture(makeImage())
        model.host = "192.0.2.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        XCTAssertNotNil(try cache.load()?.pendingPhotoRecognition, "photoId 不匹配不应清除 pending")
    }

    // 6. 错误回执：课程不匹配 → 拒绝
    @MainActor func testRejectBadCurriculumInReceipt() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("off-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let testSessionId = UUID().uuidString
        let testPhotoId = UUID().uuidString

        let transport: ProblemCaptureModel.Transport = { req in
            let path = req.url!.path
            if path == "/workspace/sessions" { return self.makeResponse(url: req.url!, status: 201, body: self.emptySessionBody(sessionId: testSessionId)) }
            if path.contains("/media") { return self.makeResponse(url: req.url!, status: 201, body: ["mediaId": testPhotoId]) }
            if path.contains("/recognize") {
                return self.makeResponse(url: req.url!, status: 200, body: self.recognizedBody(sessionId: testSessionId, photoId: testPhotoId, unit: "分数除法"))
            }
            fatalError("unexpected")
        }

        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.capture(makeImage())
        model.host = "192.0.2.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        XCTAssertNotNil(try cache.load()?.pendingPhotoRecognition, "课程不匹配不应清除 pending")
    }

    // 7. 错误回执：已 confirmed → 拒绝
    @MainActor func testRejectConfirmedInReceipt() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("off-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let testSessionId = UUID().uuidString
        let testPhotoId = UUID().uuidString

        let transport: ProblemCaptureModel.Transport = { req in
            let path = req.url!.path
            if path == "/workspace/sessions" { return self.makeResponse(url: req.url!, status: 201, body: self.emptySessionBody(sessionId: testSessionId)) }
            if path.contains("/media") { return self.makeResponse(url: req.url!, status: 201, body: ["mediaId": testPhotoId]) }
            if path.contains("/recognize") {
                return self.makeResponse(url: req.url!, status: 200, body: self.recognizedBody(sessionId: testSessionId, photoId: testPhotoId, unit: "小数乘法", confirmed: true))
            }
            fatalError("unexpected")
        }

        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.capture(makeImage())
        model.host = "192.0.2.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        XCTAssertNotNil(try cache.load()?.pendingPhotoRecognition, "已 confirmed 不应清除 pending")
    }

    // 8. 旧缓存缺 host → 可恢复，清除 pending，保留照片
    @MainActor func testOldCacheWithoutHostClearsPending() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("off-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        // 写入旧格式 pending（host=nil）
        let oldPending = PendingPhotoRecognition(
            host: nil, sessionId: UUID().uuidString,
            photoEventId: UUID().uuidString, photoId: UUID().uuidString,
            previewEventId: UUID().uuidString, previewId: UUID().uuidString,
            recognizeEventId: UUID().uuidString, expectedRevision: 0, unit: "小数乘法")
        let draft = WorkspaceLocalDraft(
            photo: makeImage().pngData()!, drawing: PKDrawing().dataRepresentation(),
            record: nil, pendingPhotoRecognition: oldPending)
        try cache.save(draft)

        var anyRequest = false
        let transport: ProblemCaptureModel.Transport = { _ in anyRequest = true; throw URLError(.timedOut) }
        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.host = "192.0.2.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        XCTAssertFalse(anyRequest, "旧缓存缺 host 不应发送请求")
        XCTAssertNil(try cache.load()?.pendingPhotoRecognition, "旧 pending 应已清除")
        XCTAssertTrue(model.status.contains("照片保留"), "应提示照片保留: \(model.status)")
    }

    // 9. 正常流程：上传 → 识别 → 回执校验通过 → pending 清除
    @MainActor func testHappyPathClearsPending() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("off-\(UUID().uuidString)")
        let cache = WorkspaceCache(directory: dir)
        let testSessionId = UUID().uuidString
        let testPhotoId = UUID().uuidString

        let transport: ProblemCaptureModel.Transport = { req in
            let path = req.url!.path
            if path == "/workspace/sessions" { return self.makeResponse(url: req.url!, status: 201, body: self.emptySessionBody(sessionId: testSessionId)) }
            if path.contains("/media") { return self.makeResponse(url: req.url!, status: 201, body: ["mediaId": testPhotoId]) }
            if path.contains("/recognize") {
                return self.makeResponse(url: req.url!, status: 200, body: self.recognizedBody(sessionId: testSessionId, photoId: testPhotoId, unit: "小数乘法"))
            }
            fatalError("unexpected")
        }

        let model = ProblemCaptureModel(transport: transport, cache: cache)
        model.capture(makeImage())
        model.host = "192.0.2.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        XCTAssertNil(try cache.load()?.pendingPhotoRecognition, "成功后应清除 pending")
        XCTAssertNotNil(model.record, "应设置 record")
        XCTAssertFalse(model.record?.problem?.statement.confirmed ?? true, "候选应未确认")
    }
}
