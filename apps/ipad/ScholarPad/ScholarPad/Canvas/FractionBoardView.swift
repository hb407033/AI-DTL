// 受控分数画布的 SwiftUI 渲染（工作包 B）。同一 wholeGroupId 的所有矩形共用同一整体边长，
// 网格等分保证每格面积相等；布局是可用空间的纯函数，不写回状态，横竖屏旋转不改变任何数学值。
// 孩子矩形有明确命中区域（仅矩形自身的 frame 响应点击）；AI 提示层只读且 allowsHitTesting(false)，
// 分数图之外的区域不拦截触摸，PencilKit 书写层照常接收笔画。
import SwiftUI

enum FractionBoardLayout {
    static let spacing: CGFloat = 16

    /// 按 wholeGroupId 分组：组间竖排，组内矩形横排；同组整体同边长（正方形“纸”）。
    /// 返回每个矩形在 size 内的整体像素帧；纯函数，不产生或保存任何坐标状态。
    static func frames(for rectangles: [FractionRectangle], in size: CGSize) -> [String: CGRect] {
        var order: [String] = []
        var groups: [String: [FractionRectangle]] = [:]
        for rectangle in rectangles {
            if groups[rectangle.wholeGroupId] == nil { order.append(rectangle.wholeGroupId) }
            groups[rectangle.wholeGroupId, default: []].append(rectangle)
        }
        guard !order.isEmpty, size.width > 0, size.height > 0 else { return [:] }
        let bandHeight = (size.height - spacing * CGFloat(order.count + 1)) / CGFloat(order.count)
        var frames: [String: CGRect] = [:]
        var bandTop = spacing
        for groupId in order {
            let members = groups[groupId] ?? []
            let count = CGFloat(max(members.count, 1))
            let side = max(0, min((size.width - spacing * (count + 1)) / count, bandHeight))
            let rowWidth = side * count + spacing * (count - 1)
            var x = max(spacing, (size.width - rowWidth) / 2)
            let y = bandTop + max(0, (bandHeight - side) / 2)
            for member in members {
                frames[member.id] = CGRect(x: x, y: y, width: side, height: side)
                x += side + spacing
            }
            bandTop += bandHeight + spacing
        }
        return frames
    }

    /// 格子索引从 0 开始行优先：row = index / columns, column = index % columns。
    static func cellFrame(index: Int, rows: Int, columns: Int, in whole: CGRect) -> CGRect {
        let row = index / columns
        let column = index % columns
        return CGRect(x: whole.minX + whole.width * CGFloat(column) / CGFloat(columns),
                      y: whole.minY + whole.height * CGFloat(row) / CGFloat(rows),
                      width: whole.width / CGFloat(columns),
                      height: whole.height / CGFloat(rows))
    }

    /// 命中测试：point 为矩形局部坐标（原点在矩形左上角）。
    static func cellIndex(at point: CGPoint, rows: Int, columns: Int, in size: CGSize) -> Int? {
        guard size.width > 0, size.height > 0,
              point.x >= 0, point.y >= 0, point.x < size.width, point.y < size.height else { return nil }
        let column = Int(point.x / size.width * CGFloat(columns))
        let row = Int(point.y / size.height * CGFloat(rows))
        guard (0..<columns).contains(column), (0..<rows).contains(row) else { return nil }
        return row * columns + column
    }
}

struct FractionRectangleView: View {
    let rectangle: FractionRectangle
    let frame: CGRect
    var highlightedCells: Set<Int> = []
    var isHint: Bool = false
    var onTapCell: ((Int) -> Void)? = nil

    var body: some View {
        Canvas { context, _ in
            let local = CGRect(origin: .zero, size: frame.size)
            let shade: Color = isHint ? .orange.opacity(0.35) : .blue.opacity(0.45)
            let line: Color = isHint ? .orange : .primary
            for cell in 0..<rectangle.cellCount {
                let cellRect = FractionBoardLayout.cellFrame(index: cell, rows: rectangle.rows, columns: rectangle.columns, in: local)
                if rectangle.shadedCells.contains(cell) {
                    context.fill(Path(cellRect), with: .color(shade))
                }
                context.stroke(Path(cellRect), with: .color(line.opacity(0.6)), lineWidth: 1)
                if highlightedCells.contains(cell) {
                    context.stroke(Path(cellRect.insetBy(dx: 2, dy: 2)), with: .color(.yellow), lineWidth: 4)
                }
            }
            context.stroke(Path(local), with: .color(line), style: StrokeStyle(lineWidth: 2, dash: isHint ? [8, 5] : []))
        }
        .frame(width: frame.width, height: frame.height)
        .position(x: frame.midX, y: frame.midY)
        .contentShape(Rectangle())
        .onTapGesture { location in
            guard !isHint, let onTapCell,
                  let cell = FractionBoardLayout.cellIndex(at: location, rows: rectangle.rows, columns: rectangle.columns, in: frame.size)
            else { return }
            onTapCell(cell)
        }
        .allowsHitTesting(!isHint && onTapCell != nil)
        .accessibilityIdentifier(isHint ? "fractionHint-\(rectangle.id)" : "fractionRect-\(rectangle.id)")
    }
}

/// 分数画板：孩子层可点涂，AI 提示层只读。本视图只画矩形自身的 frame，
/// 其余区域透明且不拦截触摸，叠在 PencilKit 画布上不会挡住书写。
struct FractionBoardView: View {
    let board: FractionBoard
    var highlights: [String: [Int]] = [:]
    var hintsHidden: Bool = false
    var onTapCell: (_ rectangleId: String, _ cell: Int) -> Void = { _, _ in }

    var body: some View {
        GeometryReader { geometry in
            let visible = board.rectangles.filter { $0.owner == .child || !hintsHidden }
            let frames = FractionBoardLayout.frames(for: visible, in: geometry.size)
            ZStack(alignment: .topLeading) {
                ForEach(visible, id: \.id) { rectangle in
                    if let frame = frames[rectangle.id] {
                        FractionRectangleView(
                            rectangle: rectangle,
                            frame: frame,
                            highlightedCells: Set(highlights[rectangle.id] ?? []),
                            isHint: rectangle.owner == .agent,
                            onTapCell: rectangle.owner == .agent ? nil : { cell in onTapCell(rectangle.id, cell) }
                        )
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("fractionBoard")
    }
}
