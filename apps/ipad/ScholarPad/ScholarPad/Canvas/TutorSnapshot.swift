import UIKit
import PencilKit

/// 为 256 KiB 云端消息上限保留 Base64 和 JSON 开销；不改变本地 PencilKit 原稿。
enum TutorSnapshot {
    /// 本地原照：正规化方向并去除元数据，存成 ≤2MB 的 JPEG；不复用模型缩略图。
    /// 先只降质量保留原像素；夜里灯光暗、照片噪点多时 12MP 原图降到最低质量仍超 2MB
    /// （2026-10-25 真机连续“照片没有保存成功”），再逐级缩小长边，题目文字仍清楚。
    static func originalPhoto(_ image: UIImage) -> Data? {
        guard image.size.width > 0, image.size.height > 0 else { return nil }
        let pixel = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        var rendered: [CGFloat: UIImage] = [:]
        for step in originalPhotoSteps {
            let scale = step.maxEdge.map { min(1, $0 / max(pixel.width, pixel.height)) } ?? 1
            let key = (scale * 10_000).rounded()
            let normalized = rendered[key] ?? {
                let size = CGSize(width: (pixel.width * scale).rounded(), height: (pixel.height * scale).rounded())
                let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
                return UIGraphicsImageRenderer(size: size, format: format).image { context in
                    UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
                    image.draw(in: CGRect(origin: .zero, size: size))
                }
            }()
            rendered[key] = normalized
            if let data = normalized.jpegData(compressionQuality: step.quality), data.count <= 2 * 1024 * 1024 { return data }
        }
        return nil
    }

    /// 依次尝试的（长边上限，JPEG 质量）；maxEdge 为 nil 表示保留原像素。第一个 ≤2MB 的就用。
    static let originalPhotoSteps: [(maxEdge: CGFloat?, quality: CGFloat)] = [
        // 白天清楚的照片在原像素就能存下；暗光噪点多时先缩小长边（比降质量有效），质量不低于 0.6，免得手写数字糊边。
        (nil, 0.95), (nil, 0.85), (nil, 0.7),
        (3000, 0.75), (2400, 0.75), (2000, 0.7), (1600, 0.65),
    ]
    static func workspaceImage(drawing: PKDrawing, statement: String, board: FractionBoard? = nil, sourcePhoto: UIImage? = nil, photoFocus: PhotoFocus.Focus? = nil, teacherHint: String? = nil) -> UIImage {
        let rectangles = (board?.rectangles ?? []).filter { $0.owner == .child && FractionBoardRules.validate($0) == nil }
        // 没有笔迹时只留一小块空白，不再用 600 高的白纸挤占整页照片和放大区。
        let bounds = drawing.bounds.isEmpty ? CGRect(x: 0, y: 0, width: 800, height: 120) : drawing.bounds.insetBy(dx: -24, dy: -24)
        let scale = min(1, 1280 / max(bounds.width, bounds.height))
        let inkSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        let width = max(800, inkSize.width)
        let source = sourcePhoto.flatMap { $0.size.width > 0 && $0.size.height > 0 ? $0 : nil }
        let focus = source.flatMap { photo in photoFocus.map { $0.rect.intersection(CGRect(origin: .zero, size: photo.size)) } }
            .flatMap { $0.isNull || $0.width < 8 || $0.height < 8 ? nil : $0 }
        // 整页照按可用宽度放大（原来塞进 320 高，手写数字只有几像素）；有放大区时整页矮一些，给放大区留出总尺寸。
        let photoScale = source.map { min((width - 32) / $0.size.width, (focus == nil ? 960 : 720) / $0.size.height) } ?? 0
        let photoSize = source.map { CGSize(width: $0.size.width * photoScale, height: $0.size.height * photoScale) } ?? .zero
        let focusScale = focus.map { min((width - 32) / $0.width, 300 / $0.height) } ?? 0
        let focusSize = focus.map { CGSize(width: $0.width * focusScale, height: $0.height * focusScale) } ?? .zero
        let written = focus == nil ? nil : photoFocus?.written
        let focusTop = 216 + photoSize.height + 16
        let sourceHeight: CGFloat = source == nil ? 0 : 36 + photoSize.height + 16 + (focus == nil ? 0 : 36 + focusSize.height + 16 + (written == nil ? 0 : 36)) + 36
        let inkTop = 180 + sourceHeight
        let childBottom = inkSize.height + inkTop + CGFloat(rectangles.count) * 220
        let size = CGSize(width: width, height: childBottom + (teacherHint == nil ? 0 : 200))
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        // PencilKit 会随当前 trait 调整墨色。画布固定白纸，导出也必须固定浅色，
        // 否则深色 App 中黑笔会被渲染为白笔，模型收到有题干却没有笔迹的图。
        var inkImage: UIImage!
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
            inkImage = drawing.image(from: bounds, scale: scale)
        }
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
            ("已确认的问题：\(statement)\(source == nil ? "\n下面是我的想法：" : "")" as NSString).draw(
                in: CGRect(x: 16, y: 12, width: width - 32, height: 160),
                withAttributes: [.font: UIFont.systemFont(ofSize: 25), .foregroundColor: UIColor.black])
            if let source {
                ("观察对象／原始照片（不是我的解法）" as NSString).draw(at: CGPoint(x: 16, y: 180),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 22), .foregroundColor: UIColor.black])
                source.draw(in: CGRect(x: (width - photoSize.width) / 2, y: 216, width: photoSize.width, height: photoSize.height))
                if let focus, let cropped = source.cgImageCropped(to: focus) {
                    ("照片里这道题的放大（含卷子上原来写的字）" as NSString).draw(at: CGPoint(x: 16, y: focusTop),
                        withAttributes: [.font: UIFont.systemFont(ofSize: 22), .foregroundColor: UIColor.black])
                    UIImage(cgImage: cropped).draw(in: CGRect(x: (width - focusSize.width) / 2, y: focusTop + 36, width: focusSize.width, height: focusSize.height))
                    if let written {
                        ("本机识别等号右边写的是“\(written)”（可能认错，以照片为准）" as NSString).draw(at: CGPoint(x: 16, y: focusTop + 36 + focusSize.height + 8),
                            withAttributes: [.font: UIFont.systemFont(ofSize: 22), .foregroundColor: UIColor.black])
                    }
                }
                ("下面才是我的想法／笔迹：" as NSString).draw(at: CGPoint(x: 16, y: inkTop - 36),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 22), .foregroundColor: UIColor.black])
            }
            inkImage.draw(in: CGRect(x: 0, y: inkTop, width: inkSize.width, height: inkSize.height))
            for (index, rectangle) in rectangles.enumerated() {
                let top = inkTop + inkSize.height + CGFloat(index) * 220
                ("我的等分图 \(index + 1)（每个外框表示一个整体，含义由我说明）" as NSString).draw(
                    at: CGPoint(x: 16, y: top + 8), withAttributes: [.font: UIFont.systemFont(ofSize: 20), .foregroundColor: UIColor.black])
                let whole = CGRect(x: 24, y: top + 44, width: width - 48, height: 150)
                for cell in 0..<rectangle.cellCount {
                    let frame = FractionBoardLayout.cellFrame(index: cell, rows: rectangle.rows, columns: rectangle.columns, in: whole)
                    if rectangle.shadedCells.contains(cell) { UIColor.systemBlue.withAlphaComponent(0.4).setFill(); context.fill(frame) }
                    UIColor.black.setStroke(); context.cgContext.stroke(frame)
                }
            }
            if let teacherHint {
                ("老师的辅助提示记录（不是孩子独立画出的图）：\n\(teacherHint)" as NSString).draw(
                    in: CGRect(x: 16, y: childBottom + 12, width: width - 32, height: 180),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 22), .foregroundColor: UIColor.black])
            }
        }
    }
    static func encode(_ image: UIImage, maxBytes: Int = 180_000) -> Data? {
        guard maxBytes > 0, image.size.width > 0, image.size.height > 0 else { return nil }
        for edge in [1280.0, 960.0, 640.0, 384.0] {
            let scale = min(1, edge / max(image.size.width, image.size.height))
            let size = CGSize(width: max(32, image.size.width * scale), height: max(32, image.size.height * scale))
            let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
            let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
                UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
                image.draw(in: CGRect(origin: .zero, size: size))
            }
            for quality in [0.8, 0.6, 0.4] {
                if let data = rendered.jpegData(compressionQuality: quality), data.count <= maxBytes { return data }
            }
        }
        return nil
    }
}

private extension UIImage {
    /// 按照片坐标裁剪；先按方向摆正成位图，裁剪框才和显示方向一致。
    func cgImageCropped(to rect: CGRect) -> CGImage? {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        let crop = rect.integral
        return UIGraphicsImageRenderer(size: crop.size, format: format).image { _ in
            draw(at: CGPoint(x: -crop.minX, y: -crop.minY))
        }.cgImage
    }
}
