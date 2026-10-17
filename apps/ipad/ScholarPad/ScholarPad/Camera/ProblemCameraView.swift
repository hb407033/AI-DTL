import SwiftUI
import UIKit
import Vision

/// 只打开相机，不读取相册；照片回调只生成本机预览，不触发模型。
struct ProblemCameraView: UIViewControllerRepresentable {
    var onCapture: (UIImage) -> Void
    var onCancel: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: ProblemCameraView
        init(parent: ProblemCameraView) { self.parent = parent }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.onCancel() }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard let image = info[.originalImage] as? UIImage else { parent.onCancel(); return }
            parent.onCapture(image)
        }
    }
}

/// 平放俯拍作业时 iPad 判断不出哪边朝上，照片里的字常是横的或倒的，识别模型就读不出题。
/// 拍完后在本机用文字识别把四个方向各试一次，选认出汉字最多的方向摆正；不调用云端模型。
enum PhotoOrientation {
    /// 包装成可跨线程传递的值；只在一次摆正任务内使用，不共享修改。
    struct Image: @unchecked Sendable { let image: UIImage }

    static func upright(_ image: UIImage) -> UIImage {
        guard let original = rotated(image, quarterTurns: 0, maxEdge: 1024) else { return image }
        let originalScore = textScore(original)
        var best = (turns: 0, score: originalScore)
        for turns in 1...3 {
            guard let candidate = rotated(image, quarterTurns: turns, maxEdge: 1024) else { continue }
            let score = textScore(candidate)
            if score > best.score { best = (turns, score) }
        }
        // 只有明显更像正向文字才转，避免图形题、空白照片被误转。
        guard best.turns != 0, best.score >= 6, best.score > originalScore * 1.5 + 2 else { return image }
        return rotated(image, quarterTurns: best.turns, maxEdge: nil) ?? image
    }

    /// 顺时针转 quarterTurns 个 90°，并按原照方向元数据先摆正；maxEdge 为空时保留原像素尺寸。
    static func rotated(_ image: UIImage, quarterTurns: Int, maxEdge: CGFloat?) -> UIImage? {
        let pixel = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        guard pixel.width > 0, pixel.height > 0 else { return nil }
        let scale = maxEdge.map { min(1, $0 / max(pixel.width, pixel.height)) } ?? 1
        let drawn = CGSize(width: pixel.width * scale, height: pixel.height * scale)
        let turns = ((quarterTurns % 4) + 4) % 4
        let size = turns % 2 == 0 ? drawn : CGSize(width: drawn.height, height: drawn.width)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
            context.cgContext.translateBy(x: size.width / 2, y: size.height / 2)
            context.cgContext.rotate(by: CGFloat(turns) * .pi / 2)
            image.draw(in: CGRect(x: -drawn.width / 2, y: -drawn.height / 2, width: drawn.width, height: drawn.height))
        }
    }

    /// 认出的汉字和数字个数按置信度加权，只计“从左往右读”的文字行。
    /// Vision 能读出侧放和倒放的字，只看认出几个字分不出方向；但一行的首字在左、末字在右只在正向时成立。
    static func textScore(_ image: UIImage) -> Double {
        guard let cgImage = image.cgImage else { return 0 }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = false
        do { try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request]) } catch { return 0 }
        let width = CGFloat(cgImage.width), height = CGFloat(cgImage.height)
        return (request.results ?? []).reduce(0) { total, observation in
            guard let top = observation.topCandidates(1).first, top.string.count >= 2,
                  let first = try? top.boundingBox(for: top.string.startIndex..<top.string.index(after: top.string.startIndex)),
                  let last = try? top.boundingBox(for: top.string.index(before: top.string.endIndex)..<top.string.endIndex) else { return total }
            let dx = (last.boundingBox.midX - first.boundingBox.midX) * width
            let dy = (last.boundingBox.midY - first.boundingBox.midY) * height
            guard dx > 0, dx > abs(dy) else { return total }
            let counted = top.string.unicodeScalars.filter { (0x4E00...0x9FFF).contains($0.value) || ("0"..."9").contains(Character($0)) }.count
            return total + Double(counted) * Double(top.confidence)
        }
    }
}

/// 整页作业照缩进证据图后，手写数字只有几像素高，老师会把 204 看成 20.4（2026-10-16 真机）。
/// 在本机用文字识别找到所选那道题的算式行，裁出它和右侧手写答案、下面一行，供证据图放大展示。
enum PhotoFocus {
    /// rect 是照片坐标（左上原点，单位同 image.size）里的裁剪框；written 是本机识别出的等号右边手写内容，可能认错。
    struct Focus: Equatable, Sendable { var rect: CGRect; var written: String? }
    /// 找不到唯一的那一行时返回 nil，只发整页。
    static func locate(_ image: UIImage, statement: String) -> Focus? {
        let numbers = keyNumbers(statement)
        guard numbers.count >= 2 || numbers.first.map({ $0.count >= 2 }) == true,
              let scan = PhotoOrientation.rotated(image, quarterTurns: 0, maxEdge: 1600), let cgImage = scan.cgImage else { return nil }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = false
        do { try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request]) } catch { return nil }
        let matches = (request.results ?? []).compactMap { observation -> (CGRect, String)? in
            guard let text = observation.topCandidates(1).first?.string.filter({ !$0.isWhitespace }),
                  containsInOrder(text, numbers: numbers) else { return nil }
            return (observation.boundingBox, text)
        }
        guard matches.count == 1, let (line, text) = matches.first else { return nil }
        // Vision 坐标是左下原点、0～1；换成照片坐标。答案写在等号右边，下一行常有圈选，所以向右、向下多留。
        let size = image.size
        let lineHeight = line.height * size.height
        let top = (1 - line.maxY) * size.height - lineHeight * 0.8
        let bottom = (1 - line.minY) * size.height + lineHeight * 2.2
        let left = line.minX * size.width - lineHeight * 2
        let right = line.maxX * size.width + max(line.width * size.width * 1.2, lineHeight * 6)
        let rect = CGRect(x: left, y: top, width: right - left, height: bottom - top)
            .intersection(CGRect(origin: .zero, size: size))
        guard !rect.isNull, rect.width >= 8, rect.height >= 8 else { return nil }
        // 手写答案有时和算式连成一行（“12.5-0.5=204”），有时单独成块；单独时取同一行、紧挨在右边的那块。
        let sameLine = text.contains("=") ? String(text[text.index(after: text.lastIndex(of: "=")!)...]) : ""
        let beside = (request.results ?? []).filter { other in
            let box = other.boundingBox
            let overlap = min(box.maxY, line.maxY) - max(box.minY, line.minY)
            return box.minX >= line.maxX - 0.01 && box.minX - line.maxX < line.width && overlap > min(box.height, line.height) * 0.5
        }.min { $0.boundingBox.minX < $1.boundingBox.minX }?.topCandidates(1).first?.string.filter { !$0.isWhitespace } ?? ""
        let written = [sameLine, beside].first { $0.count <= 12 && $0.contains(where: \.isNumber) }
        return Focus(rect: rect.integral, written: written)
    }

    /// 只取题干第一行的阿拉伯数字，去掉开头题号（③、(3)、3.、3、以及识别成“3 12.5”的圈码）。
    static func keyNumbers(_ statement: String) -> [String] {
        let first = statement.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let body = first.replacingOccurrences(of: #"^\s*(?:[(（]\d{1,2}[)）]|\d{1,2}[)）、.](?!\d)|\d{1,2}\s+(?=\d))"#, with: "", options: .regularExpression)
        let regex = try! NSRegularExpression(pattern: #"\d+(?:\.\d+)?"#)
        return regex.matches(in: body, range: NSRange(body.startIndex..., in: body)).compactMap { Range($0.range, in: body).map { String(body[$0]) } }
    }

    /// 运算符常被识别丢掉（“12.5÷0.5”读成“12.5 0.5”），所以只要求这些数按顺序出现，中间可以没有分隔。
    private static func containsInOrder(_ text: String, numbers: [String]) -> Bool {
        let pattern = "(?<![\\d.])" + numbers.map(NSRegularExpression.escapedPattern(for:)).joined(separator: "[^\\d]{0,4}") + "(?!\\d)"
        return text.range(of: pattern, options: .regularExpression) != nil
    }
}
