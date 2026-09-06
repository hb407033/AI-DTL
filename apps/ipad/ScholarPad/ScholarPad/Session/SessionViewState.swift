// 儿童端界面状态：只保存孩子该看到的东西，由宿主的出站消息纯函数推导（reduce），便于无界面测试。
// 不保存聊天历史、提示级别数字与状态机细节；phase 只用于决定输入框把话发成哪种事件，不展示给孩子。
import Foundation

struct SessionViewState: Equatable {
    enum Presence: String, Equatable { case listening, waiting, paused }
    struct Confirmation: Equatable { let targetEventId: String; let text: String }
    struct SoftLanding: Equatable { let message: String; let options: [String] }

    var phase = "PREPARING"
    var presence: Presence = .waiting
    var taskText = ""
    var agentLine = ""
    /// 每收到一句 Agent 的话 +1；界面据此触发朗读，避免相同文本不重读
    var speakVersion = 0
    var agentObjects: [SemanticObject] = []
    var highlightedIds: Set<String> = []
    var pointer: Point?
    var pendingConfirmation: Confirmation?
    var softLanding: SoftLanding?
    var notice: String?

    /// 重连或重开 App 前调用：Agent 层与弹层由宿主随后下发的“当前画面”重建，任务与最近一句先留着免得闪空
    mutating func resetForResume() {
        agentObjects = []
        highlightedIds = []
        pointer = nil
        softLanding = nil
        pendingConfirmation = nil
    }

    var isPaused: Bool { phase == "PAUSED_CHILD" || phase == "PAUSED_TECH" }
    var isCompleted: Bool { phase == "COMPLETED" }

    static func reduce(_ state: inout SessionViewState, _ message: ChildOutbound) {
        switch message {
        case .stateChanged(_, let phase, _, let presence):
            state.phase = phase
            state.presence = Presence(rawValue: presence) ?? .listening
            if phase != "SOFT_LANDING" { state.softLanding = nil }
            if phase != "WAITING_CONFIRMATION" { state.pendingConfirmation = nil }
        case .learnerTask(_, let text):
            state.taskText = text
        case .speak(_, let text, _, _):
            state.agentLine = text
            state.speakVersion += 1
        case .canvasAction(_, let action):
            apply(action, to: &state)
        case .confirmTranscript(_, let targetEventId, let text):
            state.pendingConfirmation = Confirmation(targetEventId: targetEventId, text: text)
        case .softLanding(_, let message, let options):
            state.softLanding = SoftLanding(message: message, options: options)
        case .notice(_, let text):
            state.notice = text
        }
    }

    private static func apply(_ action: CanvasAction, to state: inout SessionViewState) {
        switch action {
        case .upsertObject(let object):
            guard object.owner == "agent" else { return }   // 其他归属的对象不属于 Agent 层
            if let index = state.agentObjects.firstIndex(where: { $0.id == object.id }) {
                state.agentObjects[index] = object
            } else {
                state.agentObjects.append(object)
            }
        case .removeObject(let objectId):
            state.agentObjects.removeAll { $0.id == objectId }
            state.highlightedIds.remove(objectId)
        case .highlight(let objectId):
            state.highlightedIds.insert(objectId)
        case .point(let at):
            state.pointer = at
        }
    }
}
