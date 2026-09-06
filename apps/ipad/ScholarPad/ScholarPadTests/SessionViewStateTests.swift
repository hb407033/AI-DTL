// 界面状态由出站消息纯函数推导，不碰网络与视图，直接对 reduce 做单测。
import XCTest
@testable import ScholarPad

final class SessionViewStateTests: XCTestCase {
    private func reduced(_ messages: [ChildOutbound]) -> SessionViewState {
        var state = SessionViewState()
        for message in messages { SessionViewState.reduce(&state, message) }
        return state
    }

    func testStateChangedDrivesPresenceAndPause() {
        let listening = reduced([.stateChanged(id: "o1", state: "INDEPENDENT", hintLevel: 0, presence: "listening")])
        XCTAssertEqual(listening.presence, .listening)
        XCTAssertFalse(listening.isPaused)
        XCTAssertEqual(listening.phase, "INDEPENDENT")
        let paused = reduced([.stateChanged(id: "o1", state: "PAUSED_CHILD", hintLevel: 1, presence: "paused")])
        XCTAssertTrue(paused.isPaused)
        XCTAssertEqual(paused.presence, .paused)
        XCTAssertTrue(reduced([.stateChanged(id: "o1", state: "COMPLETED", hintLevel: 0, presence: "listening")]).isCompleted)
    }

    func testLearnerTaskAndSpeak() {
        let state = reduced([
            .learnerTask(id: "o1", text: "2.4 × 0.3，结果大概是多少？"),
            .speak(id: "o2", text: "你现在已经确定了什么？", hintLevel: 1, interruptible: true),
            .speak(id: "o3", text: "0.3 还能换成什么说法？", hintLevel: 2, interruptible: true),
        ])
        XCTAssertEqual(state.taskText, "2.4 × 0.3，结果大概是多少？")
        XCTAssertEqual(state.agentLine, "0.3 还能换成什么说法？")
        XCTAssertEqual(state.speakVersion, 2)   // 每句话 +1，界面据此触发朗读
    }

    func testCanvasActionsMaintainAgentLayer() {
        let bar = SemanticObject(id: "bar", owner: "agent", kind: "tenthsBar", props: ["filled": .number(0)])
        let barAgain = SemanticObject(id: "bar", owner: "agent", kind: "tenthsBar", props: ["filled": .number(3)])
        let state = reduced([
            .canvasAction(id: "o1", action: .upsertObject(bar)),
            .canvasAction(id: "o2", action: .upsertObject(barAgain)),
            .canvasAction(id: "o3", action: .upsertObject(SemanticObject(id: "lbl", owner: "agent", kind: "label"))),
            .canvasAction(id: "o4", action: .highlight(objectId: "bar")),
            .canvasAction(id: "o5", action: .point(at: Point(x: 3, y: 4))),
            .canvasAction(id: "o6", action: .removeObject(objectId: "lbl")),
        ])
        XCTAssertEqual(state.agentObjects.map(\.id), ["bar"])
        XCTAssertEqual(state.agentObjects.first?.number("filled"), 3)   // 同 id 更新而不是追加
        XCTAssertEqual(state.highlightedIds, ["bar"])
        XCTAssertEqual(state.pointer, Point(x: 3, y: 4))
    }

    func testChildOwnedObjectsAreNeverAccepted() {
        // Agent 层只接受 owner == agent 的对象；其余一律丢弃（设计稿 8.3）
        let state = reduced([.canvasAction(id: "o1", action: .upsertObject(SemanticObject(id: "x", owner: "child", kind: "label")))])
        XCTAssertEqual(state.agentObjects, [])
    }

    func testPromptsAndNotice() {
        let state = reduced([
            .confirmTranscript(id: "o1", targetEventId: "e-1", text: "四十一"),
            .softLanding(id: "o2", message: "这是在试，不是考试。", options: ["simpler", "hint", "stop"]),
            .notice(id: "o3", text: "等我一下。"),
        ])
        XCTAssertEqual(state.pendingConfirmation, SessionViewState.Confirmation(targetEventId: "e-1", text: "四十一"))
        XCTAssertEqual(state.softLanding?.options, ["simpler", "hint", "stop"])
        XCTAssertEqual(state.notice, "等我一下。")
    }
}

final class SessionViewStateResumeTests: XCTestCase {
    func testResetForResumeClearsAgentLayerAndOverlaysButKeepsTaskAndLine() {
        var state = SessionViewState()
        SessionViewState.reduce(&state, .learnerTask(id: "o1", text: "题"))
        SessionViewState.reduce(&state, .speak(id: "o2", text: "话", hintLevel: 1, interruptible: true))
        SessionViewState.reduce(&state, .canvasAction(id: "o3", action: .upsertObject(SemanticObject(id: "bar", owner: "agent", kind: "tenthsBar"))))
        SessionViewState.reduce(&state, .canvasAction(id: "o4", action: .highlight(objectId: "bar")))
        SessionViewState.reduce(&state, .softLanding(id: "o5", message: "m", options: ["stop"]))
        SessionViewState.reduce(&state, .confirmTranscript(id: "o6", targetEventId: "e", text: "t"))
        state.resetForResume()
        XCTAssertEqual(state.agentObjects, [])
        XCTAssertEqual(state.highlightedIds, [])
        XCTAssertNil(state.pointer)
        XCTAssertNil(state.softLanding)
        XCTAssertNil(state.pendingConfirmation)
        XCTAssertEqual(state.taskText, "题")
        XCTAssertEqual(state.agentLine, "话")
        XCTAssertEqual(state.speakVersion, 1)   // 续接时宿主会重发最近一句，届时再 +1 触发朗读
    }
}
