import XCTest
import UIKit

final class LearningWorkspaceUITests: XCTestCase {
    private var ownQuestionApp: XCUIApplication?
    @MainActor func testResumeWorkWithoutAutomaticVoice() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        try testPhotoObjectOwnQuestionWithoutRecognition()
        let app = try XCTUnwrap(ownQuestionApp)
        XCUIDevice.shared.orientation = .landscapeLeft
        let canvas = app.scrollViews["childCanvas"]
        for _ in 0..<6 { if canvas.isHittable { break }; scrollUp(app) }
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.3)).press(forDuration: 0.1,
            thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.3)))
        XCTAssertEqual(canvas.value as? String, "1")
        app.terminate()
        app.launchEnvironment.removeValue(forKey: "AI_DTL_WORKSPACE_PHOTO")
        app.launch()
        let independent = app.buttons["workspaceResumeIndependent"]
        XCTAssertTrue(independent.waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话")
        XCTAssertEqual(canvas.value as? String, "1")
        let landscape = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        landscape.name = "resume-landscape-preserved-ink-no-mic"; landscape.lifetime = .keepAlways; add(landscape)
        app.buttons["workspaceResumeReview"].tap()
        XCTAssertTrue(app.buttons["inquiryClose"].waitForExistence(timeout: 10))
        app.buttons["inquiryClose"].tap()
        independent.tap()
        XCTAssertFalse(independent.exists)
        XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话")
        XCTAssertEqual(canvas.value as? String, "1")
        app.terminate(); XCUIDevice.shared.orientation = .portrait; app.launch()
        XCTAssertTrue(independent.waitForExistence(timeout: 10))
        let portrait = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        portrait.name = "resume-portrait-offer-on-next-open"; portrait.lifetime = .keepAlways; add(portrait)
    }
    @MainActor func testRecoverReflectionDraftAndReopen() throws {
        let env = ProcessInfo.processInfo.environment
        guard let host = env["AI_DTL_TEST_HOST"], let work = env["AI_DTL_RECOVERY_WORK"] else {
            throw XCTSkip("需要明确指定隔离主机上的测试作品")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString, "AI_DTL_WORKSPACE_HOST": host]
        app.launchArguments = ["-workspaceHost", host]
        app.launch()
        XCTAssertTrue(app.buttons["workspacePortfolio"].waitForExistence(timeout: 10))
        app.buttons["workspacePortfolio"].tap()
        let old = app.buttons["portfolioRemote-\(work)"]
        XCTAssertTrue(old.waitForExistence(timeout: 15)); old.tap()
        XCTAssertTrue(app.buttons["workspaceInquiry"].waitForExistence(timeout: 10))
        app.buttons["workspaceInquiry"].tap()
        let editor = app.textViews["inquiryText"]
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        let expected = "The method is about preserving the whole, not memorising an answer. My first guess changed."
        XCTAssertEqual(editor.value as? String, expected, "意外离开编辑页后，未提交回望必须仍在")
        let before = XCTAttachment(screenshot: app.screenshot()); before.name = "recovered-reflection-draft"; before.lifetime = .keepAlways; add(before)
        let save = app.buttons["inquirySave"]
        for _ in 0..<12 {
            XCTAssertTrue(app.buttons["inquiryClose"].exists, "必须仍在作品历程，禁止在错误弹窗继续滚动")
            if save.isHittable { break }
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.65)).press(forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.53)))
        }
        XCTAssertTrue(save.isHittable); save.tap()
        expectation(for: NSPredicate(format: "label BEGINSWITH '已保存到学习主机'"), evaluatedWith: app.staticTexts["inquiryStatus"])
        waitForExpectations(timeout: 10)
        app.buttons["inquiryClose"].tap(); app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["workspaceInquiry"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话")
        app.buttons["workspaceInquiry"].tap()
        let reflection = app.staticTexts[expected]
        for _ in 0..<12 {
            XCTAssertTrue(app.buttons["inquiryClose"].exists)
            if reflection.isHittable { break }
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.65)).press(forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.53)))
        }
        XCTAssertTrue(reflection.isHittable)
        let after = XCTAttachment(screenshot: app.screenshot()); after.name = "recovered-reflection-reopened"; after.lifetime = .keepAlways; add(after)
    }
    @MainActor func testOwnQuestionRevisionTransferAndReopen() throws {
        continueAfterFailure = false
        try testPhotoObjectOwnQuestionWithoutRecognition()
        let app = try XCTUnwrap(ownQuestionApp)
        if ProcessInfo.processInfo.environment["AI_DTL_TEST_AUDIO_URL"] != nil {
            scrollUp(app)
            let canvas = app.scrollViews["childCanvas"]
            canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.3)).press(forDuration: 0.1,
                thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.3)))
            XCTAssertEqual(canvas.value as? String, "1")
            let run = app.buttons["workspaceSyntheticVoice"]
            for _ in 0..<5 { if run.isHittable { break }; scrollUp(app) }
            run.tap()
            let status = app.staticTexts["workspaceValidationStatus"]
            let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == '自然学习闭环已保存' OR label CONTAINS '失败'"), object: status)
            XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 500), .completed)
            XCTAssertEqual(status.label, "自然学习闭环已保存")
            guard status.label == "自然学习闭环已保存" else { return }
            let proof = XCTAttachment(screenshot: app.screenshot()); proof.name = "object-voice-and-pencil-evidence"; proof.lifetime = .keepAlways; add(proof)
        }
        func reveal(_ element: XCUIElement) {
            for _ in 0..<16 {
                XCTAssertTrue(app.buttons["inquiryClose"].exists, "页面已离开作品历程，不得继续盲目滚动")
                if element.isHittable { return }
                // 弹窗中的整屏甩动会越过短记录，使用小步滚动逐条查找。
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.65)).press(forDuration: 0.05,
                    thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.53)))
            }
        }
        func top() {
            for _ in 0..<8 {
                XCTAssertTrue(app.buttons["inquiryClose"].exists, "页面已离开作品历程，不得继续盲目滚动")
                if app.descendants(matching: .any)["inquiryKind"].firstMatch.isHittable { return }
                app.swipeDown()
            }
        }
        func saveIdea(_ kind: String, _ text: String) {
            top()
            app.descendants(matching: .any)["inquiryKind"].firstMatch.tap()
            app.buttons[kind].tap()
            let editor = app.textViews["inquiryText"]
            editor.tap(); editor.typeText(text)
            XCTAssertEqual(editor.value as? String, text, "保存前核对完整输入，不把失焦或未输入当作成功")
            let finish = app.buttons["inquiryFinishEditing"]
            if finish.exists { finish.tap() }
            else { XCTAssertFalse(app.keyboards.firstMatch.exists, "键盘仍在时必须有结束输入入口") }
            if kind == "我的表示或解释", ProcessInfo.processInfo.environment["AI_DTL_TEST_AUDIO_URL"] != nil {
                let choice = app.switches.matching(NSPredicate(format: "identifier BEGINSWITH 'inquiryEvidence-'")).firstMatch
                reveal(choice); XCTAssertTrue(choice.exists)
                choice.switches.firstMatch.tap()
                XCTAssertEqual(choice.value as? String, "1")
            }
            let save = app.buttons["inquirySave"]; reveal(save); save.tap()
            expectation(for: NSPredicate(format: "label BEGINSWITH '已保存到学习主机'"), evaluatedWith: app.staticTexts["inquiryStatus"])
            waitForExpectations(timeout: 10)
        }
        app.buttons["workspaceInquiry"].tap()
        XCTAssertTrue(app.textViews["inquiryText"].waitForExistence(timeout: 5))
        saveIdea("我猜想", "Multiplication always makes the price larger.")
        let revise = app.buttons["修订这条"].firstMatch; reveal(revise); revise.tap()
        top()
        let editor = app.textViews["inquiryText"]
        editor.tap(); editor.typeText(" But half a litre costs less: 3.4 + 3.4 = 6.8. My first claim was wrong.")
        app.buttons["inquiryFinishEditing"].tap()
        let save = app.buttons["inquirySave"]; reveal(save); save.tap()
        expectation(for: NSPredicate(format: "label BEGINSWITH '已保存到学习主机'"), evaluatedWith: app.staticTexts["inquiryStatus"])
        waitForExpectations(timeout: 10)
        saveIdea("我的表示或解释", "One full bottle is one litre. Two equal half bottles make one full bottle.")
        saveIdea("我的方法和依据", "I split the price into two equal parts because the amount is halved.")
        saveIdea("我怎样检查和修正", "Adding the two half prices gives 6.8. This checks the original whole.")
        top(); app.descendants(matching: .any)["inquiryKind"].firstMatch.tap(); app.buttons["换个情境试试"].tap()
        editor.tap(); editor.typeText("Try the same method with ribbon.")
        app.buttons["inquiryFinishEditing"].tap()
        let fields = [("新的情境是什么？", "Ribbon costs 8 yuan per metre; buy half a metre."),
                      ("用了原来的什么方法？", "Split one whole price into two equal parts."),
                      ("怎样检查？", "Two half metres make one metre; 4 + 4 = 8."),
                      ("实际结果怎样？还不明白也可以写", "4 yuan. The check matches the whole; I did not need a hint.")]
        for (label, text) in fields {
            let field = app.descendants(matching: .any).matching(identifier: label).firstMatch
            reveal(field); XCTAssertTrue(field.exists); field.tap(); field.typeText(text)
            XCTAssertTrue(app.buttons["inquiryFinishEditing"].exists, "迁移字段也应能结束输入，不被键盘困住")
            app.buttons["inquiryFinishEditing"].tap()
        }
        reveal(save); save.tap()
        expectation(for: NSPredicate(format: "label BEGINSWITH '已保存到学习主机'"), evaluatedWith: app.staticTexts["inquiryStatus"])
        waitForExpectations(timeout: 10)
        saveIdea("回头看看", "The method is about preserving the whole, not memorising an answer. My first guess changed.")
        app.buttons["inquiryClose"].tap()
        app.terminate()
        app.launchEnvironment.removeValue(forKey: "AI_DTL_WORKSPACE_PHOTO")
        app.launch()
        XCTAssertTrue(app.buttons["workspaceInquiry"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话")
        app.buttons["workspaceInquiry"].tap()
        let reflection = app.staticTexts["The method is about preserving the whole, not memorising an answer. My first guess changed."]
        reveal(reflection); XCTAssertTrue(reflection.exists)
        let proof = XCTAttachment(screenshot: app.screenshot()); proof.name = "inquiry-transfer-reflection-reopened"; proof.lifetime = .keepAlways; add(proof)
    }
    @MainActor func testPhotoObjectOwnQuestionWithoutRecognition() throws {
        guard let host = ProcessInfo.processInfo.environment["AI_DTL_TEST_HOST"] else { throw XCTSkip("需要隔离测试主机") }
        XCUIDevice.shared.orientation = .portrait
        let image = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 500)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 600, height: 500))
            UIColor.orange.setFill(); context.fill(CGRect(x: 210, y: 100, width: 180, height: 290))
            ("1 L / 6.8 yuan" as NSString).draw(at: CGPoint(x: 190, y: 410), withAttributes: [.font: UIFont.systemFont(ofSize: 24), .foregroundColor: UIColor.black])
        }
        let app = XCUIApplication()
        ownQuestionApp = app
        app.launchArguments = ["-workspaceHost", host, "-workspaceCurrentUnit", "小数乘法"]
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString, "AI_DTL_WORKSPACE_HOST": host,
            "AI_DTL_WORKSPACE_PHOTO": try XCTUnwrap(image.jpegData(compressionQuality: 0.8)).base64EncodedString()]
        if let audio = ProcessInfo.processInfo.environment["AI_DTL_TEST_AUDIO_URL"] {
            app.launchEnvironment["AI_DTL_WORKSPACE_AUDIO_URL"] = audio
            app.launchEnvironment["AI_DTL_NATURAL_LOOP"] = "1"
        }
        app.launch()
        XCTAssertTrue(app.textFields["workspaceHost"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.textFields["workspaceHost"].value as? String, host, "必须连接隔离主机，不能误用历史设置")
        guard app.textFields["workspaceHost"].value as? String == host else { return }
        let own = app.buttons["workspaceOwnQuestion"]
        XCTAssertTrue(own.waitForExistence(timeout: 10)); own.tap()
        let editor = app.textViews["workspaceOwnQuestionEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        let question = "How much is half a litre if one litre costs 6.8 yuan?"
        editor.tap(); editor.typeText(question)
        app.buttons["返回照片，草稿保留"].tap()
        own.tap()
        XCTAssertEqual(editor.value as? String, question)
        app.buttons["workspaceSaveOwnQuestion"].tap()
        let statement = app.staticTexts["workspaceStatement"]
        XCTAssertTrue(statement.waitForExistence(timeout: 15))
        XCTAssertEqual(statement.label, question)
        XCTAssertFalse(app.scrollViews["childCanvas"].exists, "先确认问题，不擅自开始教学")
        app.buttons["workspaceConfirm"].tap()
        XCTAssertTrue(app.scrollViews["childCanvas"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话")
        let proof = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); proof.name = "object-photo-child-question-no-model"; proof.lifetime = .keepAlways; add(proof)
    }
    @MainActor private func scrollUp(_ app: XCUIApplication) {
        // 在画布外的页面边缘滚动；测试模式允许手指书写，不能把滚动手势误画成证据。
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.85)).press(forDuration: 0.05,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.25)))
    }
    @MainActor func testSyntheticPhotoRealRecognitionDrawingSaveAndRelaunch() throws {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        guard let host = ProcessInfo.processInfo.environment["AI_DTL_TEST_HOST"], !host.isEmpty else {
            throw XCTSkip("需要本次可达的 Mac 地址 TEST_RUNNER_AI_DTL_TEST_HOST")
        }
        let image = UIGraphicsImageRenderer(size: CGSize(width: 900, height: 340)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 900, height: 340))
            ("每米彩带 2.4 元，\n买 0.3 米需要多少元？" as NSString).draw(
                in: CGRect(x: 45, y: 60, width: 810, height: 240),
                withAttributes: [.font: UIFont.systemFont(ofSize: 48), .foregroundColor: UIColor.black])
        }
        let app = XCUIApplication()
        app.launchArguments = ["-workspaceHost", host, "-workspaceCurrentUnit", "小数乘法"]
        app.launchEnvironment = ["AI_DTL_WORKSPACE_TEST_ID": UUID().uuidString,
            "AI_DTL_WORKSPACE_PHOTO": try XCTUnwrap(image.jpegData(compressionQuality: 0.8)).base64EncodedString()]
        if let audioURL = ProcessInfo.processInfo.environment["AI_DTL_TEST_AUDIO_URL"] {
            app.launchEnvironment["AI_DTL_WORKSPACE_AUDIO_URL"] = audioURL
        }
        let natural = ProcessInfo.processInfo.environment["AI_DTL_NATURAL_LOOP"] == "1"
        if natural { app.launchEnvironment["AI_DTL_NATURAL_LOOP"] = "1" }
        app.launch()
        XCTAssertTrue(app.buttons["workspaceCamera"].waitForExistence(timeout: 10))
        let usePhoto = app.buttons["workspaceUsePhoto"]
        guard usePhoto.waitForExistence(timeout: 8) else { XCTFail("合成题图未进入真实预览流程"); return }
        XCTAssertFalse(app.staticTexts["workspaceStatement"].exists)
        usePhoto.tap()
        let statement = app.staticTexts["workspaceStatement"]
        guard statement.waitForExistence(timeout: 50) else {
            XCTFail("真实识别失败：\(app.staticTexts["workspaceStatus"].label)"); return
        }
        XCTAssertTrue(statement.label.contains("2.4"))
        XCTAssertTrue(statement.label.contains("0.3"))
        XCTAssertTrue(statement.label.contains("米"))
        XCTAssertTrue(statement.label.contains("元"))
        XCTAssertFalse(statement.label.contains("0.72"), "核对题意不得自动给答案")
        // 作品记录不要求先确认题意，不把儿童自己的问题变成做题后的附属品。
        app.buttons["workspaceInquiry"].tap()
        let inquiryEditor = app.textViews["inquiryText"]
        XCTAssertTrue(inquiryEditor.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: inquiryEditor)
        waitForExpectations(timeout: 10)
        inquiryEditor.tap(); inquiryEditor.typeText("Why does multiplying make it smaller?")
        expectation(for: NSPredicate(format: "value == 'Why does multiplying make it smaller?'"), evaluatedWith: inquiryEditor)
        waitForExpectations(timeout: 8)
        app.buttons["inquiryFinishEditing"].tap()
        let typed = XCTAttachment(screenshot: app.screenshot()); typed.name = "inquiry-before-close"; typed.lifetime = .keepAlways; add(typed)
        app.buttons["inquiryClose"].tap()
        app.buttons["workspaceInquiry"].tap()
        XCTAssertEqual(inquiryEditor.value as? String, "Why does multiplying make it smaller?", "关闭作品页不能丢草稿")
        app.buttons["inquirySave"].tap()
        let inquiryStatus = app.staticTexts["inquiryStatus"]
        expectation(for: NSPredicate(format: "label BEGINSWITH '已保存到学习主机'"), evaluatedWith: inquiryStatus)
        waitForExpectations(timeout: 15)
        for _ in 0..<6 { if app.buttons["修订这条"].firstMatch.exists { break }; app.swipeUp() }
        app.buttons["修订这条"].firstMatch.tap()
        inquiryEditor.tap(); inquiryEditor.typeText(" What if the multiplier is greater than one?")
        // SwiftUI 恢复文本后的光标不保证在末尾；验证实际编辑内容，而不是假定插入位置。
        let revisedIdea = try XCTUnwrap(inquiryEditor.value as? String).trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertTrue(revisedIdea.contains("What if the multiplier is greater than one?"))
        XCTAssertTrue(revisedIdea.contains("Why does multiplying make it smaller?"))
        app.buttons["inquiryFinishEditing"].tap()
        app.buttons["inquirySave"].tap()
        expectation(for: NSPredicate(format: "label BEGINSWITH '已保存到学习主机'"), evaluatedWith: inquiryStatus)
        waitForExpectations(timeout: 15)
        let journalProof = XCTAttachment(screenshot: app.screenshot())
        journalProof.name = "inquiry-saved-with-original-and-revision"; journalProof.lifetime = .keepAlways; add(journalProof)
        app.buttons["inquiryClose"].tap()
        let edit = app.buttons["workspaceEditStatement"]
        XCTAssertTrue(edit.exists, "候选题意需要可修改，不能只能重拍")
        guard edit.exists else { return }
        edit.tap()
        let editor = app.textViews["workspaceStatementEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText(" ")
        app.buttons["workspaceSaveStatement"].tap()
        XCTAssertTrue(app.buttons["workspaceConfirm"].waitForExistence(timeout: 8))
        let candidate = statement.label
        app.buttons["workspaceConfirm"].tap()
        let canvas = app.scrollViews["childCanvas"]
        guard canvas.waitForExistence(timeout: 15) else { XCTFail("确认后未进入画布"); return }
        XCTAssertFalse(app.buttons["用等分图表达我的想法"].exists, "新题不预设等分工具和解题方法")
        XCTAssertFalse(app.buttons["workspaceAddDiagram"].exists)
        scrollUp(app)
        let start = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.4))
        start.press(forDuration: 0.1, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.6)))
        expectation(for: NSPredicate(format: "value == '1'"), evaluatedWith: canvas)
        waitForExpectations(timeout: 8)
        let save = app.buttons["workspaceSave"]
        XCTAssertTrue(save.exists)
        save.tap()
        let status = app.staticTexts["workspaceStatus"]
        expectation(for: NSPredicate(format: "label == '已保存到学习主机。'"), evaluatedWith: status)
        waitForExpectations(timeout: 15)
        if ProcessInfo.processInfo.environment["AI_DTL_TEST_AUDIO_URL"] != nil {
            scrollUp(app)
            let run = app.buttons["workspaceSyntheticVoice"]
            XCTAssertTrue(run.waitForExistence(timeout: 5))
            run.tap()
            let validation = app.staticTexts["workspaceValidationStatus"]
            let expected = natural ? "自然学习闭环已保存" : "五轮语音、画布证据和纠正已保存"
            let complete = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@ OR label CONTAINS '失败' OR label CONTAINS '不匹配'", expected), object: validation)
            XCTAssertEqual(XCTWaiter.wait(for: [complete], timeout: 500), .completed)
            XCTAssertEqual(validation.label, expected)
            let voiceEvidence = XCTAttachment(screenshot: app.screenshot()); voiceEvidence.name = "workspace-five-turn-real-omni"; voiceEvidence.lifetime = .keepAlways; add(voiceEvidence)
        }
        let saved = XCTAttachment(screenshot: app.screenshot()); saved.name = "workspace-real-saved"; saved.lifetime = .keepAlways; add(saved)
        app.terminate()
        app.launchEnvironment.removeValue(forKey: "AI_DTL_WORKSPACE_PHOTO")
        app.launch()
        XCTAssertTrue(app.buttons["workspaceCamera"].waitForExistence(timeout: 10))
        XCTAssertTrue(statement.waitForExistence(timeout: 8))
        XCTAssertEqual(statement.label, candidate)
        app.buttons["workspaceInquiry"].tap()
        // Form 懒加载屏幕外条目，实际滚到记录区再验证，不能把未加载当作丢失。
        for _ in 0..<5 {
            if app.staticTexts[revisedIdea].exists { break }
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts[revisedIdea].exists, "实际修订内容应跨启动完整保留")
        for _ in 0..<5 {
            if app.staticTexts["Why does multiplying make it smaller?"].exists { break }
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts["Why does multiplying make it smaller?"].exists, "原稿应跨启动保留")
        app.buttons["inquiryClose"].tap()
        XCTAssertFalse(app.buttons["workspaceConfirm"].exists)
        if ProcessInfo.processInfo.environment["AI_DTL_TEST_AUDIO_URL"] != nil {
            XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话", "恢复不得自动开麦")
            if natural { XCTAssertTrue(app.staticTexts["workspaceRestoredFeedback"].label.contains("上次一起讨论")) }
            else { XCTAssertTrue(app.staticTexts["workspaceRestoredFeedback"].label.contains("异议")) }
        }
        XCTAssertTrue(canvas.waitForExistence(timeout: 5))
        XCTAssertEqual(canvas.value as? String, "1")
        XCTAssertFalse(app.buttons["用等分图表达我的想法"].exists)
        scrollUp(app)
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3)).press(forDuration: 0.1,
            thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.5)))
        expectation(for: NSPredicate(format: "value == '2'"), evaluatedWith: canvas)
        waitForExpectations(timeout: 8)
        save.tap()
        expectation(for: NSPredicate(format: "label == '已保存到学习主机。'"), evaluatedWith: status)
        waitForExpectations(timeout: 15)
        let restored = XCTAttachment(screenshot: app.screenshot()); restored.name = "workspace-restored-editable"; restored.lifetime = .keepAlways; add(restored)
        // 仅操作本次 UUID 隔离测试会话，制造真实 CAS 冲突而非假 UI 状态。
        let sessionId = app.staticTexts["workspaceTestSession"].label
        XCTAssertNotNil(UUID(uuidString: sessionId))
        let oldRevision = try XCTUnwrap(Int(app.staticTexts["workspaceTestRevision"].label))
        app.buttons["workspaceTestConflict"].tap()
        expectation(for: NSPredicate(format: "label == '主机版本已更新'"), evaluatedWith: app.staticTexts["workspaceTestConflictStatus"])
        waitForExpectations(timeout: 12)
        save.tap()
        let keep = app.buttons["workspaceKeepLocal"]
        XCTAssertTrue(keep.waitForExistence(timeout: 12))
        keep.tap()
        expectation(for: NSPredicate(format: "label == '已保存到学习主机。'"), evaluatedWith: status)
        waitForExpectations(timeout: 12)
        XCTAssertEqual(Int(app.staticTexts["workspaceTestRevision"].label), oldRevision + 2)
        XCTAssertEqual(canvas.value as? String, "2")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(canvas.waitForExistence(timeout: 5))
        XCTAssertEqual(canvas.value as? String, "2", "旋转不能丢笔迹")
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.frame.width > app.frame.height && app.frame.contains(canvas.frame) && canvas.frame.height >= 300
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 8), .completed, "横屏画布必须完整可见，不靠滚动找书写区")
        for (x, y) in [(0.08, 0.08), (0.82, 0.08), (0.08, 0.82), (0.82, 0.82)] {
            canvas.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).press(forDuration: 0.1,
                thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: x + 0.05, dy: y + 0.05)))
        }
        XCTAssertEqual(canvas.value as? String, "6", "横屏四角均能书写")
        save.tap()
        expectation(for: NSPredicate(format: "label == '已保存到学习主机。'"), evaluatedWith: status)
        waitForExpectations(timeout: 12)
        let landscape = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); landscape.name = "workspace-landscape"; landscape.lifetime = .keepAlways; add(landscape)
        app.buttons["workspacePortfolio"].tap()
        let localWork = app.buttons["portfolioLocal-\(sessionId)"]
        XCTAssertTrue(localWork.waitForExistence(timeout: 10))
        localWork.tap()
        XCTAssertTrue(canvas.waitForExistence(timeout: 8))
        XCTAssertEqual(canvas.value as? String, "6", "从本机作品列表重开不得丢笔迹")
        // 换一个空的隔离缓存，从真实主机列表重新取原照和 PencilKit 数据。
        app.terminate()
        app.launchEnvironment["AI_DTL_WORKSPACE_TEST_ID"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.buttons["workspacePortfolio"].waitForExistence(timeout: 10))
        app.buttons["workspacePortfolio"].tap()
        let remoteWork = app.buttons["portfolioRemote-\(sessionId)"]
        XCTAssertTrue(app.staticTexts["portfolioStatus"].waitForExistence(timeout: 8))
        for _ in 0..<30 {
            if remoteWork.exists { break }
            let more = app.buttons["加载更多作品"]
            if more.exists { more.tap() } else { app.swipeUp() }
        }
        XCTAssertTrue(remoteWork.exists, "分页作品列表必须包含刚保存的作品")
        guard remoteWork.exists else { return }
        remoteWork.tap()
        XCTAssertTrue(canvas.waitForExistence(timeout: 15))
        XCTAssertEqual(canvas.value as? String, "6", "无本机缓存时也应恢复主机笔迹")
        XCTAssertEqual(statement.label, candidate)
        XCTAssertTrue(app.images["题目照片"].exists)
        XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话")
        let reopenedLayout = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !app.staticTexts["portfolioStatus"].exists && app.frame.width > app.frame.height && app.frame.contains(canvas.frame)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [reopenedLayout], timeout: 8), .completed, "重开作品并退出 sheet 后，横屏画布也必须完整可见")
        let reopened = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); reopened.name = "portfolio-remote-original-and-ink"; reopened.lifetime = .keepAlways; add(reopened)
        scrollUp(app)
        app.buttons["workspaceKeepEvidence"].tap()
        expectation(for: NSPredicate(format: "label BEGINSWITH '这次笔迹已留作证据'"), evaluatedWith: status)
        waitForExpectations(timeout: 15)
        XCTAssertEqual(app.buttons["workspaceVoice"].label, "开启对话", "独立留证据不得开麦或请求讲解")
        app.buttons["workspaceInquiry"].tap()
        XCTAssertTrue(inquiryEditor.waitForExistence(timeout: 5))
        inquiryEditor.tap(); inquiryEditor.typeText("These lines are my first representation.")
        app.buttons["inquiryFinishEditing"].tap()
        let evidenceChoice = app.switches.matching(NSPredicate(format: "identifier BEGINSWITH 'inquiryEvidence-' ")).firstMatch
        for _ in 0..<6 { if evidenceChoice.exists { break }; app.swipeUp() }
        XCTAssertTrue(evidenceChoice.exists)
        guard evidenceChoice.exists else { return }
        // SwiftUI 暴露整行 Switch 容器和内部实际开关；整行中心不是拨钮。
        let evidenceSwitch = evidenceChoice.switches.firstMatch
        XCTAssertTrue(evidenceSwitch.exists)
        evidenceSwitch.tap()
        expectation(for: NSPredicate(format: "value == '1'"), evaluatedWith: evidenceChoice)
        waitForExpectations(timeout: 5)
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH '查看当时的笔迹' ")).firstMatch.tap()
        XCTAssertTrue(app.images.matching(NSPredicate(format: "identifier BEGINSWITH 'inquirySnapshot-' ")).firstMatch.waitForExistence(timeout: 10))
        for _ in 0..<6 { if app.buttons["inquirySave"].exists { break }; app.swipeUp() }
        app.buttons["inquirySave"].tap()
        expectation(for: NSPredicate(format: "label BEGINSWITH '已保存到学习主机'"), evaluatedWith: inquiryStatus)
        waitForExpectations(timeout: 15)
        let linked = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); linked.name = "inquiry-linked-to-frozen-ink"; linked.lifetime = .keepAlways; add(linked)
    }

    @MainActor func testRealCameraCanBeCancelledWithoutChangingDraft() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("真实相机只在 iPad 验证")
        #else
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["workspaceCamera"].waitForExistence(timeout: 10))
        let status = app.staticTexts["workspaceStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        let previousStatus = status.label
        let hadPhoto = app.images["题目照片"].exists
        let hadUpload = app.buttons["workspaceUsePhoto"].exists
        app.buttons["workspaceCamera"].tap()
        if app.buttons["继续拍照"].waitForExistence(timeout: 1) {
            app.buttons["继续拍照"].tap()
        }
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = system.alerts.firstMatch
        if alert.waitForExistence(timeout: 3) {
            XCTAssertTrue(alert.label.contains("相机") || alert.label.lowercased().contains("camera"))
            let allow = alert.buttons.matching(NSPredicate(format: "label IN %@", ["允许", "好", "OK", "Allow"])).firstMatch
            XCTAssertTrue(allow.exists)
            allow.tap()
        }
        let cancel = app.buttons["workspaceCancelCamera"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 8), "相机页必须提供应用自己的返回按钮")
        guard cancel.exists else { return }
        cancel.tap()
        XCTAssertTrue(app.buttons["workspaceCamera"].waitForExistence(timeout: 5))
        XCTAssertEqual(status.label, previousStatus)
        XCTAssertEqual(app.images["题目照片"].exists, hadPhoto)
        XCTAssertEqual(app.buttons["workspaceUsePhoto"].exists, hadUpload)
        #endif
    }

    @MainActor func testPhotoEntryDoesNotAutomaticallyRequestCameraOrUpload() {
        let app = XCUIApplication()
        app.launchArguments = ["-workspaceHost", "127.0.0.1", "-workspaceCurrentUnit", "小数乘法"]
        app.launch()
        XCTAssertTrue(app.buttons["workspaceCamera"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["workspaceHost"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["workspaceCamera"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertFalse(app.buttons["workspaceUsePhoto"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "workspace-photo-entry"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
