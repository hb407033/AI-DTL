// Pencil 延迟采样逻辑测试：触摸时间戳到下一帧目标呈现时刻的差，作为"应用帧调度延迟"记入 pen_render_ms。
import XCTest
@testable import ScholarPadProbe

final class PencilLatencyTrackerTests: XCTestCase {
    func testFrameAfterTouchProducesOneSample() {
        var tracker = PencilLatencyTracker()
        tracker.noteTouch(timestamp: 10.000)
        let sample = tracker.noteFrame(targetTimestamp: 10.012)
        XCTAssertEqual(sample?.metric, .penRender)
        XCTAssertEqual(sample?.elapsedMs ?? -1, 12, accuracy: 0.001)
        XCTAssertEqual(sample?.success, true)
    }

    func testFrameWithoutPendingTouchProducesNothing() {
        var tracker = PencilLatencyTracker()
        XCTAssertNil(tracker.noteFrame(targetTimestamp: 1))
    }

    func testMultipleTouchesBeforeFrameUseEarliestTouch() {
        // 一帧内多次触摸取最早那次：报最坏情况，不美化数字；出样本后清空待测触摸
        var tracker = PencilLatencyTracker()
        tracker.noteTouch(timestamp: 10.000)
        tracker.noteTouch(timestamp: 10.004)
        let sample = tracker.noteFrame(targetTimestamp: 10.016)
        XCTAssertEqual(sample?.elapsedMs ?? -1, 16, accuracy: 0.001)
        XCTAssertNil(tracker.noteFrame(targetTimestamp: 10.024))
    }

    func testFrameEarlierThanTouchIsMarkedFailure() {
        // 帧目标时刻早于触摸属于时钟异常，不能记成负延迟，记为失败样本
        var tracker = PencilLatencyTracker()
        tracker.noteTouch(timestamp: 10.000)
        let sample = tracker.noteFrame(targetTimestamp: 9.990)
        XCTAssertEqual(sample?.success, false)
        XCTAssertEqual(sample?.elapsedMs, 0)
    }
}
