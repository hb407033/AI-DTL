// 通用门禁判定测试：同一判定逻辑套不同规则（样本下限 + P95 上限），规则表与计划 §0 一致。
import XCTest
@testable import ScholarPadProbe

final class LatencyGateTests: XCTestCase {
    private func samples(_ metric: MetricName, _ values: [Double]) -> [MetricSample] {
        values.map { MetricSample(metric: metric, elapsedMs: $0, success: true) }
    }

    func testPenRenderNeedsHundredSamples() throws {
        let verdict = try LatencyGate.evaluate(samples(.penRender, Array(repeating: 10, count: 99)), rule: GateThresholds.penRender)
        XCTAssertEqual(verdict, .insufficient(have: 99, need: 100))
    }

    func testPenRenderP95AtMost50Passes() throws {
        // 95 个 30ms、5 个 60ms → nearest-rank P95 = 第 95 个 = 30ms
        let verdict = try LatencyGate.evaluate(samples(.penRender, Array(repeating: 30, count: 95) + Array(repeating: 60, count: 5)), rule: GateThresholds.penRender)
        XCTAssertEqual(verdict, .pass(p95Ms: 30))
    }

    func testPenRenderP95Above50Fails() throws {
        let verdict = try LatencyGate.evaluate(samples(.penRender, Array(repeating: 30, count: 94) + Array(repeating: 60, count: 6)), rule: GateThresholds.penRender)
        XCTAssertEqual(verdict, .fail(p95Ms: 60))
    }

    func testLocalInterruptNeedsTwentySamples() throws {
        let verdict = try LatencyGate.evaluate(samples(.localInterrupt, Array(repeating: 50, count: 19)), rule: GateThresholds.localInterrupt)
        XCTAssertEqual(verdict, .insufficient(have: 19, need: 20))
    }

    func testLocalInterruptP95AtMost200Passes() throws {
        // 20 个样本：19 个 120ms、1 个 400ms → P95 = 第 19 个 = 120ms
        let verdict = try LatencyGate.evaluate(samples(.localInterrupt, Array(repeating: 120, count: 19) + [400]), rule: GateThresholds.localInterrupt)
        XCTAssertEqual(verdict, .pass(p95Ms: 120))
    }

    func testLocalInterruptP95Above200Fails() throws {
        // 18 个 120ms、2 个 400ms → 第 19 个 = 400ms
        let verdict = try LatencyGate.evaluate(samples(.localInterrupt, Array(repeating: 120, count: 18) + [400, 400]), rule: GateThresholds.localInterrupt)
        XCTAssertEqual(verdict, .fail(p95Ms: 400))
    }
}
