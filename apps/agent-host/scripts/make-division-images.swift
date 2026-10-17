import AppKit

// 仅生成隔离验收素材，不读取家庭照片、作品或凭据。
let root = CommandLine.arguments[1]
func image(_ name: String, _ contents: [(String, CGFloat, CGFloat, CGFloat)]) {
    let image = NSImage(size: NSSize(width: 800, height: 560)); image.lockFocus()
    NSColor.white.setFill(); NSBezierPath(rect: NSRect(x: 0, y: 0, width: 800, height: 560)).fill()
    for (text, x, y, size) in contents {
        (text as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [.font: NSFont.systemFont(ofSize: size), .foregroundColor: NSColor.black])
    }
    image.unlockFocus()
    let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
    try! bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.8])!.write(to: URL(fileURLWithPath: root + "/" + name))
}
image("problem.jpg", [("12.5 ÷ 0.5 =", 55, 360, 48), ("先估一估，再计算，并检验。", 55, 270, 32)])
image("preview.jpg", [("已确认题目：12.5 ÷ 0.5", 35, 470, 32), ("孩子的画布（合成测试笔迹）", 35, 370, 26),
    ("12.5 ÷ 0.5 = 125 ÷ 5", 70, 280, 45), ("125 ÷ 5 = 205", 70, 160, 45)])
image("corrected.jpg", [("已确认题目：12.5 ÷ 0.5", 35, 470, 32), ("孩子的画布（本轮已自行修正）", 35, 370, 26),
    ("12.5 ÷ 0.5 = 125 ÷ 5 = 25", 50, 260, 40)])
