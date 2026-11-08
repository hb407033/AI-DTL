import Foundation

enum SlowPathResult: Equatable {
    case spoken(utterance: String, pcm: Data)
    case failed(code: String)
}

/// 一轮慢路径的取消代。取消、卸载或超时后，旧的文字和声音都不能再回来播放。
@MainActor
final class SlowPathLifetime {
    private(set) var token = 0
    private var hooks: [() -> Void] = []
    func addCancel(_ hook: @escaping () -> Void) { hooks.append(hook) }
    func cancel() {
        token += 1
        let pending = hooks
        pending.forEach { $0() }
    }
    func isCurrent(_ token: Int) -> Bool { token == self.token }
}

/// 慢路径只负责把 JS 的决定说出来。网络和合成都由外面注入，失败变成结果，不把异常抛进界面。
@MainActor
final class SlowPath {
    private let gates: TeachingGates
    private let requestText: (String, Data?) async throws -> String
    private let speak: (String) async throws -> (pcm: Data, spoken: String)
    let lifetime: SlowPathLifetime

    init(gates: TeachingGates,
         requestText: @escaping (String, Data?) async throws -> String,
         speak: @escaping (String) async throws -> (pcm: Data, spoken: String),
         lifetime: SlowPathLifetime = SlowPathLifetime()) {
        self.gates = gates
        self.requestText = requestText
        self.speak = speak
        self.lifetime = lifetime
    }

    func token() -> Int { lifetime.token }
    func isCurrent(_ token: Int) -> Bool { lifetime.isCurrent(token) }
    func cancel() { lifetime.cancel() }

    func run(context: GateContext, rejectedReason: String) async -> SlowPathResult {
        let ticket = lifetime.token
        guard isCurrent(ticket), !Task.isCancelled else { return .failed(code: "cancelled") }
        var spokenPCM = Data()
        do {
            let raw = try await gates.decideSlow(context: context, rejectedReason: rejectedReason, requestText: requestText) { text in
                guard self.isCurrent(ticket), !Task.isCancelled else { throw CancellationError() }
                let spoken = try await self.speak(text)
                guard self.isCurrent(ticket), !Task.isCancelled else { throw CancellationError() }
                spokenPCM = spoken.pcm
                return (ok: true, spoken: spoken.spoken)
            }
            guard isCurrent(ticket), !Task.isCancelled else { return .failed(code: "cancelled") }
            guard let data = raw.data(using: .utf8),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .failed(code: "invalidResult") }
            if json["ok"] as? Bool == true, let utterance = json["utterance"] as? String, !utterance.isEmpty {
                return .spoken(utterance: utterance, pcm: spokenPCM)
            }
            return .failed(code: json["code"] as? String ?? json["reason"] as? String ?? "slowPathFailed")
        } catch {
            if !isCurrent(ticket) || Task.isCancelled || error is CancellationError { return .failed(code: "cancelled") }
            return .failed(code: "slowPathFailed")
        }
    }
}
