// 局域网页冒烟：模拟器连本机网关（pnpm gate:server 需已运行），跑完 100 次确认与 20 次语义圆，
// 证明 WebSocket 客户端、协议编解码、期待登记与指标落库整条链在真实 socket 上工作。
import XCTest

final class NetworkSmokeUITests: XCTestCase {
    @MainActor
    func testAckBurstAndSemanticBurstAgainstLocalGateway() throws {
        let app = XCUIApplication()
        app.launch()
        app.buttons["网络"].firstMatch.tap()

        let status = app.staticTexts["networkStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        app.buttons["连接"].tap()
        expectation(for: NSPredicate(format: "label CONTAINS '已连接'"), evaluatedWith: status)
        waitForExpectations(timeout: 10)

        app.buttons["发 100 次确认"].tap()
        let lanAck = app.staticTexts["lanAckSampleCount"]
        expectation(for: NSPredicate(format: "label == '100'"), evaluatedWith: lanAck)
        waitForExpectations(timeout: 60)

        app.buttons["请求 20 次语义圆"].tap()
        let remote = app.staticTexts["remoteCanvasSampleCount"]
        expectation(for: NSPredicate(format: "label == '20'"), evaluatedWith: remote)
        waitForExpectations(timeout: 30)

        let rejected = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '被拒绝的消息'")).firstMatch
        print("[network-smoke] status=\(status.label) rejected=\(rejected.exists ? rejected.label : "?")")
    }
}
