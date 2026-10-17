// 受控分数画布的纯值类型状态（工作包 B）。字段形状与公共契约
// packages/session-contracts/src/fraction-learning.ts 一一对应：id, wholeGroupId, rows, columns,
// shadedCells, owner（child/agent），格子索引从 0 开始行优先，rows*columns ≤ 60，每层每 owner ≤ 4 个矩形。
// 状态只存数学结构，不存任何屏幕坐标；像素帧由 FractionBoardLayout 在渲染时按可用空间现算。
import Foundation

enum FractionOwner: String, Codable, Sendable {
    case child
    case agent
}

struct FractionRectangle: Codable, Equatable, Sendable {
    var id: String
    var wholeGroupId: String
    var rows: Int
    var columns: Int
    var shadedCells: [Int]
    var owner: FractionOwner

    var cellCount: Int { rows * columns }
}

struct FractionBoard: Codable, Equatable, Sendable {
    var revision: Int
    var rectangles: [FractionRectangle]
}

/// 所有拒绝都带明确原因，绝不把非法指令纠正成另一个数学表达。
enum FractionRejection: Error, Equatable, Sendable {
    case emptyIdentifier
    case invalidPartition(rows: Int, columns: Int)
    case tooManyCells(rows: Int, columns: Int)
    case duplicateCell(Int)
    case cellOutOfRange(cell: Int, cellCount: Int)
    case duplicateRectangleId(String)
    case tooManyRectangles(owner: FractionOwner)
    case unknownRectangle(String)
    case forbiddenOwner(expected: FractionOwner, actual: FractionOwner)
    case unknownAction(String)
    case malformedAction(String)
}

enum FractionBoardEffect: Equatable, Sendable {
    case applied
    /// 分割已变更；涂色语义随行列数改变，涂色被显式清空（不清空就得重新确认，这里选择清空）。
    case partitionChanged(clearedShadedCells: Int)
    /// 同一 actionId 重放：只生效一次，后续到达按重复处理且不改状态。
    case duplicateActionIgnored
}

enum FractionBoardRules {
    static let maxCells = 60
    static let maxRectanglesPerOwner = 4

    static func validate(_ rectangle: FractionRectangle) -> FractionRejection? {
        if rectangle.id.isEmpty || rectangle.wholeGroupId.isEmpty { return .emptyIdentifier }
        if rectangle.rows < 1 || rectangle.columns < 1 {
            return .invalidPartition(rows: rectangle.rows, columns: rectangle.columns)
        }
        if rectangle.cellCount > maxCells {
            return .tooManyCells(rows: rectangle.rows, columns: rectangle.columns)
        }
        var seen = Set<Int>()
        for cell in rectangle.shadedCells {
            if !seen.insert(cell).inserted { return .duplicateCell(cell) }
            if cell < 0 || cell >= rectangle.cellCount {
                return .cellOutOfRange(cell: cell, cellCount: rectangle.cellCount)
            }
        }
        return nil
    }

    static func validate(_ board: FractionBoard) -> FractionRejection? {
        var ids = Set<String>()
        var counts: [FractionOwner: Int] = [:]
        for rectangle in board.rectangles {
            if let rejection = validate(rectangle) { return rejection }
            if !ids.insert(rectangle.id).inserted { return .duplicateRectangleId(rectangle.id) }
            counts[rectangle.owner, default: 0] += 1
            if counts[rectangle.owner, default: 0] > maxRectanglesPerOwner {
                return .tooManyRectangles(owner: rectangle.owner)
            }
        }
        return nil
    }
}

/// AI 白名单动作的有线形状：actionId 幂等键 + type ∈ {showHintRectangle, highlightCells, hideHint}。
/// 只引用对象 ID 和格子索引，不含屏幕像素。未知 type 或非法 JSON 一律拒绝。
struct AgentBoardAction: Codable, Equatable, Sendable {
    var actionId: String
    var type: String
    var objectId: String?
    var cells: [Int]?
    var rectangle: FractionRectangle?
}

struct FractionBoardState: Equatable, Sendable {
    private(set) var board: FractionBoard
    /// 高亮是 AI 的呈现强调，存放在矩形模型之外，永不写进孩子矩形的字节。
    private(set) var highlights: [String: [Int]] = [:]
    private(set) var hintsHidden = false
    private var appliedActionIds: Set<String> = []

    init(board: FractionBoard = FractionBoard(revision: 0, rectangles: []),
         hintsHidden: Bool = false, highlights: [String: [Int]] = [:]) {
        self.board = board
        self.hintsHidden = hintsHidden
        self.highlights = highlights
    }

    var boardRevision: Int { board.revision }

    /// 孩子层的确定性编码（只含 child 矩形）。用于证明隐藏提示、高亮等 AI 侧状态不改变孩子层字节。
    func childLayerData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(board.rectangles.filter { $0.owner == .child })
    }

    // MARK: - 孩子操作（只许动 child 对象）

    mutating func addRectangle(_ rectangle: FractionRectangle) -> Result<FractionBoardEffect, FractionRejection> {
        guard rectangle.owner == .child else {
            return .failure(.forbiddenOwner(expected: .child, actual: rectangle.owner))
        }
        if let rejection = FractionBoardRules.validate(rectangle) { return .failure(rejection) }
        var next = board
        next.rectangles.append(rectangle)
        if let rejection = FractionBoardRules.validate(next) { return .failure(rejection) }
        next.revision += 1
        board = next
        return .success(.applied)
    }

    mutating func toggleCell(rectangleId: String, cell: Int) -> Result<FractionBoardEffect, FractionRejection> {
        guard let index = editableChildIndex(rectangleId) else {
            return .failure(childLookupFailure(rectangleId))
        }
        guard cell >= 0, cell < board.rectangles[index].cellCount else {
            return .failure(.cellOutOfRange(cell: cell, cellCount: board.rectangles[index].cellCount))
        }
        if let existing = board.rectangles[index].shadedCells.firstIndex(of: cell) {
            board.rectangles[index].shadedCells.remove(at: existing)
        } else {
            board.rectangles[index].shadedCells.append(cell)
        }
        board.revision += 1
        return .success(.applied)
    }

    mutating func setPartition(rectangleId: String, rows: Int, columns: Int) -> Result<FractionBoardEffect, FractionRejection> {
        guard let index = editableChildIndex(rectangleId) else {
            return .failure(childLookupFailure(rectangleId))
        }
        guard rows >= 1, columns >= 1 else { return .failure(.invalidPartition(rows: rows, columns: columns)) }
        guard rows * columns <= FractionBoardRules.maxCells else { return .failure(.tooManyCells(rows: rows, columns: columns)) }
        let current = board.rectangles[index]
        if current.rows == rows, current.columns == columns { return .success(.applied) }
        let cleared = current.shadedCells.count
        board.rectangles[index].rows = rows
        board.rectangles[index].columns = columns
        board.rectangles[index].shadedCells = []
        board.revision += 1
        return .success(.partitionChanged(clearedShadedCells: cleared))
    }

    /// 清空只影响目标矩形的涂色，行列数与其他矩形不动。
    mutating func clearRectangle(rectangleId: String) -> Result<FractionBoardEffect, FractionRejection> {
        guard let index = editableChildIndex(rectangleId) else {
            return .failure(childLookupFailure(rectangleId))
        }
        guard !board.rectangles[index].shadedCells.isEmpty else { return .success(.applied) }
        board.rectangles[index].shadedCells = []
        board.revision += 1
        return .success(.applied)
    }

    mutating func removeRectangle(rectangleId: String) -> Result<FractionBoardEffect, FractionRejection> {
        guard let index = editableChildIndex(rectangleId) else {
            return .failure(childLookupFailure(rectangleId))
        }
        board.rectangles.remove(at: index)
        highlights.removeValue(forKey: rectangleId)
        board.revision += 1
        return .success(.applied)
    }

    // MARK: - AI 白名单动作

    mutating func applyAgentActionJSON(_ data: Data) -> Result<FractionBoardEffect, FractionRejection> {
        guard let action = try? JSONDecoder().decode(AgentBoardAction.self, from: data) else {
            return .failure(.malformedAction("undecodable"))
        }
        return applyAgentAction(action)
    }

    mutating func applyAgentAction(_ action: AgentBoardAction) -> Result<FractionBoardEffect, FractionRejection> {
        guard !action.actionId.isEmpty else { return .failure(.malformedAction("emptyActionId")) }
        guard !appliedActionIds.contains(action.actionId) else { return .success(.duplicateActionIgnored) }
        let effect: Result<FractionBoardEffect, FractionRejection>
        switch action.type {
        case "showHintRectangle":
            effect = applyShowHintRectangle(action)
        case "highlightCells":
            effect = applyHighlightCells(action)
        case "hideHint":
            hintsHidden = true
            highlights = [:]
            effect = .success(.applied)
        default:
            return .failure(.unknownAction(action.type))
        }
        if case .success = effect {
            appliedActionIds.insert(action.actionId)
            board.revision += 1
        }
        return effect
    }

    private mutating func applyShowHintRectangle(_ action: AgentBoardAction) -> Result<FractionBoardEffect, FractionRejection> {
        guard let rectangle = action.rectangle else { return .failure(.malformedAction("missingRectangle")) }
        guard rectangle.owner == .agent else {
            return .failure(.forbiddenOwner(expected: .agent, actual: rectangle.owner))
        }
        if let rejection = FractionBoardRules.validate(rectangle) { return .failure(rejection) }
        var next = board
        next.rectangles.append(rectangle)
        if let rejection = FractionBoardRules.validate(next) { return .failure(rejection) }
        board = next
        hintsHidden = false
        return .success(.applied)
    }

    private mutating func applyHighlightCells(_ action: AgentBoardAction) -> Result<FractionBoardEffect, FractionRejection> {
        guard let objectId = action.objectId, !objectId.isEmpty else { return .failure(.malformedAction("missingObjectId")) }
        guard let cells = action.cells, !cells.isEmpty else { return .failure(.malformedAction("missingCells")) }
        guard let rectangle = board.rectangles.first(where: { $0.id == objectId }) else {
            return .failure(.unknownRectangle(objectId))
        }
        var seen = Set<Int>()
        for cell in cells {
            if !seen.insert(cell).inserted { return .failure(.duplicateCell(cell)) }
            if cell < 0 || cell >= rectangle.cellCount {
                return .failure(.cellOutOfRange(cell: cell, cellCount: rectangle.cellCount))
            }
        }
        highlights[objectId] = cells.sorted()
        hintsHidden = false
        return .success(.applied)
    }

    // MARK: - 内部

    private func editableChildIndex(_ rectangleId: String) -> Int? {
        guard let index = board.rectangles.firstIndex(where: { $0.id == rectangleId }) else { return nil }
        return board.rectangles[index].owner == .child ? index : nil
    }

    private func childLookupFailure(_ rectangleId: String) -> FractionRejection {
        guard let rectangle = board.rectangles.first(where: { $0.id == rectangleId }) else {
            return .unknownRectangle(rectangleId)
        }
        return .forbiddenOwner(expected: .child, actual: rectangle.owner)
    }
}
