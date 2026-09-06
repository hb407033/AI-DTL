// 语义对象层的数据模型。它与 PencilKit 笔迹层是两套数据：Agent 只能改这里，永远拿不到 PKDrawing 的写权限。
import CoreGraphics
import Foundation

/// 语义对象归属。阶段 0 只有 Agent 会放对象，但字段现在就定下来，免得正式版再改协议。
enum SemanticOwner: String, Codable {
    case agent
    case child
    case source
}

/// 阶段 0 唯一的语义对象：一个圆。坐标是画布内容坐标（阶段 0 不缩放不滚动，与视图坐标重合）。
struct SemanticCircle: Identifiable, Equatable {
    let id: String
    let owner: SemanticOwner
    let center: CGPoint
    let radius: CGFloat
}

/// 语义层场景。按 id 更新而不是追加，远端重发同一对象时不会越画越多。
struct SemanticScene: Equatable {
    private(set) var circles: [SemanticCircle] = []

    mutating func upsert(_ circle: SemanticCircle) {
        if let index = circles.firstIndex(where: { $0.id == circle.id }) {
            circles[index] = circle
        } else {
            circles.append(circle)
        }
    }

    mutating func replaceAll(_ newCircles: [SemanticCircle]) {
        circles = newCircles
    }

    mutating func clear() {
        circles.removeAll()
    }
}

// 手写 Codable：CGPoint 默认编成 [x, y] 数组，而协议约定 {"x":…,"y":…}，两端夹具以此为准。
extension SemanticCircle: Codable {
    private enum CodingKeys: String, CodingKey { case id, owner, center, radius }
    private enum PointKeys: String, CodingKey { case x, y }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        owner = try c.decode(SemanticOwner.self, forKey: .owner)
        let p = try c.nestedContainer(keyedBy: PointKeys.self, forKey: .center)
        center = CGPoint(x: try p.decode(CGFloat.self, forKey: .x), y: try p.decode(CGFloat.self, forKey: .y))
        radius = try c.decode(CGFloat.self, forKey: .radius)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(owner, forKey: .owner)
        var p = c.nestedContainer(keyedBy: PointKeys.self, forKey: .center)
        try p.encode(center.x, forKey: .x)
        try p.encode(center.y, forKey: .y)
        try c.encode(radius, forKey: .radius)
    }
}
