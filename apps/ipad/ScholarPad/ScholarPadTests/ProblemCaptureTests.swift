import XCTest
import UIKit
import PencilKit
@testable import ScholarPad

final class ProblemCaptureTests: XCTestCase {
    @MainActor func testTeacherReceiptRebasesPreviouslyFailedInkSaveWithoutDroppingDrawing() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        LearningWorkspaceView.writeConfirmedFixture(to: root)
        let cache = WorkspaceCache(directory: root)
        var draft = try XCTUnwrap(cache.load())
        var pending = try XCTUnwrap(draft.record); pending.revision += 1; pending.eventId = "old-pending-save"
        draft.pendingSave = pending; try cache.save(draft)
        var remote = try XCTUnwrap(draft.record); remote.revision = pending.revision + 1; remote.eventId = "teacher-receipt"
        remote.feedback = [.init(responseId: "new-reply", turnId: "new-turn", summary: "你想怎么检查？", contested: false)]
        var attempted = false
        let model = ProblemCaptureModel(cache: cache, save: { snapshot, expected, _ in
            attempted = true
            XCTAssertEqual(expected, remote.revision)
            XCTAssertEqual(snapshot.feedback, remote.feedback)
            XCTAssertNotEqual(snapshot.eventId, pending.eventId)
            return snapshot.revision
        })
        let originalDrawing = model.drawing.dataRepresentation()
        try model.acceptServerRecord(remote)
        await model.saveToHost()
        XCTAssertTrue(attempted)
        XCTAssertEqual(try cache.load()?.drawing, originalDrawing)
        XCTAssertEqual(model.record?.feedback, remote.feedback)
    }
    @MainActor func testChildDiagramSurvivesReplySaveAndReopen() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        struct Fixture: Decodable { var emptyRecord: WorkspaceRecord; var curated: WorkspaceProblem }
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "workspace-learning-v2", withExtension: "json"))
        let f = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        var record = f.emptyRecord; record.problem = f.curated; record.phase = "exploring"
        let cache = WorkspaceCache(directory: root)
        let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { _ in UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 20, height: 20)) }
        try cache.save(.init(photo: try XCTUnwrap(image.jpegData(compressionQuality: 0.8)), drawing: PKDrawing().dataRepresentation(), record: record))
        let model = ProblemCaptureModel(cache: cache, save: { snapshot, _, _ in
            XCTAssertEqual(snapshot.board.rectangles.first?.shadedCells, [2])
            return snapshot.revision
        })
        model.editDiagram { $0.addRectangle(.init(id: "child-bar", wholeGroupId: "whole", rows: 1, columns: 10, shadedCells: [], owner: .child)) }
        model.editDiagram { $0.toggleCell(rectangleId: "child-bar", cell: 2) }
        XCTAssertEqual(model.localBoardRevision, 2)
        try model.acceptServerRecord(record)
        XCTAssertEqual(model.diagram.board.rectangles.first?.shadedCells, [2])
        await model.saveToHost()
        let reopened = ProblemCaptureModel(cache: cache)
        XCTAssertEqual(reopened.diagram.board.rectangles.first?.shadedCells, [2])
        XCTAssertEqual(reopened.drawing.strokes.count, 0)
        let blank = TutorSnapshot.workspaceImage(drawing: PKDrawing(), statement: "题目")
        let withDiagram = TutorSnapshot.workspaceImage(drawing: PKDrawing(), statement: "题目", board: reopened.diagram.board)
        XCTAssertGreaterThan(withDiagram.size.height, blank.size.height)
        XCTAssertNotNil(TutorSnapshot.encode(withDiagram))
    }
    @MainActor func testConflictChoiceKeepsBothCopiesAndUsesRemoteRevision() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        struct Fixture: Decodable { var emptyRecord: WorkspaceRecord; var curated: WorkspaceProblem }
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "workspace-learning-v2", withExtension: "json"))
        let f = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        var local = f.emptyRecord; local.problem = f.curated; local.phase = "exploring"
        var remote = local; remote.revision = 4; remote.eventId = "remote-save"
        remote.childInkBase64 = PKDrawing().dataRepresentation().base64EncodedString()
        let cache = WorkspaceCache(directory: root)
        let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { _ in UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 20, height: 20)) }
        let point = PKStrokePoint(location: CGPoint(x: 10, y: 10), timeOffset: 0, size: CGSize(width: 4, height: 4), opacity: 1, force: 1, azimuth: 0, altitude: 1)
        let localInk = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: [point], creationDate: Date()))])
        try cache.save(.init(photo: try XCTUnwrap(image.jpegData(compressionQuality: 0.8)), drawing: localInk.dataRepresentation(), record: local))
        var writes = 0
        let model = ProblemCaptureModel(cache: cache, save: { snapshot, expected, _ in
            writes += 1
            if writes == 1 { throw WorkspaceError.server(409, nil) }
            XCTAssertEqual(expected, 4); XCTAssertEqual(snapshot.revision, 5)
            return snapshot.revision
        }, fetch: { _, _ in remote })
        await model.saveToHost()
        XCTAssertNotNil(model.conflictRecord)
        XCTAssertEqual(model.record?.revision, 0)
        await model.resolveConflict(useLocal: true)
        XCTAssertEqual(model.record?.revision, 5)
        XCTAssertEqual(model.drawing.strokes.count, 1)
        XCTAssertNil(model.conflictRecord)
        let archives = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).filter { $0.lastPathComponent.hasPrefix("conflict-") }
        XCTAssertEqual(archives.count, 1, "选择前持久化双方副本")
        remote.revision = 6
        let second = ProblemCaptureModel(cache: cache, save: { _, _, _ in throw WorkspaceError.server(409, nil) }, fetch: { _, _ in remote })
        await second.saveToHost()
        await second.resolveConflict(useLocal: false)
        XCTAssertEqual(second.record?.revision, 6)
        XCTAssertEqual(second.drawing.strokes.count, 0)
        XCTAssertEqual(second.restoreToken, 2)
        let allArchives = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).filter { $0.lastPathComponent.hasPrefix("conflict-") }
        XCTAssertEqual(allArchives.count, 2)
        XCTAssertEqual(ProblemCaptureModel(cache: cache).drawing.strokes.count, 0)
        await second.saveToHost()
        XCTAssertNotNil(second.conflictRecord)
        second.capture(image)
        XCTAssertNil(second.conflictRecord, "重新拍题不能把上一题的冲突选择带入新题")
    }
    @MainActor func testCapturePreservesFullResolutionInsteadOfModelThumbnail() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 2400, height: 1800), format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 2400, height: 1800))
        }
        let cache = WorkspaceCache(directory: root), model = ProblemCaptureModel(cache: WorkspaceCache(directory: root))
        model.capture(image)
        let saved = try XCTUnwrap(cache.load())
        XCTAssertEqual(UIImage(data: saved.photo)?.cgImage?.width, 2400)
        XCTAssertEqual(UIImage(data: saved.photo)?.cgImage?.height, 1800)
        XCTAssertLessThanOrEqual(saved.photo.count, 2 * 1024 * 1024)
    }
    @MainActor func testSaveDuringInFlightWriteCoalescesNewInkAndWaitsForLatestReceipt() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        struct Fixture: Decodable { var emptyRecord: WorkspaceRecord; var curated: WorkspaceProblem }
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "workspace-learning-v2", withExtension: "json"))
        let f = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        var record = f.emptyRecord; record.problem = f.curated; record.phase = "exploring"
        let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { _ in UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 20, height: 20)) }
        try cache.save(.init(photo: try XCTUnwrap(image.jpegData(compressionQuality: 0.8)), drawing: PKDrawing().dataRepresentation(), record: record))
        var writes: [WorkspaceRecord] = [], release: CheckedContinuation<Void, Never>?
        let model = ProblemCaptureModel(cache: cache, save: { snapshot, expected, _ in
            writes.append(snapshot); XCTAssertEqual(expected, writes.count - 1)
            if writes.count == 1 { await withCheckedContinuation { release = $0 } }
            return snapshot.revision
        })
        let first = Task { await model.saveToHost() }
        for _ in 0..<100 { if release != nil { break }; await Task.yield() }
        XCTAssertNotNil(release)
        let points = [CGPoint(x: 10, y: 10), CGPoint(x: 80, y: 50)].map {
            PKStrokePoint(location: $0, timeOffset: 0, size: CGSize(width: 4, height: 4), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let ink = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
        model.updateDrawing(ink)
        model.editDiagram { $0.addRectangle(.init(id: "during-save", wholeGroupId: "whole", rows: 1, columns: 10, shadedCells: [0, 1, 2], owner: .child)) }
        var secondFinished = false
        let second = Task { await model.saveToHost(); secondFinished = true }
        for _ in 0..<10 { await Task.yield() }
        XCTAssertFalse(secondFinished, "退出保存不能在前一次写入仍在途中时直接返回")
        release?.resume(); await first.value; await second.value
        XCTAssertEqual(writes.count, 2)
        XCTAssertEqual(writes.last?.childInkBase64, ink.dataRepresentation().base64EncodedString())
        XCTAssertEqual(writes.last?.board.rectangles.first?.shadedCells, [0, 1, 2], "旧回执不能吞掉保存期间新建的图")
        XCTAssertEqual(model.record?.revision, 2)
        XCTAssertEqual(try cache.load()?.record?.revision, 2)
        XCTAssertEqual(model.status, "已保存到学习主机。")
    }
    @MainActor func testSaveFailureKeepsDraftAndOnlyAcknowledgedRevisionIsSaved() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "workspace-learning-v2", withExtension: "json"))
        struct Fixture: Decodable { var emptyRecord: WorkspaceRecord; var curated: WorkspaceProblem }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        var record = fixture.emptyRecord; record.problem = fixture.curated; record.phase = "exploring"
        let image = UIGraphicsImageRenderer(size: CGSize(width: 80, height: 80)).image { _ in UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 80, height: 80)) }
        try cache.save(.init(photo: try XCTUnwrap(image.jpegData(compressionQuality: 0.8)), drawing: PKDrawing().dataRepresentation(), record: record))
        var fail = true
        var sent: WorkspaceRecord?
        let model = ProblemCaptureModel(cache: cache, save: { snapshot, expected, _ in
            XCTAssertEqual(expected, 0)
            sent = snapshot
            if fail { throw WorkspaceError.server(409, nil) }
            return snapshot.revision
        })
        await model.saveToHost()
        XCTAssertEqual(model.record?.revision, 0)
        XCTAssertEqual(try cache.load()?.record?.revision, 0)
        XCTAssertFalse(model.status.contains("已保存到学习主机"))
        fail = false
        await model.saveToHost()
        XCTAssertEqual(model.record?.revision, 1)
        XCTAssertEqual(try cache.load()?.record?.revision, 1)
        XCTAssertEqual(sent?.childInkBase64, model.drawing.dataRepresentation().base64EncodedString())
        XCTAssertEqual(model.status, "已保存到学习主机。")
        let restored = ProblemCaptureModel(cache: cache)
        XCTAssertEqual(restored.record, model.record)
        XCTAssertEqual(restored.drawing.dataRepresentation(), model.drawing.dataRepresentation())
        let point = PKStrokePoint(location: CGPoint(x: 20, y: 20), timeOffset: 0, size: CGSize(width: 2, height: 2), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        let ink = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: [point], creationDate: Date()))])
        restored.updateDrawing(ink)
        let localBoardRevision = try XCTUnwrap(restored.localBoardRevision)
        XCTAssertGreaterThan(localBoardRevision, record.board.revision)
        let reopened = ProblemCaptureModel(cache: cache)
        XCTAssertEqual(reopened.localBoardRevision, localBoardRevision)
    }

    @MainActor func testLostSaveReceiptRetriesSameEventAfterRelaunch() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = WorkspaceCache(directory: root)
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "workspace-learning-v2", withExtension: "json"))
        struct Fixture: Decodable { var emptyRecord: WorkspaceRecord; var curated: WorkspaceProblem }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        var record = fixture.emptyRecord; record.problem = fixture.curated; record.phase = "exploring"
        let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { _ in UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 20, height: 20)) }
        try cache.save(.init(photo: try XCTUnwrap(image.jpegData(compressionQuality: 0.8)), drawing: PKDrawing().dataRepresentation(), record: record))
        var first: WorkspaceRecord?
        let model = ProblemCaptureModel(cache: cache, save: { snapshot, _, _ in
            first = snapshot; throw URLError(.networkConnectionLost)
        })
        await model.saveToHost()
        let reopened = ProblemCaptureModel(cache: cache, save: { snapshot, expected, _ in
            XCTAssertEqual(snapshot, first, "回执丢失后必须重放同一个保存，而不是生成新事件")
            XCTAssertEqual(expected, 0)
            return snapshot.revision
        })
        await reopened.saveToHost()
        XCTAssertEqual(reopened.record?.revision, 1)
    }

    @MainActor func testOnlyUsePhotoUploadsAndCancelPreservesDraft() async throws {
        let model = ProblemCaptureModel()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 80, height: 80)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 80, height: 80))
        }
        model.capture(image)
        XCTAssertNotNil(model.photo)
        model.cancelCamera()
        XCTAssertNotNil(model.photo)
        model.currentUnit = "小数乘法"
        model.host = "127.0.0.1"
        await model.usePhoto()
        XCTAssertNotNil(model.photo)
        XCTAssertFalse(model.busy)
        // record 可空（连接失败）或非空（主机运行中）；照片应保留
    }
    /// 2026-10-16 真机：家长没选单元时照片一直识别不了。改为按默认说法照常识别，不再挡住孩子。
    @MainActor func testNoUnitStillRecognizesWithUnspecifiedUnit() async {
        var calls = 0
        let model = ProblemCaptureModel(transport: { _ in calls += 1; throw URLError(.cancelled) })
        let image = UIGraphicsImageRenderer(size: CGSize(width: 80, height: 80)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 80, height: 80))
        }
        model.capture(image)
        model.host = "127.0.0.1"
        model.currentUnit = ""
        await model.usePhoto()
        XCTAssertGreaterThan(calls, 0, "没选单元也要发出识别请求")
        XCTAssertFalse(model.needsConfig)
        XCTAssertEqual(model.effectiveUnit, ProblemCaptureModel.unspecifiedUnit)
    }
}
