// 儿童端 → 宿主的 WebSocket 客户端（家庭局域网明文 ws://，设计稿 11.4）。
// 职责：连接与退避重连；把孩子的事件入队后发送；ack 移除、nack 从期望序号重放；把出站消息喂给 SessionViewState.reduce。
// sessionId 存在本机：重开 App 续接同一会话，宿主会重发当前画面；启动参数 --fresh-session 或调用 startNewSession() 才换新会话。
import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class SessionClient {
    nonisolated static func reconnectDelayMs(attempt: Int) -> Int {
        min(1000, 100 * (1 << min(attempt, 10)))
    }

    var host: String {
        didSet { UserDefaults.standard.set(host, forKey: "padHost") }
    }
    private(set) var view = SessionViewState()
    private(set) var isConnected = false
    private(set) var connectionText = "未连接"
    private(set) var rejectedFrames = 0
    private(set) var sessionId: String

    private var outbox: EventOutbox
    private let events = SocketEvents()
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var wantConnected = false
    private var reconnectAttempt = 0

    init(sessionId: String? = nil) {
        #if targetEnvironment(simulator)
        host = "localhost"   // 模拟器与 Mac 同机
        #else
        host = UserDefaults.standard.string(forKey: "padHost") ?? "houbin-mbp.local"
        #endif
        let fresh = ProcessInfo.processInfo.arguments.contains("--fresh-session")
        let saved = fresh ? nil : UserDefaults.standard.string(forKey: "padSessionId")
        let resolved = sessionId ?? saved ?? Self.newSessionId()
        UserDefaults.standard.set(resolved, forKey: "padSessionId")
        self.sessionId = resolved
        outbox = EventOutbox(sessionId: resolved, deviceId: UIDevice.current.identifierForVendor?.uuidString ?? "ipad")
        if let data = UserDefaults.standard.data(forKey: "padMemoryPreview-\(resolved)"),
           let preview = try? JSONDecoder().decode(MemoryPreview.self, from: data) {
            view.memoryPreview = preview
            view.memoryPreviewNonce = preview.previewNonce
            view.memoryPreviewCandidateId = preview.candidateId
        }
        session = URLSession(configuration: .default, delegate: events, delegateQueue: nil)
        events.onOpen = { [weak self] taskId in Task { @MainActor in self?.handleOpen(taskId: taskId) } }
        events.onClose = { [weak self] taskId, reason in Task { @MainActor in self?.handleClose(taskId: taskId, reason: reason) } }
    }

    // MARK: - 连接

    func connect() {
        #if DEBUG
        if let phase = ProcessInfo.processInfo.environment["SCHOLARPAD_TEST_PHASE"] {
            SessionViewState.reduce(&view, .stateChanged(id: "test", state: phase, hintLevel: 0, presence: "waiting"))
            return
        }
        if let json = ProcessInfo.processInfo.environment["SCHOLARPAD_TEST_PREVIEW"],
           let message = try? JSONDecoder().decode(ChildOutbound.self, from: Data(json.utf8)) {
            SessionViewState.reduce(&view, .stateChanged(id: "test", state: "MEMORY_PENDING", hintLevel: 0, presence: "waiting"))
            SessionViewState.reduce(&view, message)
            return
        }
        #endif
        wantConnected = true
        reconnectAttempt = 0
        open()
    }

    func disconnect() {
        wantConnected = false
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        isConnected = false
        connectionText = "已断开"
    }

    private func open() {
        guard task == nil else { return }
        guard let url = URL(string: "ws://\(host):8788/session?sessionId=\(sessionId)") else {
            connectionText = "主机名无效：\(host)"
            return
        }
        let newTask = session.webSocketTask(with: url)
        task = newTask
        connectionText = "连接中 \(host)…"
        newTask.resume()
        receive(on: newTask)
    }

    private func receive(on socket: URLSessionWebSocketTask) {
        socket.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === socket else { return }
                switch result {
                case .success(let message):
                    self.handle(message)
                    self.receive(on: socket)
                case .failure(let error):
                    self.handleClose(taskId: socket.taskIdentifier, reason: error.localizedDescription)
                }
            }
        }
    }

    private func handleOpen(taskId: Int) {
        guard task?.taskIdentifier == taskId else { return }
        isConnected = true
        reconnectAttempt = 0
        connectionText = "已连接 \(host)"
        view.resetForResume()   // 宿主紧接着会下发当前画面
        let replay = outbox.pending   // 断线期间没被确认的按序号重发；宿主按 id 去重
        Task { for frame in replay { try? await self.transmit(frame) } }
    }

    private func handleClose(taskId: Int, reason: String) {
        guard let current = task, current.taskIdentifier == taskId else { return }
        task = nil
        isConnected = false
        guard wantConnected else {
            connectionText = "已断开"
            return
        }
        let delay = Self.reconnectDelayMs(attempt: reconnectAttempt)
        reconnectAttempt += 1
        connectionText = "断线（\(reason)），\(delay) ms 后重连"
        Task {
            try? await Task.sleep(for: .milliseconds(delay))
            guard self.wantConnected, self.task == nil else { return }
            self.open()
        }
    }

    /// 换一题：断开、换新 sessionId、清空画面、重连。旧会话留在宿主里，不删。
    func startNewSession() {
        disconnect()
        sessionId = Self.newSessionId()
        UserDefaults.standard.set(sessionId, forKey: "padSessionId")
        outbox = EventOutbox(sessionId: sessionId, deviceId: outbox.deviceId)
        view = SessionViewState()
        connect()
    }

    private static func newSessionId() -> String { "pad-\(UUID().uuidString.prefix(8))" }

    // MARK: - 收发

    /// 孩子的每个动作都从这里出去：入队拿到幂等 id 与序号，再发送。未连接时留在队列里等重连补发。
    func send(_ payload: EventPayload, source: EvidenceSource) {
        let frame = outbox.enqueue(payload, source: source, occurredAt: Self.nowMs())
        Task { try? await self.transmit(frame) }
    }

    private func transmit(_ frame: ClientFrame) async throws {
        guard let task, isConnected else { return }
        let data = try JSONEncoder().encode(frame)
        try await task.send(.string(String(decoding: data, as: UTF8.self)))
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message else {
            rejectedFrames += 1
            return
        }
        do {
            dispatch(try JSONDecoder().decode(ServerFrame.self, from: Data(text.utf8)))
        } catch {
            rejectedFrames += 1   // 未知类型 / 版本不符 / 结构错误：拒绝并记一次
        }
    }

    private func dispatch(_ frame: ServerFrame) {
        switch frame {
        case .ack(let id, _, _):
            outbox.acknowledge(id: id)
        case .nack(_, let expectedSeq):
            let replay = outbox.replayFrom(seq: expectedSeq)
            Task { for frame in replay { try? await self.transmit(frame) } }
        case .outbound(let message):
            SessionViewState.reduce(&view, message)
            let key = "padMemoryPreview-\(sessionId)"
            if let preview = view.memoryPreview, let data = try? JSONEncoder().encode(preview) {
                UserDefaults.standard.set(data, forKey: key)
            } else if view.memoryPreviewNonce == nil {
                UserDefaults.standard.removeObject(forKey: key)
            }
        case .error:
            rejectedFrames += 1
        }
    }

    /// 界面消费完一次性提示后清掉，避免同一条横幅反复出现
    func clearNotice() { view.notice = nil }

    private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

/// URLSession 回调（在会话的代理队列上），只把任务号和原因转成 Sendable 值再交回主线程。
final class SocketEvents: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    var onOpen: (@Sendable (Int) -> Void)?
    var onClose: (@Sendable (Int, String) -> Void)?

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        onOpen?(webSocketTask.taskIdentifier)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        onClose?(webSocketTask.taskIdentifier, "对端关闭 \(closeCode.rawValue)")
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { onClose?(task.taskIdentifier, error.localizedDescription) }
    }
}
