import Foundation

/// 笔画差分的事实摘要，不包含原始触控点、OCR、情绪或能力判断。
/// 数值达到上限后饱和，顺序只保留最近 256 项；缺省表示没有本次观察。
struct WorkspaceProcessSignal: Codable, Equatable {
    var eraseCount: Int
    var longestPauseMs: Int
    var strokeOrder: [String]
    static let maxEraseCount = 10_000
    static let maxPauseMs = 3_600_000
    static let maxOrderCount = 256

    var isValid: Bool {
        (0...Self.maxEraseCount).contains(eraseCount)
            && (0...Self.maxPauseMs).contains(longestPauseMs)
            && strokeOrder.count <= Self.maxOrderCount
            && strokeOrder.allSatisfy { $0.count <= 80 && $0.range(of: #"^(stroke|erase):[A-Za-z0-9-]{1,73}$"#, options: .regularExpression) != nil }
    }
}

struct WorkspaceProcessSignalTracker {
    private(set) var snapshot: WorkspaceProcessSignal?
    private var lastEventAt: TimeInterval?

    mutating func reset() { snapshot = nil; lastEventAt = nil }

    /// 停顿仅指相邻画布差分通知的间隔；不能据此判断孩子是否停止思考。
    mutating func record(_ events: [EventPayload], at time: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        var facts = snapshot ?? WorkspaceProcessSignal(eraseCount: 0, longestPauseMs: 0, strokeOrder: [])
        var observed = false
        for event in events {
            let token: String
            let erased: Bool
            switch event {
            case .stroke(let id, _, _): token = "stroke:\(id)"; erased = false
            case .erase(let id, _): token = "erase:\(id)"; erased = true
            default: continue
            }
            guard token.count <= 80, token.range(of: #"^(stroke|erase):[A-Za-z0-9-]{1,73}$"#, options: .regularExpression) != nil else { continue }
            observed = true
            if erased { facts.eraseCount = min(WorkspaceProcessSignal.maxEraseCount, facts.eraseCount + 1) }
            facts.strokeOrder.append(token)
            if facts.strokeOrder.count > WorkspaceProcessSignal.maxOrderCount { facts.strokeOrder.removeFirst() }
        }
        guard observed else { return }
        if time.isFinite, time >= 0 {
            if let previous = lastEventAt, time >= previous {
                let gap = Int(min(Double(WorkspaceProcessSignal.maxPauseMs), (time - previous) * 1000))
                facts.longestPauseMs = max(facts.longestPauseMs, gap)
            }
            if lastEventAt == nil || time >= lastEventAt! { lastEventAt = time }
        }
        snapshot = facts
    }
}
