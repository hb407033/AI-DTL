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

final class PencilLatencyGateTests: XCTestCase {
    private func samples(_ values: [Double]) -> [MetricSample] {
        values.map { MetricSample(metric: .penRender, elapsedMs: $0, success: true) }
    }

    func testFewerThanHundredSamplesIsInsufficient() throws {
        let verdict = try PencilLatencyGate.evaluate(samples(Array(repeating: 10, count: 99)))
        XCTAssertEqual(verdict, .insufficient(have: 99, need: 100))
    }

    func testP95AtMost50msPasses() throws {
        // 100 个样本：95 个 30ms、5 个 60ms → nearest-rank P95 = 第 95 个 = 30ms
        let verdict = try PencilLatencyGate.evaluate(samples(Array(repeating: 30, count: 95) + Array(repeating: 60, count: 5)))
        XCTAssertEqual(verdict, .pass(p95Ms: 30))
    }

    func testP95Above50msFails() throws {
        // 94 个 30ms、6 个 60ms → 第 95 个 = 60ms
        let verdict = try PencilLatencyGate.evaluate(samples(Array(repeating: 30, count: 94) + Array(repeating: 60, count: 6)))
        XCTAssertEqual(verdict, .fail(p95Ms: 60))
    }
}
