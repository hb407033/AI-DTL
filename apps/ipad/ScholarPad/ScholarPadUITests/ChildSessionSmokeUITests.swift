// 儿童端冒烟：模拟器连本机宿主（需先运行
//   cd apps/agent-host && pnpm exec tsx src/server.ts --scripted --script fixtures/scripted-happy-path.json
// ），拿到任务 → 画一笔 → 点“我卡住了” → 收到并显示脚本里的第一句提示。证明协议、出站队列、状态推导与界面整条链在真实 socket 上工作。
import XCTest

final class ChildSessionSmokeUITests: XCTestCase {
    @MainActor
    func testHelpRequestBringsFirstHintFromHost() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-session"]   // 不续接上次的会话，每次冒烟都从新题开始
        app.launch()

        let task = app.staticTexts["taskText"]
        XCTAssertTrue(task.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "label CONTAINS '2.4 × 0.3'"), evaluatedWith: task)
        waitForExpectations(timeout: 10)

        let canvas = app.descendants(matching: .any)["childCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 5), "找不到画布")
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.4))
            .press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)))

        app.buttons["我卡住了"].tap()
        let line = app.staticTexts["agentLine"]
        expectation(for: NSPredicate(format: "label == '你现在已经确定了什么？'"), evaluatedWith: line)
        waitForExpectations(timeout: 10)

        // 孩子再画一笔：提示撤回、回到独立探索；Agent 的话保留最新一句，不再有新的
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.7))
            .press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.7)))
        app.buttons["我卡住了"].tap()
        expectation(for: NSPredicate(format: "label == '0.3 还能换成什么说法？'"), evaluatedWith: line)
        waitForExpectations(timeout: 10)
    }
}
