// 笔画差分：PencilKit 只告诉我们“整幅画变了”，这里把它翻成一条条 STROKE / ERASE 事件。
// 每条 PKStroke 的身份是量化后路径点的哈希：高频采样点先聚合、再上传，原始点不进事件表（设计稿 12）。
import CoreGraphics
import CryptoKit
import Foundation

enum StrokeDiff {
    struct Stroke: Equatable {
        let hash: String
        let bounds: StrokeBounds
    }

    /// 先发擦除再发新增：宿主把擦除过的哈希记下来，同样内容再出现就不算新策略。
    static func diff(known: Set<String>, current: [Stroke]) -> [EventPayload] {
        let currentHashes = Set(current.map(\.hash))
        var events: [EventPayload] = []
        for hash in known.subtracting(currentHashes).sorted() {
            events.append(.erase(strokeId: strokeId(for: hash), contentHash: hash))
        }
        for stroke in current where !known.contains(stroke.hash) {
            events.append(.stroke(strokeId: strokeId(for: stroke.hash), contentHash: stroke.hash, bounds: stroke.bounds))
        }
        return events
    }

    /// 路径点按 grid 像素量化后做 SHA-256，取前 16 位十六进制。1 px 内的抖动落在同一格。
    static func quantizedHash(points: [CGPoint], grid: CGFloat = 2) -> String {
        var data = Data()
        for point in points {
            var qx = Int32((point.x / grid).rounded())
            var qy = Int32((point.y / grid).rounded())
            withUnsafeBytes(of: &qx) { data.append(contentsOf: $0) }
            withUnsafeBytes(of: &qy) { data.append(contentsOf: $0) }
        }
        let digest = SHA256.hash(data: data)
        return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    private static func strokeId(for hash: String) -> String { "st-\(hash)" }
}
