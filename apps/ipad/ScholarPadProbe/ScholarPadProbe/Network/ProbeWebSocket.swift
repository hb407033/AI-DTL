// iPad → Mac 网关的 WebSocket 客户端（阶段 0 明文 ws://，只在家庭局域网）。
// 三个测量：事件确认往返（lan_ack_ms）、请求→远端语义圆出现（remote_canvas_ms，往返口径）、网络恢复→首个确认（reconnect_ms）。
// 断线按 100/200/400/800/1000 ms 退避重连；网络路径一恢复立刻重连；未确认消息按 clientSeq 重放；服务端 nack 时从期望序号重放。
import Foundation
import Network
import Observation

enum ProbeSocketError: Error {
    case notConnected
    case timeout
    case closed
}

@MainActor
@Observable
final class ProbeWebSocket {
    nonisolated static func reconnectDelayMs(attempt: Int) -> Int {
        min(1000, 100 * (1 << min(attempt, 10)))
    }

    var host: String {
        didSet { UserDefaults.standard.set(host, forKey: "probeHost") }
    }
    private(set) var status = "未连接"
    private(set) var isConnected = false
    private(set) var isBusy = false
    private(set) var rejectedMessages = 0

    private let store: ProbeMetricsStore
    private let canvas: CanvasSceneStore
    private let events = SocketEvents()
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var queue: OutboundQueue
    private var ackExpectations: [String: Expectation] = [:]
    private var actionExpectations: [String: Expectation] = [:]
    private var reconnectAttempt = 0
    private var wantConnected = false
    private var monitor: NWPathMonitor?
    private var pathWasDown = false
    private var recoveryStartedAt: ContinuousClock.Instant?

    init(store: ProbeMetricsStore, canvas: CanvasSceneStore) {
        self.store = store
        self.canvas = canvas
        #if targetEnvironment(simulator)
        host = "localhost"   // 模拟器与 Mac 同机
        #else
        host = UserDefaults.standard.string(forKey: "probeHost") ?? "houbin-mbp.local"
        #endif
        queue = OutboundQueue(sessionId: UUID().uuidString)
        session = URLSession(configuration: .default, delegate: events, delegateQueue: nil)
        events.onOpen = { [weak self] taskId in Task { @MainActor in self?.handleOpen(taskId: taskId) } }
        events.onClose = { [weak self] taskId, reason in Task { @MainActor in self?.handleClose(taskId: taskId, reason: reason) } }
        startPathMonitor()
    }

    // MARK: - 连接管理

    func connect() {
        wantConnected = true
        reconnectAttempt = 0
        open()
    }

    func disconnect() {
        wantConnected = false
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        isConnected = false
        failAllExpectations(ProbeSocketError.closed)
        status = "已断开"
    }

    private func open() {
        guard task == nil else { return }
        guard let url = URL(string: "ws://\(host):8787/probe") else {
            status = "主机名无效：\(host)"
            return
        }
        let newTask = session.webSocketTask(with: url)
        task = newTask
        status = "连接中 \(host)…"
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
        status = "已连接 \(host)"
        let replay = queue.pending   // 断线期间没被确认的，按序号重发
        if !replay.isEmpty {
            Task { for message in replay { try? await self.send(message) } }
        }
    }

    private func handleClose(taskId: Int, reason: String) {
        guard let current = task, current.taskIdentifier == taskId else { return }   // 旧连接的收尾事件不影响新连接
        task = nil
        isConnected = false
        failAllExpectations(ProbeSocketError.closed)
        guard wantConnected else {
            status = "已断开"
            return
        }
        let delay = Self.reconnectDelayMs(attempt: reconnectAttempt)
        reconnectAttempt += 1
        status = "断线（\(reason)），\(delay) ms 后第 \(reconnectAttempt) 次重连"
        Task {
            try? await Task.sleep(for: .milliseconds(delay))
            guard self.wantConnected, self.task == nil else { return }
            self.open()
        }
    }

    private func startPathMonitor() {
        let pathMonitor = NWPathMonitor()
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor in self?.handlePath(up: up) }
        }
        pathMonitor.start(queue: DispatchQueue(label: "probe.path-monitor"))
        monitor = pathMonitor
    }

    private func handlePath(up: Bool) {
        guard up else {
            pathWasDown = true
            if wantConnected { status = "网络不可达，等待恢复…" }
            return
        }
        guard pathWasDown else { return }
        pathWasDown = false
        recoveryStartedAt = .now   // 从这里到下一次 ack 就是 reconnect_ms
        if wantConnected, task == nil {
            reconnectAttempt = 0
            open()
        }
    }

    // MARK: - 收发

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message else {
            rejectedMessages += 1
            return
        }
        do {
            dispatch(try JSONDecoder().decode(ServerMessage.self, from: Data(text.utf8)))
        } catch {
            rejectedMessages += 1   // 未知类型 / 版本不符 / 结构错误：拒绝并记一次
        }
    }

    private func dispatch(_ message: ServerMessage) {
        switch message {
        case .ack(let id, _, _):
            queue.acknowledge(id: id)
            if let start = recoveryStartedAt {
                store.append(MetricSample(metric: .reconnect, elapsedMs: Self.ms(since: start), success: true))
                recoveryStartedAt = nil
            }
            ackExpectations.removeValue(forKey: id)?.fulfill()
        case .nack(_, let expectedSeq):
            status = "网关要求从序号 \(expectedSeq) 重放"
            let replay = queue.replayFrom(seq: expectedSeq)
            Task { for message in replay { try? await self.send(message) } }
        case .semanticAction(_, let inReplyTo, let action):
            switch action {
            case .upsertCircle(let circle): canvas.scene.upsert(circle)
            }
            actionExpectations.removeValue(forKey: inReplyTo)?.fulfill()
        case .error(let reason, _):
            rejectedMessages += 1
            status = "网关拒绝：\(reason)"
        }
    }

    private func send(_ message: ClientMessage) async throws {
        guard let task, isConnected else { throw ProbeSocketError.notConnected }
        let data = try JSONEncoder().encode(message)
        try await task.send(.string(String(decoding: data, as: UTF8.self)))
    }

    // MARK: - 测量

    /// 顺序发 count 条 ping，每条等到 ack 再发下一条；每条一个 lan_ack_ms 样本。
    func runAckBurst(count: Int = 100) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        for index in 1...count {
            guard isConnected else {
                status = "未连接，确认测试止于第 \(index) 条"
                break
            }
            let message = queue.enqueue(.ping, sentAt: Self.nowMs())
            let ack = expectAck(id: message.id)
            let start = ContinuousClock.now
            do {
                try await send(message)
                try await ack.wait(timeoutMs: 5000)
                store.append(MetricSample(metric: .lanAck, elapsedMs: Self.ms(since: start), success: true))
            } catch {
                store.append(MetricSample(metric: .lanAck, elapsedMs: Self.ms(since: start), success: false))
            }
        }
        status = "确认测试完成"
    }

    /// 顺序请求 count 次语义圆：请求 → ack → 语义动作应用到画布，整段往返为一个 remote_canvas_ms 样本（单程的上界）。
    func runSemanticBurst(count: Int = 20) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        for index in 1...count {
            guard isConnected else {
                status = "未连接，语义动作测试止于第 \(index) 次"
                break
            }
            let message = queue.enqueue(.requestSemanticAction, sentAt: Self.nowMs())
            let ack = expectAck(id: message.id)
            let action = expectAction(inReplyTo: message.id)   // 先登记再发送，避免动作先于登记到达
            let start = ContinuousClock.now
            do {
                try await send(message)
                try await ack.wait(timeoutMs: 5000)
                try await action.wait(timeoutMs: 5000)
                store.append(MetricSample(metric: .remoteCanvas, elapsedMs: Self.ms(since: start), success: true))
            } catch {
                store.append(MetricSample(metric: .remoteCanvas, elapsedMs: Self.ms(since: start), success: false))
            }
        }
        status = "语义动作测试完成"
    }

    // MARK: - 等待登记

    /// 主线程上的一次性期待：先登记、后发送，收到即 fulfill；超时或断线则失败。
    @MainActor
    final class Expectation {
        private var resolved = false
        private var continuation: CheckedContinuation<Void, Error>?

        func fulfill() {
            guard !resolved else { return }
            resolved = true
            continuation?.resume()
            continuation = nil
        }

        func fail(_ error: Error) {
            guard !resolved else { return }
            resolved = true
            continuation?.resume(throwing: error)
            continuation = nil
        }

        func wait(timeoutMs: Int) async throws {
            guard !resolved else { return }
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                continuation = cont
                Task {
                    try? await Task.sleep(for: .milliseconds(timeoutMs))
                    self.fail(ProbeSocketError.timeout)
                }
            }
        }
    }

    private func expectAck(id: String) -> Expectation {
        let expectation = Expectation()
        ackExpectations[id] = expectation
        return expectation
    }

    private func expectAction(inReplyTo id: String) -> Expectation {
        let expectation = Expectation()
        actionExpectations[id] = expectation
        return expectation
    }

    private func failAllExpectations(_ error: Error) {
        ackExpectations.values.forEach { $0.fail(error) }
        actionExpectations.values.forEach { $0.fail(error) }
        ackExpectations.removeAll()
        actionExpectations.removeAll()
    }

    // MARK: - 工具

    private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private static func ms(since start: ContinuousClock.Instant) -> Double {
        let elapsed = ContinuousClock.now - start
        return Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
    }
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
