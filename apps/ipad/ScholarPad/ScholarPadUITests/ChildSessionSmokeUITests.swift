// 儿童端冒烟：模拟器连本机宿主（需先运行
//   cd apps/agent-host && pnpm exec tsx src/server.ts --scripted --script fixtures/scripted-happy-path.json
// ），拿到任务 → 画一笔 → 点“我卡住了” → 收到并显示脚本里的第一句提示。证明协议、出站队列、状态推导与界面整条链在真实 socket 上工作。
import XCTest

final class ChildSessionSmokeUITests: XCTestCase {
    @MainActor
    func testDeviceContestAcknowledgesDisagreement() {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-session"]
        app.launch()
        let task = app.staticTexts["taskText"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label CONTAINS '2.4 × 0.3'"), evaluatedWith: task)
        waitForExpectations(timeout: 10)
        app.buttons["你理解错了"].tap()
        expectation(for: NSPredicate(format: "label == '哪里和你的想法不一样？'"), evaluatedWith: app.staticTexts["agentLine"])
        waitForExpectations(timeout: 5)
        app.buttons["我想休息"].tap()
        XCTAssertTrue(app.buttons["继续"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testDeviceParentHelpShowsWaitingFeedback() {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-session"]
        app.launch()
        let task = app.staticTexts["taskText"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label CONTAINS '2.4 × 0.3'"), evaluatedWith: task)
        waitForExpectations(timeout: 10)
        app.buttons["我卡住了"].tap()
        expectation(for: NSPredicate(format: "label CONTAINS '正在等待提示'"), evaluatedWith: app.staticTexts["agentLine"])
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.buttons["我想休息"].isHittable)
    }

    /// 只输入成人编写的固定测试答案；真实 socket + 脚本教师，不能作为 AI 教学质量验收。
    @MainActor
    func testDeviceScriptedLearningLoop() throws {
        try runDeviceScriptedLoop(transferAnswer: "1.4")
    }

    @MainActor
    func testDeviceScriptedTransferFailureAllowsStop() throws {
        try runDeviceScriptedLoop(transferAnswer: "14")
    }

    @MainActor
    private func runDeviceScriptedLoop(transferAnswer: String) throws {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-session"]
        app.launch()
        let task = app.staticTexts["taskText"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        func waitTask(_ fragment: String) {
            expectation(for: NSPredicate(format: "label CONTAINS %@", fragment), evaluatedWith: task)
            waitForExpectations(timeout: 10)
        }
        func say(_ text: String) {
            let field = app.textFields["draftField"]
            field.tap(); field.typeText(text); app.buttons["说"].tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3))
        }
        func capture(_ name: String) {
            let item = XCTAttachment(screenshot: app.screenshot())
            item.name = name; item.lifetime = .keepAlways; add(item)
        }
        waitTask("2.4 × 0.3")
        let acknowledge = app.buttons["firstUseNoticeAcknowledge"]
        if app.staticTexts["firstUseNoticeText"].waitForExistence(timeout: 3) {
            for _ in 0..<4 where !acknowledge.isHittable { app.scrollViews.firstMatch.swipeUp() }
            XCTAssertTrue(acknowledge.isHittable)
            acknowledge.tap()
            XCTAssertTrue(acknowledge.waitForNonExistence(timeout: 5))
        }
        app.buttons["我卡住了"].tap()
        let line = app.staticTexts["agentLine"]
        expectation(for: NSPredicate(format: "label == '你现在已经确定了什么？'"), evaluatedWith: line)
        waitForExpectations(timeout: 10)
        capture("01-scripted-hint")
        say("结果会变小")
        app.buttons["我做完了"].tap()
        waitTask("说说为什么")
        say("因为0.3是十分之三，所以结果变小")
        waitTask("3.5 × 0.4")
        capture("02-transfer-without-hint")
        app.segmentedControls.buttons["答案"].tap()
        say(transferAnswer)
        if transferAnswer == "14" {
            let stop = app.buttons["今天先到这里"]
            XCTAssertTrue(stop.waitForExistence(timeout: 5))
            XCTAssertFalse(app.staticTexts["今天这一题到这里，你做得很认真。"].exists)
            capture("03-failed-transfer-offers-exit")
            stop.tap()
        } else {
            let unsure = app.buttons["assent-unsure"]
            if unsure.waitForExistence(timeout: 3) { unsure.tap() }
        }
        XCTAssertTrue(app.staticTexts["今天这一题到这里，你做得很认真。"].waitForExistence(timeout: 10))
        capture("03-completed")
    }

    @MainActor
    func testDeviceDoneRequestsExplainBack() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-session"]
        app.launch()
        let task = app.staticTexts["taskText"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label CONTAINS '2.4 × 0.3'"), evaluatedWith: task)
        waitForExpectations(timeout: 15)
        app.buttons["我做完了"].tap()
        expectation(for: NSPredicate(format: "label CONTAINS '说说为什么'"), evaluatedWith: task)
        waitForExpectations(timeout: 5)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "05-explain-back"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// 真机本地连接验收；不注入题目或网络响应，也不把系统触摸当作 Pencil。
    @MainActor
    func testDeviceLocalSessionControls() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-session"]
        app.launch()
        let task = app.staticTexts["taskText"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label CONTAINS '2.4 × 0.3'"), evaluatedWith: task)
        waitForExpectations(timeout: 15)
        func capture(_ name: String) {
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        capture("01-connected")
        app.buttons["我想休息"].tap()
        XCTAssertTrue(app.buttons["继续"].waitForExistence(timeout: 5))
        capture("02-paused")
        app.buttons["继续"].tap()
        XCTAssertTrue(app.buttons["我想休息"].waitForExistence(timeout: 5))
        let draft = app.textFields["draftField"]
        draft.tap()
        draft.typeText("0.72")
        app.buttons["说"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3), "发送后应收起键盘，把空间还给画布")
        capture("03-submitted-thought")
        app.buttons["我卡住了"].tap()
        capture("04-help-requested")
        // 只验证可观察的本地交互；提示内容须另核对宿主，不伪装成真实 AI 通过。
        XCTAssertTrue(app.buttons["我想休息"].isHittable)
    }

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
