// 合成证据预览（工作包 B）：把孩子矩形与孩子笔迹画进同一张图，与结构化状态共用同一 boardRevision。
// PKDrawing.image 只有笔迹、不含分数矩形层，所以这里显式合成而不是把它当完整画布截图。
// 证据只含 child 层：AI 提示无论是否隐藏都不进入孩子独立作答证据。
// 压缩复用 TutorSnapshot 的上传边界，只产出缩小的副本，不修改本地原始图形或笔迹。
import PencilKit
import UIKit

struct LearningEvidence: Equatable, Sendable {
    var boardRevision: Int
    var jpeg: Data
}

enum LearningSnapshot {
    static func evidenceImage(board: FractionBoard, ink: PKDrawing, size: CGSize) -> UIImage? {
        guard size.width > 0, size.height > 0 else { return nil }
        let childRectangles = board.rectangles.filter { $0.owner == .child }
        let frames = FractionBoardLayout.frames(for: childRectangles, in: size)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            for rectangle in childRectangles {
                guard let whole = frames[rectangle.id] else { continue }
                UIColor.black.setStroke()
                for cell in 0..<rectangle.cellCount {
                    let cellRect = FractionBoardLayout.cellFrame(index: cell, rows: rectangle.rows, columns: rectangle.columns, in: whole)
                    if rectangle.shadedCells.contains(cell) {
                        UIColor.systemBlue.withAlphaComponent(0.45).setFill()
                        context.fill(cellRect)
                    }
                    context.cgContext.stroke(cellRect, width: 1)
                }
                context.cgContext.stroke(whole, width: 2)
            }
            ink.image(from: CGRect(origin: .zero, size: size), scale: 1)
                .draw(in: CGRect(origin: .zero, size: size))
        }
    }

    static func encodeEvidence(board: FractionBoard, ink: PKDrawing, size: CGSize, maxBytes: Int = 180_000) -> LearningEvidence? {
        guard let image = evidenceImage(board: board, ink: ink, size: size),
              let jpeg = TutorSnapshot.encode(image, maxBytes: maxBytes) else { return nil }
        return LearningEvidence(boardRevision: board.revision, jpeg: jpeg)
    }
}
