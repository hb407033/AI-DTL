// Agent 语义层：只读、不接收触摸，叠在孩子笔迹层之上。按对象 kind 画数学插件声明的几种表示；
// 不认识的 kind 画一个虚线框写名字，绝不静默吞掉。对象竖排在画布右侧，位置由儿童端决定，宿主不下发坐标。
import SwiftUI

struct AgentLayerView: View {
    let objects: [SemanticObject]
    let highlightedIds: Set<String>
    let pointer: Point?

    private let slotHeight: CGFloat = 130
    private let inset: CGFloat = 16

    var body: some View {
        Canvas { context, size in
            let columnWidth = size.width * 0.3
            let originX = size.width - columnWidth - inset
            for (index, object) in objects.enumerated() {
                let slot = CGRect(x: originX, y: inset + CGFloat(index) * (slotHeight + 12), width: columnWidth, height: slotHeight)
                draw(object, in: slot, context: &context)
                if highlightedIds.contains(object.id) {
                    context.stroke(Path(roundedRect: slot.insetBy(dx: -6, dy: -6), cornerRadius: 12), with: .color(.yellow), lineWidth: 4)
                }
            }
            if let pointer {
                let dot = CGRect(x: pointer.x - 8, y: pointer.y - 8, width: 16, height: 16)
                context.fill(Path(ellipseIn: dot), with: .color(.orange))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func draw(_ object: SemanticObject, in slot: CGRect, context: inout GraphicsContext) {
        switch object.kind {
        case "tenthsBar":
            let segments = Int(object.number("segments") ?? 10)
            let filled = Int(object.number("filled") ?? 0)
            let bar = CGRect(x: slot.minX, y: slot.midY - 20, width: slot.width, height: 40)
            let cell = bar.width / CGFloat(max(segments, 1))
            for i in 0..<segments {
                let rect = CGRect(x: bar.minX + CGFloat(i) * cell, y: bar.minY, width: cell, height: bar.height)
                if i < filled { context.fill(Path(rect), with: .color(.blue.opacity(0.5))) }
                context.stroke(Path(rect), with: .color(.blue), lineWidth: 2)
            }
        case "numberLine":
            let maxValue = object.number("max") ?? 3
            let y = slot.midY
            context.stroke(Path { p in p.move(to: CGPoint(x: slot.minX, y: y)); p.addLine(to: CGPoint(x: slot.maxX, y: y)) }, with: .color(.blue), lineWidth: 2)
            let ticks = Int(maxValue)
            for i in 0...max(ticks, 1) {
                let x = slot.minX + slot.width * CGFloat(i) / CGFloat(max(ticks, 1))
                context.stroke(Path { p in p.move(to: CGPoint(x: x, y: y - 8)); p.addLine(to: CGPoint(x: x, y: y + 8)) }, with: .color(.blue), lineWidth: 2)
                context.draw(Text("\(i)").font(.caption), at: CGPoint(x: x, y: y + 20))
            }
        case "label":
            context.draw(Text(object.string("text") ?? "").font(.title3), at: CGPoint(x: slot.midX, y: slot.midY))
        case "arrow":
            let start = CGPoint(x: slot.minX, y: slot.midY)
            let end = CGPoint(x: slot.maxX, y: slot.midY)
            context.stroke(Path { p in
                p.move(to: start); p.addLine(to: end)
                p.move(to: CGPoint(x: end.x - 14, y: end.y - 10)); p.addLine(to: end); p.addLine(to: CGPoint(x: end.x - 14, y: end.y + 10))
            }, with: .color(.blue), lineWidth: 3)
        case "highlight":
            context.fill(Path(roundedRect: slot, cornerRadius: 8), with: .color(.yellow.opacity(0.35)))
        case "areaModel":
            let a = max(object.number("a") ?? 1, 1)
            let b = max(object.number("b") ?? 1, 0.1)
            // 长 a、宽 b 的面积模型：b 是十分之几就画几格深色
            let rect = CGRect(x: slot.minX, y: slot.minY + 10, width: slot.width, height: slot.height - 20)
            let rows = Int(a.rounded(.up))
            let rowHeight = rect.height / CGFloat(rows)
            let filledCols = Int((b * 10).rounded())
            for r in 0..<rows {
                for c in 0..<10 {
                    let cell = CGRect(x: rect.minX + rect.width * CGFloat(c) / 10, y: rect.minY + CGFloat(r) * rowHeight, width: rect.width / 10, height: rowHeight)
                    if c < filledCols { context.fill(Path(cell), with: .color(.green.opacity(0.4))) }
                    context.stroke(Path(cell), with: .color(.green), lineWidth: 1)
                }
            }
        default:
            context.stroke(Path(roundedRect: slot, cornerRadius: 8), with: .color(.gray), style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
            context.draw(Text(object.kind).font(.caption).foregroundStyle(.gray), at: CGPoint(x: slot.midX, y: slot.midY))
        }
    }
}
