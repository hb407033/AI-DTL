// 笔画差分：把 PKDrawing 的整体变化翻译成 STROKE / ERASE 事件；内容哈希对微小抖动稳定。
import XCTest
@testable import ScholarPad

final class StrokeDiffTests: XCTestCase {
    private func stroke(_ hash: String) -> StrokeDiff.Stroke {
        StrokeDiff.Stroke(hash: hash, bounds: StrokeBounds(x: 0, y: 0, width: 10, height: 10))
    }

    func testNewAndRemovedStrokesBecomeEvents() {
        let events = StrokeDiff.diff(known: ["h1", "h2"], current: [stroke("h2"), stroke("h3")])
        XCTAssertEqual(events.count, 2)
        guard case .erase(let erasedId, let erasedHash) = events[0] else { return XCTFail("先发擦除") }
        XCTAssertEqual(erasedHash, "h1")
        XCTAssertTrue(erasedId.hasPrefix("st-"))
        guard case .stroke(_, let newHash, let bounds) = events[1] else { return XCTFail("再发新笔画") }
        XCTAssertEqual(newHash, "h3")
        XCTAssertEqual(bounds, StrokeBounds(x: 0, y: 0, width: 10, height: 10))
    }

    func testRedrawingSameContentStillSendsStroke() {
        // 擦掉后重画相同内容：客户端照发 STROKE，是否算“新策略”由宿主按哈希判断（设计稿 5.2）
        let after = StrokeDiff.diff(known: [], current: [stroke("h1")])
        XCTAssertEqual(after.count, 1)
        guard case .stroke(_, let hash, _) = after[0] else { return XCTFail() }
        XCTAssertEqual(hash, "h1")
    }

    func testNoChangeProducesNoEvents() {
        XCTAssertEqual(StrokeDiff.diff(known: ["h1"], current: [stroke("h1")]), [])
    }

    func testQuantizedHashIsStableUnderJitterAndDistinctForDifferentPaths() {
        let base: [CGPoint] = [CGPoint(x: 10, y: 10), CGPoint(x: 50.2, y: 12.1), CGPoint(x: 90, y: 40)]
        let jitter: [CGPoint] = [CGPoint(x: 10.4, y: 10.3), CGPoint(x: 50.6, y: 12.5), CGPoint(x: 90.3, y: 40.2)]
        let other: [CGPoint] = [CGPoint(x: 10, y: 10), CGPoint(x: 50, y: 80), CGPoint(x: 90, y: 40)]
        XCTAssertEqual(StrokeDiff.quantizedHash(points: base), StrokeDiff.quantizedHash(points: jitter))
        XCTAssertNotEqual(StrokeDiff.quantizedHash(points: base), StrokeDiff.quantizedHash(points: other))
        XCTAssertEqual(StrokeDiff.quantizedHash(points: base).count, 16)
    }
}
