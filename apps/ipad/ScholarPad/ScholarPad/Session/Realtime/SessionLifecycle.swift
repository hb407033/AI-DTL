import Foundation

/// 空闲关闭和按轮换会话。正在进行的一轮里不关闭、也不换掉当前连接。
/// 计划没有定时器入口，测试和前台恢复调用 evaluate()。
@MainActor
final class SessionLifecycle {
    private(set) var current: RealtimeSessionProtocol?
    private let makeSession: () -> RealtimeSessionProtocol
    private let instructions: () -> String
    let idleCloseAfter: TimeInterval
    let rotateEveryTurns: Int
    private let clock: () -> Date
    private var lastActivity: Date
    private var completedTurns = 0
    private var inFlight = false
    private var next: RealtimeSessionProtocol?

    init(makeSession: @escaping () -> RealtimeSessionProtocol, instructions: @escaping () -> String,
         idleCloseAfter: TimeInterval = 90, rotateEveryTurns: Int = 8, clock: @escaping () -> Date = Date.init) {
        self.makeSession = makeSession
        self.instructions = instructions
        self.idleCloseAfter = idleCloseAfter
        self.rotateEveryTurns = rotateEveryTurns
        self.clock = clock
        self.lastActivity = clock()
    }

    func activityObserved() { lastActivity = clock() }

    func speechStarted() {
        activityObserved()
        // 这一轮还没结束时，不能把正在用的连接换成新的。
        guard !inFlight else { return }
        if let prepared = next {
            current?.close()
            current = prepared
            next = nil
            completedTurns = 0
            return
        }
        if current == nil || closed(current) {
            let session = makeSession()
            current = session
            let text = instructions()
            Task { await session.prewarm(instructions: text) }
        }
    }

    func turnCompleted() {
        completedTurns += 1
        activityObserved()
        prepareNextIfNeeded()
    }

    func turnInFlight(_ inFlight: Bool) {
        self.inFlight = inFlight
        if !inFlight { prepareNextIfNeeded() }
    }

    func appEnteredForeground() { evaluate() }

    func evaluate() {
        guard !inFlight, let current, !closed(current) else { return }
        if clock().timeIntervalSince(lastActivity) >= idleCloseAfter { current.close() }
    }

    private func prepareNextIfNeeded() {
        guard !inFlight, next == nil, completedTurns >= rotateEveryTurns, current != nil, !closed(current) else { return }
        let session = makeSession()
        next = session
        let text = instructions()
        Task { await session.prewarm(instructions: text) }
    }

    private func closed(_ session: RealtimeSessionProtocol?) -> Bool {
        if case .closed = session?.state { return true }
        return false
    }
}
