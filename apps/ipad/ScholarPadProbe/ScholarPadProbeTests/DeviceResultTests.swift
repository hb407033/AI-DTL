// iPad 结果导出的契约测试：与 Mac 端报告器共用 device-result-v1.json 夹具；导出只含设备信息与样本，不含 PCM、笔迹或家庭信息。
import XCTest
@testable import ScholarPadProbe

final class DeviceResultTests: XCTestCase {
    private func fixtureData() throws -> Data {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        url.append(path: "packages/gate-contracts/fixtures/device-result-v1.json")
        return try Data(contentsOf: url)
    }

    func testFixtureRoundTripsThroughCodable() throws {
        let data = try fixtureData()
        let decoded = try JSONDecoder().decode(DeviceResult.self, from: data)
        XCTAssertEqual(decoded.transport, "ws-local")
        XCTAssertEqual(decoded.samples.count, 3)
        let reencoded = try JSONEncoder().encode(decoded)
        let lhs = try XCTUnwrap(JSONSerialization.jsonObject(with: reencoded) as? NSDictionary)
        let rhs = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
        XCTAssertEqual(lhs, rhs)
    }

    @MainActor
    func testBuildFromStoreFlattensAllMetrics() {
        let store = ProbeMetricsStore()
        store.append(MetricSample(metric: .penRender, elapsedMs: 10, success: true))
        store.append(MetricSample(metric: .lanAck, elapsedMs: 3, success: true))
        let result = DeviceResult.build(from: store, appBuild: "7")
        XCTAssertTrue(result.runId.hasPrefix("device-"))
        XCTAssertEqual(result.appBuild, "7")
        XCTAssertEqual(result.transport, "ws-local")
        XCTAssertEqual(Set(result.samples.map(\.metric)), [.penRender, .lanAck])
        XCTAssertEqual(result.schemaVersion, 1)
    }
}
