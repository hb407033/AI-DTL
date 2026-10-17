// 受控分数画布测试（工作包 B）。合法/非法样例直接取自共享夹具
// packages/session-contracts/fixtures/fraction-learning-v1.json（内容内联如下，修改契约时必须同步）。
import XCTest
import PencilKit
import UIKit
@testable import ScholarPad

final class FractionBoardTests: XCTestCase {

    // MARK: - 共享夹具（fraction-learning-v1.json 内联副本）

    private let fixtureJSON = #"""
    {
      "schemaVersion": 1,
      "sessionId": "fixture-session",
      "envelopes": [
        { "schemaVersion": 1, "sessionId": "fixture-session", "eventId": "event-1", "submissionId": "submission-1", "revision": 3, "type": "submit", "payload": { "challengeId": "fraction-compare-01", "boardRevision": 3 } },
        { "schemaVersion": 1, "sessionId": "fixture-session", "eventId": "event-2", "revision": 4, "type": "requestHelp", "payload": { "challengeId": "fraction-compare-01" } },
        { "schemaVersion": 1, "sessionId": "fixture-session", "eventId": "event-3", "revision": 5, "type": "contest", "payload": { "feedbackId": "feedback-1" } },
        { "schemaVersion": 1, "sessionId": "fixture-session", "eventId": "event-4", "revision": 6, "type": "startTransfer", "payload": { "challengeId": "fraction-transfer-01" } },
        { "schemaVersion": 1, "sessionId": "fixture-session", "eventId": "event-5", "revision": 7, "type": "pause", "payload": {} },
        { "schemaVersion": 1, "sessionId": "fixture-session", "eventId": "event-6", "revision": 8, "type": "resume", "payload": {} },
        { "schemaVersion": 1, "sessionId": "fixture-session", "eventId": "event-7", "revision": 9, "type": "finishSession", "payload": { "reason": "rest" } }
      ],
      "rectangles": [
        { "id": "rect-child-1", "wholeGroupId": "whole-1", "rows": 3, "columns": 4, "shadedCells": [0, 1, 2, 3, 4, 5, 6, 7, 8], "owner": "child" },
        { "id": "rect-child-2", "wholeGroupId": "whole-1", "rows": 3, "columns": 4, "shadedCells": [0, 1, 2, 3, 4, 5, 6, 7], "owner": "child" },
        { "id": "rect-agent-1", "wholeGroupId": "whole-2", "rows": 1, "columns": 2, "shadedCells": [0], "owner": "agent" }
      ],
      "boardStates": [
        {
          "revision": 3,
          "rectangles": [
            { "id": "rect-child-1", "wholeGroupId": "whole-1", "rows": 3, "columns": 4, "shadedCells": [0, 1, 2, 3, 4, 5, 6, 7, 8], "owner": "child" },
            { "id": "rect-child-2", "wholeGroupId": "whole-1", "rows": 3, "columns": 4, "shadedCells": [0, 1, 2, 3, 4, 5, 6, 7], "owner": "child" },
            { "id": "rect-agent-1", "wholeGroupId": "whole-2", "rows": 1, "columns": 2, "shadedCells": [0], "owner": "agent" }
          ]
        }
      ],
      "submissions": [
        { "submissionId": "submission-9", "challengeId": "fraction-transfer-01", "boardRevision": 2, "hintUsed": true }
      ],
      "invalid": {
        "cellOutOfRange": { "id": "r-bad-1", "wholeGroupId": "w", "rows": 2, "columns": 2, "shadedCells": [4], "owner": "child" },
        "duplicateCell": { "id": "r-bad-2", "wholeGroupId": "w", "rows": 2, "columns": 2, "shadedCells": [1, 1], "owner": "child" },
        "tooManyCells": { "id": "r-bad-3", "wholeGroupId": "w", "rows": 8, "columns": 8, "shadedCells": [], "owner": "child" },
        "zeroRows": { "id": "r-bad-4", "wholeGroupId": "w", "rows": 0, "columns": 4, "shadedCells": [], "owner": "child" },
        "illegalOwner": { "id": "r-bad-5", "wholeGroupId": "w", "rows": 2, "columns": 2, "shadedCells": [0], "owner": "teacher" },
        "tooManyChildRectangles": {
          "revision": 0,
          "rectangles": [
            { "id": "c1", "wholeGroupId": "w", "rows": 1, "columns": 2, "shadedCells": [], "owner": "child" },
            { "id": "c2", "wholeGroupId": "w", "rows": 1, "columns": 2, "shadedCells": [], "owner": "child" },
            { "id": "c3", "wholeGroupId": "w", "rows": 1, "columns": 2, "shadedCells": [], "owner": "child" },
            { "id": "c4", "wholeGroupId": "w", "rows": 1, "columns": 2, "shadedCells": [], "owner": "child" },
            { "id": "c5", "wholeGroupId": "w", "rows": 1, "columns": 2, "shadedCells": [], "owner": "child" }
          ]
        },
        "duplicateRectangleIds": {
          "revision": 0,
          "rectangles": [
            { "id": "dup", "wholeGroupId": "w", "rows": 1, "columns": 2, "shadedCells": [], "owner": "child" },
            { "id": "dup", "wholeGroupId": "w", "rows": 1, "columns": 3, "shadedCells": [], "owner": "agent" }
          ]
        },
        "unknownCommand": { "schemaVersion": 1, "sessionId": "fixture-session", "eventId": "event-x", "revision": 0, "type": "eraseChildInk", "payload": {} },
        "wrongSchemaVersion": { "schemaVersion": 2, "sessionId": "fixture-session", "eventId": "event-y", "revision": 0, "type": "pause", "payload": {} },
        "staleRevision": { "schemaVersion": 1, "sessionId": "fixture-session", "eventId": "event-old", "revision": 1, "type": "pause", "payload": {} }
      }
    }
    """#

    private struct FixtureFile: Decodable {
        let rectangles: [FractionRectangle]
        let boardStates: [FractionBoard]
    }

    private func fixtureData() throws -> Data { Data(fixtureJSON.utf8) }

    private func invalidEntry(_ key: String) throws -> Data {
        let raw = try JSONSerialization.jsonObject(with: Data(fixtureJSON.utf8)) as? [String: Any]
        let invalid = try XCTUnwrap(raw?["invalid"] as? [String: Any])
        let entry = try XCTUnwrap(invalid[key])
        return try JSONSerialization.data(withJSONObject: entry)
    }

    private func makeChildRect(_ id: String, whole: String = "w", rows: Int = 2, columns: Int = 2, shaded: [Int] = []) -> FractionRectangle {
        FractionRectangle(id: id, wholeGroupId: whole, rows: rows, columns: columns, shadedCells: shaded, owner: .child)
    }

    private func makeInk() -> PKDrawing {
        let points = [CGPoint(x: 30, y: 30), CGPoint(x: 120, y: 60), CGPoint(x: 200, y: 140)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: TimeInterval(index) * 0.05, size: CGSize(width: 4, height: 4), opacity: 1, force: 1, azimuth: 0, altitude: 0)
        }
        let path = PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSinceReferenceDate: 0))
        let stroke = PKStroke(ink: PKInk(.pen, color: .black), path: path)
        return PKDrawing(strokes: [stroke])
    }

    private func nonWhitePixelCount(_ image: UIImage) -> Int {
        guard let cg = image.cgImage else { return -1 }
        let width = cg.width, height = cg.height
        var pixels = [UInt8](repeating: 255, count: width * height)
        guard let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0) else { return -1 }
        context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        return pixels.reduce(0) { $0 + ($1 < 250 ? 1 : 0) }
    }

    // MARK: - 夹具契约：合法样例必须原样 decode 且通过校验

    func testFixtureRectanglesAndBoardStatesDecodeAndValidate() throws {
        let fixture = try JSONDecoder().decode(FixtureFile.self, from: fixtureData())
        XCTAssertEqual(fixture.rectangles.count, 3)
        XCTAssertEqual(fixture.rectangles[0].id, "rect-child-1")
        XCTAssertEqual(fixture.rectangles[0].wholeGroupId, "whole-1")
        XCTAssertEqual(fixture.rectangles[0].owner, .child)
        XCTAssertEqual(fixture.rectangles[2].owner, .agent)
        for rectangle in fixture.rectangles {
            XCTAssertNil(FractionBoardRules.validate(rectangle), "夹具矩形 \(rectangle.id) 必须合法")
        }
        XCTAssertEqual(fixture.boardStates.count, 1)
        for board in fixture.boardStates {
            XCTAssertNil(FractionBoardRules.validate(board), "夹具 board revision \(board.revision) 必须合法")
        }
        // 字段名必须与公共契约完全一致，不得多存屏幕坐标等任何额外字段
        let encoded = try JSONEncoder().encode(fixture.rectangles[0])
        let keys = try XCTUnwrap((JSONSerialization.jsonObject(with: encoded) as? [String: Any])?.keys.sorted())
        XCTAssertEqual(keys, ["columns", "id", "owner", "rows", "shadedCells", "wholeGroupId"])
    }

    // MARK: - 夹具契约：非法样例一律拒绝，不纠正成别的数学表达

    func testFixtureInvalidRectanglesRejected() throws {
        let cases: [(String, FractionRejection)] = [
            ("cellOutOfRange", .cellOutOfRange(cell: 4, cellCount: 4)),
            ("duplicateCell", .duplicateCell(1)),
            ("tooManyCells", .tooManyCells(rows: 8, columns: 8)),
            ("zeroRows", .invalidPartition(rows: 0, columns: 4)),
        ]
        for (key, expected) in cases {
            let rectangle = try JSONDecoder().decode(FractionRectangle.self, from: invalidEntry(key))
            XCTAssertEqual(FractionBoardRules.validate(rectangle), expected, "夹具 \(key) 必须以约定原因拒绝")
        }
        // 非法 owner 连 decode 都不能通过（owner 只有 child/agent 两种合法值）
        XCTAssertThrowsError(try JSONDecoder().decode(FractionRectangle.self, from: invalidEntry("illegalOwner")))
    }

    func testFixtureInvalidBoardsRejected() throws {
        let tooMany = try JSONDecoder().decode(FractionBoard.self, from: invalidEntry("tooManyChildRectangles"))
        XCTAssertEqual(FractionBoardRules.validate(tooMany), .tooManyRectangles(owner: .child))
        let duplicated = try JSONDecoder().decode(FractionBoard.self, from: invalidEntry("duplicateRectangleIds"))
        XCTAssertEqual(FractionBoardRules.validate(duplicated), .duplicateRectangleId("dup"))
    }

    // MARK: - 同尺度与旋转安全

    func testSameWholeGroupSharesOneScaleAndCellsAreEqualArea() throws {
        let fixture = try JSONDecoder().decode(FixtureFile.self, from: fixtureData())
        let group = fixture.rectangles.filter { $0.wholeGroupId == "whole-1" }
        XCTAssertEqual(group.count, 2)
        let frames = FractionBoardLayout.frames(for: group, in: CGSize(width: 768, height: 512))
        let first = try XCTUnwrap(frames[group[0].id])
        let second = try XCTUnwrap(frames[group[1].id])
        XCTAssertEqual(first.size, second.size, "同一 wholeGroupId 的整体必须同尺度")
        // 每个矩形内部所有格子等面积
        for rectangle in group {
            let whole = try XCTUnwrap(frames[rectangle.id])
            var areas = Set<Int>()
            for cell in 0..<(rectangle.rows * rectangle.columns) {
                let cellFrame = FractionBoardLayout.cellFrame(index: cell, rows: rectangle.rows, columns: rectangle.columns, in: whole)
                areas.insert(Int((cellFrame.width * cellFrame.height * 1000).rounded()))
            }
            XCTAssertEqual(areas.count, 1, "矩形 \(rectangle.id) 内每格面积必须相等")
        }
    }

    func testRotationDoesNotChangeMathValues() throws {
        var state = FractionBoardState()
        _ = state.addRectangle(makeChildRect("r1", rows: 3, columns: 4, shaded: [0, 5, 11]))
        let before = state.board
        let portrait = FractionBoardLayout.frames(for: before.rectangles, in: CGSize(width: 768, height: 1024))
        let landscape = FractionBoardLayout.frames(for: before.rectangles, in: CGSize(width: 1024, height: 768))
        XCTAssertEqual(state.board, before, "布局计算是纯函数，不得改变任何数学值")
        XCTAssertEqual(state.boardRevision, before.revision)
        // 旋转只改变像素帧；每个格子的相对位置（行/列占比）不变
        let rect = before.rectangles[0]
        for cell in [0, 5, 11] {
            let row = cell / rect.columns, column = cell % rect.columns
            for frames in [portrait, landscape] {
                let whole = try XCTUnwrap(frames[rect.id])
                let cellFrame = FractionBoardLayout.cellFrame(index: cell, rows: rect.rows, columns: rect.columns, in: whole)
                XCTAssertEqual((cellFrame.midX - whole.minX) / whole.width, (CGFloat(column) + 0.5) / CGFloat(rect.columns), accuracy: 0.001)
                XCTAssertEqual((cellFrame.midY - whole.minY) / whole.height, (CGFloat(row) + 0.5) / CGFloat(rect.rows), accuracy: 0.001)
            }
        }
    }

    // MARK: - 孩子操作：涂色、分割、清空

    func testToggleCellShadesAndUnshadesWithRevisionBump() throws {
        var state = FractionBoardState()
        XCTAssertEqual(state.addRectangle(makeChildRect("r1")), .success(.applied))
        let revision = state.boardRevision
        XCTAssertEqual(state.toggleCell(rectangleId: "r1", cell: 2), .success(.applied))
        XCTAssertEqual(state.board.rectangles[0].shadedCells, [2])
        XCTAssertEqual(state.boardRevision, revision + 1)
        XCTAssertEqual(state.toggleCell(rectangleId: "r1", cell: 2), .success(.applied))
        XCTAssertEqual(state.board.rectangles[0].shadedCells, [])
        XCTAssertEqual(state.boardRevision, revision + 2)
    }

    func testToggleRejectsOutOfRangeUnknownAndAgentRectangles() throws {
        var state = FractionBoardState()
        _ = state.addRectangle(makeChildRect("r1"))
        _ = state.applyAgentAction(AgentBoardAction(actionId: "a1", type: "showHintRectangle", objectId: nil, cells: nil,
                                                    rectangle: FractionRectangle(id: "hint-1", wholeGroupId: "w", rows: 1, columns: 2, shadedCells: [0], owner: .agent)))
        let snapshot = state
        XCTAssertEqual(state.toggleCell(rectangleId: "r1", cell: 4), .failure(.cellOutOfRange(cell: 4, cellCount: 4)))
        XCTAssertEqual(state.toggleCell(rectangleId: "r1", cell: -1), .failure(.cellOutOfRange(cell: -1, cellCount: 4)))
        XCTAssertEqual(state.toggleCell(rectangleId: "missing", cell: 0), .failure(.unknownRectangle("missing")))
        XCTAssertEqual(state.toggleCell(rectangleId: "hint-1", cell: 0), .failure(.forbiddenOwner(expected: .child, actual: .agent)))
        XCTAssertEqual(state, snapshot, "被拒绝的指令不得改变任何状态")
    }

    func testPartitionChangeClearsShadingExplicitly() throws {
        var state = FractionBoardState()
        _ = state.addRectangle(makeChildRect("r1", rows: 2, columns: 2, shaded: [0, 3]))
        XCTAssertEqual(state.setPartition(rectangleId: "r1", rows: 3, columns: 4), .success(.partitionChanged(clearedShadedCells: 2)))
        XCTAssertEqual(state.board.rectangles[0].rows, 3)
        XCTAssertEqual(state.board.rectangles[0].columns, 4)
        XCTAssertEqual(state.board.rectangles[0].shadedCells, [], "改变分割必须清空涂色，不得按旧索引偷偷迁移")
    }

    func testInvalidPartitionRejectedAndShadingPreserved() throws {
        var state = FractionBoardState()
        _ = state.addRectangle(makeChildRect("r1", rows: 2, columns: 2, shaded: [1]))
        let snapshot = state
        XCTAssertEqual(state.setPartition(rectangleId: "r1", rows: 8, columns: 8), .failure(.tooManyCells(rows: 8, columns: 8)))
        XCTAssertEqual(state.setPartition(rectangleId: "r1", rows: 0, columns: 4), .failure(.invalidPartition(rows: 0, columns: 4)))
        XCTAssertEqual(state.setPartition(rectangleId: "missing", rows: 2, columns: 3), .failure(.unknownRectangle("missing")))
        XCTAssertEqual(state, snapshot)
    }

    func testClearRectangleOnlyAffectsThatRectangle() throws {
        var state = FractionBoardState()
        _ = state.addRectangle(makeChildRect("r1", whole: "w1", shaded: [0, 1]))
        _ = state.addRectangle(makeChildRect("r2", whole: "w2", shaded: [2, 3]))
        XCTAssertEqual(state.clearRectangle(rectangleId: "r1"), .success(.applied))
        XCTAssertEqual(state.board.rectangles.first { $0.id == "r1" }?.shadedCells, [])
        XCTAssertEqual(state.board.rectangles.first { $0.id == "r2" }?.shadedCells, [2, 3], "清空范围只限目标矩形")
    }

    func testChildRectangleLimitEnforced() throws {
        var state = FractionBoardState()
        for index in 1...4 {
            XCTAssertEqual(state.addRectangle(makeChildRect("c\(index)")), .success(.applied))
        }
        let snapshot = state
        XCTAssertEqual(state.addRectangle(makeChildRect("c5")), .failure(.tooManyRectangles(owner: .child)))
        XCTAssertEqual(state, snapshot)
    }

    // MARK: - AI 白名单动作

    func testAgentActionWhitelistRejectsUnknownAndChildWrites() throws {
        var state = FractionBoardState()
        _ = state.addRectangle(makeChildRect("r1", shaded: [1]))
        let snapshot = state
        // 未知动作
        XCTAssertEqual(state.applyAgentAction(AgentBoardAction(actionId: "x1", type: "eraseChildInk", objectId: nil, cells: nil, rectangle: nil)),
                       .failure(.unknownAction("eraseChildInk")))
        // AI 不得创建 child 对象
        XCTAssertEqual(state.applyAgentAction(AgentBoardAction(actionId: "x2", type: "showHintRectangle", objectId: nil, cells: nil, rectangle: makeChildRect("fake"))),
                       .failure(.forbiddenOwner(expected: .agent, actual: .child)))
        // 缺参数
        XCTAssertEqual(state.applyAgentAction(AgentBoardAction(actionId: "x3", type: "showHintRectangle", objectId: nil, cells: nil, rectangle: nil)),
                       .failure(.malformedAction("missingRectangle")))
        XCTAssertEqual(state.applyAgentAction(AgentBoardAction(actionId: "x4", type: "highlightCells", objectId: "r1", cells: nil, rectangle: nil)),
                       .failure(.malformedAction("missingCells")))
        // 高亮未知对象 / 越界格子 / 重复格子
        XCTAssertEqual(state.applyAgentAction(AgentBoardAction(actionId: "x5", type: "highlightCells", objectId: "ghost", cells: [0], rectangle: nil)),
                       .failure(.unknownRectangle("ghost")))
        XCTAssertEqual(state.applyAgentAction(AgentBoardAction(actionId: "x6", type: "highlightCells", objectId: "r1", cells: [9], rectangle: nil)),
                       .failure(.cellOutOfRange(cell: 9, cellCount: 4)))
        XCTAssertEqual(state.applyAgentAction(AgentBoardAction(actionId: "x7", type: "highlightCells", objectId: "r1", cells: [1, 1], rectangle: nil)),
                       .failure(.duplicateCell(1)))
        XCTAssertEqual(state, snapshot, "所有被拒绝的 AI 指令不得改变状态")
    }

    func testHighlightCellsDoesNotTouchChildRectangleBytes() throws {
        var state = FractionBoardState()
        _ = state.addRectangle(makeChildRect("r1", shaded: [1]))
        let childBytesBefore = try state.childLayerData()
        XCTAssertEqual(state.applyAgentAction(AgentBoardAction(actionId: "h1", type: "highlightCells", objectId: "r1", cells: [0, 3], rectangle: nil)),
                       .success(.applied))
        XCTAssertEqual(state.highlights["r1"], [0, 3])
        XCTAssertEqual(try state.childLayerData(), childBytesBefore, "高亮是独立呈现状态，不得写进孩子矩形")
    }

    func testAgentActionReplayIsIdempotent() throws {
        var state = FractionBoardState()
        let action = AgentBoardAction(actionId: "a1", type: "showHintRectangle", objectId: nil, cells: nil,
                                      rectangle: FractionRectangle(id: "hint-1", wholeGroupId: "w", rows: 1, columns: 2, shadedCells: [0], owner: .agent))
        XCTAssertEqual(state.applyAgentAction(action), .success(.applied))
        let afterFirst = state
        XCTAssertEqual(state.applyAgentAction(action), .success(.duplicateActionIgnored))
        XCTAssertEqual(state, afterFirst, "同一 actionId 重放只生效一次")
    }

    func testHideHintPreservesChildLayerBytes() throws {
        var state = FractionBoardState()
        _ = state.addRectangle(makeChildRect("r1", shaded: [0, 1]))
        _ = state.addRectangle(makeChildRect("r2", whole: "w2", rows: 3, columns: 4, shaded: [5]))
        _ = state.applyAgentAction(AgentBoardAction(actionId: "a1", type: "showHintRectangle", objectId: nil, cells: nil,
                                                    rectangle: FractionRectangle(id: "hint-1", wholeGroupId: "w3", rows: 1, columns: 2, shadedCells: [0], owner: .agent)))
        _ = state.applyAgentAction(AgentBoardAction(actionId: "a2", type: "highlightCells", objectId: "r1", cells: [2], rectangle: nil))
        XCTAssertFalse(state.hintsHidden)
        let childBytesBefore = try state.childLayerData()
        XCTAssertEqual(state.applyAgentAction(AgentBoardAction(actionId: "a3", type: "hideHint", objectId: nil, cells: nil, rectangle: nil)),
                       .success(.applied))
        XCTAssertTrue(state.hintsHidden)
        XCTAssertEqual(state.highlights, [:])
        XCTAssertEqual(try state.childLayerData(), childBytesBefore, "隐藏 AI 提示不得改变孩子层的任何字节")
        XCTAssertEqual(state.board.rectangles.filter { $0.owner == .child }.count, 2)
    }

    // MARK: - 合成证据预览

    @MainActor
    func testLearningSnapshotCombinesChildRectanglesAndInk() throws {
        let board = FractionBoard(revision: 7, rectangles: [makeChildRect("r1", rows: 2, columns: 2, shaded: [0])])
        let ink = makeInk()
        let inkBytesBefore = ink.dataRepresentation()
        let evidence = try XCTUnwrap(LearningSnapshot.encodeEvidence(board: board, ink: ink, size: CGSize(width: 1200, height: 900)))
        XCTAssertEqual(evidence.boardRevision, 7, "合成图与结构化状态必须使用同一 boardRevision")
        XCTAssertLessThanOrEqual(evidence.jpeg.count, 180_000, "复用 TutorSnapshot 的压缩边界")
        XCTAssertNotNil(UIImage(data: evidence.jpeg))
        let rendered = try XCTUnwrap(LearningSnapshot.evidenceImage(board: board, ink: ink, size: CGSize(width: 400, height: 300)))
        XCTAssertGreaterThan(nonWhitePixelCount(rendered), 100, "证据预览必须同时包含孩子矩形和孩子笔迹")
        // 压缩与合成都不得修改本地原始数据
        XCTAssertEqual(ink.dataRepresentation(), inkBytesBefore)
        XCTAssertEqual(board, FractionBoard(revision: 7, rectangles: [makeChildRect("r1", rows: 2, columns: 2, shaded: [0])]))
    }

    @MainActor
    func testLearningSnapshotNeverIncludesAgentHints() throws {
        let board = FractionBoard(revision: 2, rectangles: [
            FractionRectangle(id: "hint-1", wholeGroupId: "w", rows: 2, columns: 2, shadedCells: [0, 1, 2, 3], owner: .agent),
        ])
        let rendered = try XCTUnwrap(LearningSnapshot.evidenceImage(board: board, ink: PKDrawing(), size: CGSize(width: 400, height: 300)))
        XCTAssertEqual(nonWhitePixelCount(rendered), 0, "AI 提示层（即使可见）不得混入孩子独立作答证据")
    }
}
