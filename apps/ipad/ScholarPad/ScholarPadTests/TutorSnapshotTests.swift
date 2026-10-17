import XCTest
import UIKit
import PencilKit
@testable import ScholarPad

final class TutorSnapshotTests: XCTestCase {
    @MainActor
    func testTeacherHintHasSeparateEvidenceAreaWithoutChangingInk() {
        let ink = PKDrawing()
        let original = ink.dataRepresentation()
        let plain = TutorSnapshot.workspaceImage(drawing: ink, statement: "半升是多少？")
        let withHint = TutorSnapshot.workspaceImage(drawing: ink, statement: "半升是多少？", teacherHint: "老师提示已隐藏；曾显示1升，分2段。")
        XCTAssertEqual(withHint.size.height, plain.size.height + 200)
        XCTAssertEqual(ink.dataRepresentation(), original)
    }
    @MainActor
    func testObservedPhotoIsIncludedWithoutReplacingChildCanvas() throws {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 100), format: format).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 200, height: 100))
        }
        let plain = TutorSnapshot.workspaceImage(drawing: PKDrawing(), statement: "我想知道半升多少钱")
        let combined = TutorSnapshot.workspaceImage(drawing: PKDrawing(), statement: "我想知道半升多少钱", sourcePhoto: photo)
        XCTAssertGreaterThan(combined.size.height, plain.size.height)
        let cg = try XCTUnwrap(combined.cgImage)
        var pixels = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        let context = try XCTUnwrap(CGContext(data: &pixels, width: cg.width, height: cg.height, bitsPerComponent: 8,
            bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        let redCount = stride(from: 0, to: pixels.count, by: 4).filter { pixels[$0] > 200 && pixels[$0 + 1] < 50 && pixels[$0 + 2] < 50 }.count
        XCTAssertGreaterThan(redCount, 1000, "观察对象不能在老师看到的快照中消失")
        XCTAssertLessThanOrEqual(try XCTUnwrap(TutorSnapshot.encode(combined)).count, 180_000)
        XCTAssertEqual(photo.size, CGSize(width: 200, height: 100))
    }
    @MainActor
    func testDarkModeEvidenceContainsActualInkBelowProblemHeader() throws {
        let points = [CGPoint(x: 20, y: 30), CGPoint(x: 250, y: 120)].map {
            PKStrokePoint(location: $0, timeOffset: 0, size: CGSize(width: 8, height: 8), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let drawing = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
        var image: UIImage?
        UITraitCollection(userInterfaceStyle: .dark).performAsCurrent {
            image = TutorSnapshot.workspaceImage(drawing: drawing, statement: "每米2.4元，买0.3米多少钱？")
        }
        let cg = try XCTUnwrap(image?.cgImage)
        var pixels = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        let context = try XCTUnwrap(CGContext(data: &pixels, width: cg.width, height: cg.height,
            bitsPerComponent: 8, bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        var darkPixels = 0
        for y in 180..<cg.height {
            for x in 0..<cg.width {
                let p = (y * cg.width + x) * 4
                if pixels[p] < 100 && pixels[p + 1] < 100 && pixels[p + 2] < 100 { darkPixels += 1 }
            }
        }
        XCTAssertGreaterThan(darkPixels, 100, "不能把白底白笔的空白证据图发给老师")
        XCTAssertEqual(drawing.strokes.count, 1)
    }
    @MainActor
    func testDenseImageFitsWireBudgetWithoutChangingOriginal() throws {
        let size = CGSize(width: 1600, height: 1600)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            for y in stride(from: 0, to: 1600, by: 4) {
                for x in stride(from: 0, to: 1600, by: 4) {
                    UIColor(hue: CGFloat((x * 37 + y * 73) % 997) / 997, saturation: 0.9, brightness: 0.9, alpha: 1).setFill()
                    context.fill(CGRect(x: x, y: y, width: 4, height: 4))
                }
            }
        }
        let data = try XCTUnwrap(TutorSnapshot.encode(image))
        XCTAssertLessThanOrEqual(data.count, 180_000)
        XCTAssertLessThan(data.base64EncodedString().count + 256, 262_144)
        XCTAssertNotNil(UIImage(data: data))
        XCTAssertEqual(image.size, size)
        XCTAssertNil(TutorSnapshot.encode(image, maxBytes: 1))
    }
}

/// 2026-10-16 真机反馈：平放俯拍时照片方向不对，识别读不出题。
final class PhotoOrientationTests: XCTestCase {
    private func problemImage() -> UIImage {
        let size = CGSize(width: 900, height: 360)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
            ("一条小路长60米，在路的一边每隔5米种一棵树，两端都要种。一共要种多少棵树？" as NSString).draw(
                in: CGRect(x: 40, y: 40, width: 820, height: 280),
                withAttributes: [.font: UIFont.systemFont(ofSize: 44), .foregroundColor: UIColor.black])
        }
    }
    func testSidewaysAndUpsideDownPhotosAreTurnedUpright() throws {
        let upright = problemImage()
        let reference = PhotoOrientation.textScore(upright)
        XCTAssertGreaterThan(reference, 20, "正向题图应能认出较多汉字")
        for turns in 1...3 {
            let tilted = try XCTUnwrap(PhotoOrientation.rotated(upright, quarterTurns: turns, maxEdge: nil))
            let fixed = PhotoOrientation.upright(tilted)
            XCTAssertGreaterThan(fixed.size.width, fixed.size.height, "转了\(turns * 90)°的横向题图应摆回横向")
            // 题图文字从左上开始、末行很短：正向时左上角有墨、右下角基本空白；颠倒或镜像时相反。
            XCTAssertGreaterThan(ink(fixed, corner: .topLeft), ink(fixed, corner: .bottomRight) * 2, "转了\(turns * 90)°后应摆回正向，不是颠倒")
        }
        XCTAssertGreaterThan(ink(upright, corner: .topLeft), ink(upright, corner: .bottomRight) * 2, "夹具本身应满足左上有墨、右下空白")
    }
    private enum Corner { case topLeft, bottomRight }
    /// 角落四分之一区域里的深色像素比例。
    private func ink(_ image: UIImage, corner: Corner) -> Double {
        guard let cg = image.cgImage else { return 0 }
        let w = cg.width, h = cg.height
        var pixels = [UInt8](repeating: 0, count: w * h)
        let context = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
        context.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        // 位图第 0 行是图片顶部。
        let rows = corner == .topLeft ? 0..<(h / 2) : (h / 2)..<h
        let columns = corner == .topLeft ? 0..<(w / 2) : (w / 2)..<w
        var dark = 0
        for y in rows { for x in columns where pixels[y * w + x] < 128 { dark += 1 } }
        return Double(dark) / Double(rows.count * columns.count)
    }
    func testUprightAndBlankPhotosAreLeftAlone() {
        let upright = problemImage()
        XCTAssertTrue(PhotoOrientation.upright(upright) === upright, "已经是正向的不转")
        let blank = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 200)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 300, height: 200))
        }
        XCTAssertTrue(PhotoOrientation.upright(blank) === blank, "没有文字时不乱转")
    }
}

final class PhotoFocusTests: XCTestCase {
    /// 仿练习卷：多道带圈号的算式，每道下面一行“先估”。
    private func worksheet() -> UIImage {
        let size = CGSize(width: 1200, height: 1500)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        let lines = [("① 7.2 ÷ 0.3 =", "24"), ("② 5.6 ÷ 0.7 =", "8"), ("③ 12.5 ÷ 0.5 =", "204"), ("④ 3.6 ÷ 0.12 =", "30")]
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
            for (index, line) in lines.enumerated() {
                let y = 120 + CGFloat(index) * 330
                (line.0 as NSString).draw(at: CGPoint(x: 80, y: y), withAttributes: [.font: UIFont.boldSystemFont(ofSize: 52), .foregroundColor: UIColor.black])
                (line.1 as NSString).draw(at: CGPoint(x: 560, y: y - 6), withAttributes: [.font: UIFont.italicSystemFont(ofSize: 60), .foregroundColor: UIColor.blue])
                ("先估：商比被除数（大／小），商大约是____" as NSString).draw(at: CGPoint(x: 80, y: y + 90), withAttributes: [.font: UIFont.systemFont(ofSize: 34), .foregroundColor: UIColor.black])
            }
        }
    }
    func testKeyNumbersSkipItemMarkers() {
        XCTAssertEqual(PhotoFocus.keyNumbers("③ 12.5 ÷ 0.5 =\n先估：商比被除数（大/小）"), ["12.5", "0.5"])
        XCTAssertEqual(PhotoFocus.keyNumbers("(3) 12.5÷0.5="), ["12.5", "0.5"])
        XCTAssertEqual(PhotoFocus.keyNumbers("12.5÷0.5="), ["12.5", "0.5"])
        XCTAssertEqual(PhotoFocus.keyNumbers("3 12.5 ÷ 0.5 = 先估"), ["12.5", "0.5"], "圈码③常被识别成“3 ”")
        XCTAssertEqual(PhotoFocus.keyNumbers("3. 12.5 ÷ 0.5 = ______"), ["12.5", "0.5"])
    }
    func testSelectedProblemLineIsLocatedWithHandwrittenAnswer() throws {
        let photo = worksheet()
        let focus = try XCTUnwrap(PhotoFocus.locate(photo, statement: "③ 12.5 ÷ 0.5 =\n先估：商比被除数（大/小），商大约是"))
        let rect = focus.rect
        XCTAssertEqual(focus.written, "204", "本机识别应带出等号右边写的数")
        let row3 = CGRect(x: 80, y: 120 + 2 * 330, width: 600, height: 60)
        XCTAssertTrue(rect.contains(CGPoint(x: row3.minX + 20, y: row3.midY)), "放大区应包含所选算式：\(rect)")
        XCTAssertGreaterThan(rect.maxX, 680, "放大区应向右包含手写答案：\(rect)")
        XCTAssertLessThan(rect.minY, row3.minY, "\(rect)")
        XCTAssertGreaterThan(rect.maxY, row3.minY + 90, "放大区应包含下面一行先估：\(rect)")
        XCTAssertLessThan(rect.height, 400, "只放大这一道题，不包含相邻题：\(rect)")
    }
    func testUnmatchedOrAmbiguousStatementFallsBackToWholePhoto() {
        XCTAssertNil(PhotoFocus.locate(worksheet(), statement: "9.6 ÷ 2.4 ="))
        XCTAssertNil(PhotoFocus.locate(worksheet(), statement: "一共多少棵树？"))
    }
    @MainActor
    func testFocusedSnapshotShowsCropAndFitsUploadLimit() throws {
        let photo = worksheet()
        let rect = PhotoFocus.Focus(rect: CGRect(x: 40, y: 760, width: 900, height: 260), written: "204")
        let plain = TutorSnapshot.workspaceImage(drawing: PKDrawing(), statement: "③ 12.5 ÷ 0.5 =", sourcePhoto: photo)
        let focused = TutorSnapshot.workspaceImage(drawing: PKDrawing(), statement: "③ 12.5 ÷ 0.5 =", sourcePhoto: photo, photoFocus: rect)
        XCTAssertGreaterThan(focused.size.height, plain.size.height - 300, "放大区要占位")
        XCTAssertLessThanOrEqual(try XCTUnwrap(TutorSnapshot.encode(focused)).count, 180_000)
        // 整页照至少用到 700 宽（原来只有 240 宽）。
        XCTAssertGreaterThan(plain.size.height, 180 + 700 * photo.size.height / photo.size.width)
    }
}
