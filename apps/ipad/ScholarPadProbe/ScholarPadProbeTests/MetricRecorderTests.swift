// 指标统计算法测试：与 Mac 端 packages/gate-contracts 使用同一组 1...20 样本，防止两端百分位算法漂移。
import XCTest
@testable import ScholarPadProbe

final class MetricRecorderTests: XCTestCase {
    func testNearestRankSummary() throws {
        let samples = (1...20).map { MetricSample(metric: .penRender, elapsedMs: Double($0), success: $0 != 20) }
        let summary = try MetricRecorder.summarize(samples)
        XCTAssertEqual(summary.count, 20)
        XCTAssertEqual(summary.p50Ms, 10)
        XCTAssertEqual(summary.p95Ms, 19)
        XCTAssertEqual(summary.maxMs, 20)
        XCTAssertEqual(summary.successCount, 19)
    }

    func testEmptySamplesAreRejected() {
        XCTAssertThrowsError(try MetricRecorder.summarize([]))
    }

    func testSingleSampleUsesItselfForAllPercentiles() throws {
        let summary = try MetricRecorder.summarize([MetricSample(metric: .lanAck, elapsedMs: 7, success: true)])
        XCTAssertEqual(summary.p50Ms, 7)
        XCTAssertEqual(summary.p95Ms, 7)
        XCTAssertEqual(summary.maxMs, 7)
    }
}
