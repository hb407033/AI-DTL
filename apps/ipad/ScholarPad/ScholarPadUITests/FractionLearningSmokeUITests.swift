// 分数探索真机冒烟（工作包 E）：连真实宿主 learning-tutor（8791，USB 链路），
// 验证入口不自动连接、题干由宿主 ready 下发、提交/求助按钮就位、无自动开麦或自动提交。
// 与 ChildSessionSmokeUITests 的 scripted 宿主（8788）完全无关；恢复后主动提交一次，会产生真实千问调用费用。
import XCTest

final class FractionLearningSmokeUITests: XCTestCase {
    @MainActor
    func testFractionLearningConnectsShowsPromptAndNeverAutoSubmits() throws {
        guard let host = ProcessInfo.processInfo.environment["AI_DTL_TEST_HOST"], !host.isEmpty else {
            throw XCTSkip("请通过 TEST_RUNNER_AI_DTL_TEST_HOST 指定本次可达的 Mac 地址；不使用历史 USB 地址")
        }
        let app = XCUIApplication()
        // UserDefaults 参数域优先级最高，可覆盖 @AppStorage("fractionLearningHost")
        app.launchArguments = ["--legacy-experiments", "-fractionLearningHost", host]
        app.launch()

        // iPadOS 18 的 TabView 可能渲染为侧栏/浮动 tab 条，不用 tabBars 查询，直接按按钮标签定位
        let tab = app.buttons["分数探索"].firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 10), "找不到「分数探索」tab。界面树：\(app.debugDescription)")
        tab.tap()

        // 入口屏：host 输入框默认值被 launchArguments 覆盖
        let hostField = app.textFields["fractionHostField"]
        XCTAssertTrue(hostField.waitForExistence(timeout: 5), "找不到 Mac 地址输入框")
        XCTAssertEqual(hostField.value as? String, host, "launchArguments 应覆盖 @AppStorage 默认值")

        // 恢复页不挡新会话：有无本地草稿时入口按钮标识一致
        let start = app.buttons["fractionStartFresh"]
        XCTAssertTrue(start.waitForExistence(timeout: 5), "找不到新会话入口")
        // 入口阶段绝不自动连接：状态不得显示已连接
        XCTAssertFalse(app.staticTexts["fractionStatus"].exists, "点继续/开始之前不得进入会话屏")
        let beforeTap = XCTAttachment(screenshot: app.screenshot())
        beforeTap.name = "before-start-tap"
        beforeTap.lifetime = .keepAlways
        add(beforeTap)
        XCTAssertTrue(start.isHittable, "开始按钮不可点 frame=\(start.frame)")
        start.tap()
        Thread.sleep(forTimeInterval: 2)
        let afterTap = XCTAttachment(screenshot: app.screenshot())
        afterTap.name = "after-start-tap"
        afterTap.lifetime = .keepAlways
        add(afterTap)

        // 连接成功
        let status = app.staticTexts["fractionStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 10), "找不到会话状态文本。界面树：\(app.debugDescription)")
        expectation(for: NSPredicate(format: "label CONTAINS '已连接'"), evaluatedWith: status)
        waitForExpectations(timeout: 20)

        // 题干由宿主 ready 下发（fraction-compare-01：3/4 与 2/3）
        let prompt = app.staticTexts["fractionPrompt"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 5), "找不到题干文本")
        expectation(for: NSPredicate(format: "label CONTAINS '3/4' AND label CONTAINS '2/3'"), evaluatedWith: prompt)
        waitForExpectations(timeout: 10)

        // 主动提交闭环按钮就位；无反馈时「你理解错了」不可用
        XCTAssertTrue(app.buttons["fractionSubmit"].exists)
        XCTAssertTrue(app.buttons["fractionHelp"].exists)
        let contest = app.buttons["fractionContest"]
        XCTAssertTrue(contest.exists)
        XCTAssertFalse(contest.isEnabled, "没有反馈时「你理解错了」必须不可用")

        // 无任何自动提交/自动开麦行为：等待后状态仍不是「已提交」，也没有系统权限弹窗或语音确认弹窗
        let submitted = NSPredicate(format: "label CONTAINS '已提交'")
        expectation(for: submitted, evaluatedWith: status).isInverted = true
        waitForExpectations(timeout: 5)
        XCTAssertFalse(app.alerts.firstMatch.exists, "不应出现任何自动弹窗（含麦克风权限请求）")

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "fraction-learning-connected"
        attachment.lifetime = .keepAlways
        add(attachment)

        // 真机生命周期：主动回到桌面，再进入 App，必须由孩子选择继续。
        app.buttons["加一张纸"].tap()
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 5))
        app.activate()
        let resume = app.buttons["fractionResume"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "返回前台应提供继续入口")
        XCTAssertFalse(app.staticTexts["fractionStatus"].exists, "返回前台不能自动恢复活动会话")
        resume.tap()
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label CONTAINS '已连接'"), evaluatedWith: status)
        waitForExpectations(timeout: 20)
        app.buttons["fractionSubmit"].tap()
        let reply = app.staticTexts["fractionReply"]
        XCTAssertTrue(reply.waitForExistence(timeout: 45), "主动提交后真实老师应返回可见回复")
        XCTAssertFalse(reply.label.isEmpty)
        let responseAttachment = XCTAttachment(screenshot: app.screenshot())
        responseAttachment.name = "fraction-real-teacher-reply"
        responseAttachment.lifetime = .keepAlways
        add(responseAttachment)
        XCUIDevice.shared.press(.home) // 释放真实宿主连接，避免占用下一次人工试用。
    }
}
