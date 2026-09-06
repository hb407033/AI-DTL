// 门禁规则表必须与计划 §0 的六行表格逐项一致；改表先改这里。
import XCTest
@testable import ScholarPadProbe

final class GateThresholdsTests: XCTestCase {
    func testRuleTableMatchesPlanSection0() {
        XCTAssertEqual(GateThresholds.rule(for: .penRender), GateRule(p95LimitMs: 50, minSamples: 100))
        XCTAssertEqual(GateThresholds.rule(for: .localInterrupt), GateRule(p95LimitMs: 200, minSamples: 20))
        XCTAssertEqual(GateThresholds.rule(for: .lanAck), GateRule(p95LimitMs: 150, minSamples: 100))
        XCTAssertEqual(GateThresholds.rule(for: .firstAudio), GateRule(p95LimitMs: 3000, minSamples: 20, p50LimitMs: 1500))
        XCTAssertEqual(GateThresholds.rule(for: .remoteCanvas), GateRule(p95LimitMs: 300, minSamples: 20))
        XCTAssertEqual(GateThresholds.rule(for: .reconnect), GateRule(p95LimitMs: 5000, minSamples: 5))
    }

    func testFirstAudioFailsOnP50EvenWhenP95Passes() throws {
        // 20 个样本：11 个 1600ms（P50 = 1600 > 1500），9 个 100ms；P95 = 1600 ≤ 3000 仍判未过
        let samples = (Array(repeating: 1600.0, count: 11) + Array(repeating: 100.0, count: 9))
            .map { MetricSample(metric: .firstAudio, elapsedMs: $0, success: true) }
        XCTAssertEqual(try LatencyGate.evaluate(samples, rule: GateThresholds.firstAudio), .fail(p95Ms: 1600))
    }
}
