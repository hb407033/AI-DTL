import Foundation

enum ProactiveReason: Equatable { case idleWithNewInk, newResultNumber(String) }

/// 老师主动开口。没有新笔迹不说话；同一题最多三次，两次之间至少两分钟。
@MainActor
final class ProactivePrompter {
    var onPrompt: ((ProactiveReason) -> Void)?
    private let idleAfter: TimeInterval
    private let minInterval: TimeInterval
    private let maxPerProblem: Int
    private let clock: () -> Date
    private var hasNewInk = false
    private var lastChildSpeech: Date
    private var lastPrompt: Date?
    private var promptsThisProblem = 0
    private var announcedNumbers: Set<String> = []

    init(idleAfter: TimeInterval = 40, minInterval: TimeInterval = 120, maxPerProblem: Int = 3, clock: @escaping () -> Date = Date.init) {
        self.idleAfter = idleAfter
        self.minInterval = minInterval
        self.maxPerProblem = maxPerProblem
        self.clock = clock
        self.lastChildSpeech = clock()
    }

    func inkChanged() { hasNewInk = true }
    func childSpoke() { lastChildSpeech = clock(); hasNewInk = false }
    func problemChanged() {
        promptsThisProblem = 0
        announcedNumbers.removeAll()
        hasNewInk = false
        lastPrompt = nil
    }

    func newResultNumberSeen(_ number: String) {
        guard !announcedNumbers.contains(number), allow() else { return }
        announcedNumbers.insert(number)
        fire(.newResultNumber(number))
    }

    func tick() {
        guard hasNewInk, clock().timeIntervalSince(lastChildSpeech) >= idleAfter, allow() else { return }
        hasNewInk = false
        fire(.idleWithNewInk)
    }

    private func allow() -> Bool {
        if promptsThisProblem >= maxPerProblem { return false }
        if let lastPrompt, clock().timeIntervalSince(lastPrompt) < minInterval { return false }
        return true
    }

    private func fire(_ reason: ProactiveReason) {
        promptsThisProblem += 1
        lastPrompt = clock()
        onPrompt?(reason)
    }
}
