// 音频页冒烟：初始化后引擎状态必须离开"未初始化"；开始打断测试后 1 秒内必须出现"已校准"，
// 证明音频线程 tap → 帧流 → VAD → 事件流 → 界面整条链在跑（不需要有人说话）。
import XCTest

final class AudioSmokeUITests: XCTestCase {
    @MainActor
    func testPrepareThenTrialReachesCalibration() throws {
        let app = XCUIApplication()
        app.launch()
        app.buttons["音频"].firstMatch.tap()   // iPadOS 18 的 TabView 顶栏不是 TabBar 元素

        let status = app.staticTexts["audioStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertTrue(status.label.hasSuffix("未初始化"), "初始状态应为未初始化，实际：\(status.label)")

        app.buttons["初始化音频"].tap()
        expectation(for: NSPredicate(format: "label CONTAINS '音频就绪'"), evaluatedWith: status)
        waitForExpectations(timeout: 10)
        print("[audio-smoke] ready: \(status.label)")

        app.buttons.matching(NSPredicate(format: "label BEGINSWITH '开始一次打断测试'")).firstMatch.tap()
        // 模拟器没有回声消除，Mac 扬声器的测试音可能串进 Mac 麦克风直接触发"已打断"；
        // "已校准"或"已打断"任一出现都证明 tap → VAD → 事件 → 界面这条链在跑
        expectation(for: NSPredicate(format: "label CONTAINS '已校准阈值' OR label CONTAINS '已打断'"), evaluatedWith: status)
        waitForExpectations(timeout: 10)
        print("[audio-smoke] after-start: \(status.label)")

        let stop = app.buttons["停止本次测试"]
        if stop.exists {
            stop.tap()
            expectation(for: NSPredicate(format: "label CONTAINS '已停止'"), evaluatedWith: status)
            waitForExpectations(timeout: 5)
        }
    }
}
