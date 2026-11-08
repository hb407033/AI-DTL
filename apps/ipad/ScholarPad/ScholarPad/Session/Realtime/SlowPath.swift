import Foundation

enum SlowPathResult: Equatable {
    case spoken(utterance: String, pcm: Data)
    case failed(code: String)
}

/// 慢路径只负责把 JS 的决定说出来。网络和合成都由外面注入，失败变成结果，不把异常抛进界面。
@MainActor
final class SlowPath {
    private let gates: TeachingGates
    private let requestText: (String, Data?) async throws -> String
    private let speak: (String) async throws -> (pcm: Data, spoken: String)

    init(gates: TeachingGates,
         requestText: @escaping (String, Data?) async throws -> String,
         speak: @escaping (String) async throws -> (pcm: Data, spoken: String)) {
        self.gates = gates
        self.requestText = requestText
        self.speak = speak
    }

    func run(context: GateContext, rejectedReason: String) async -> SlowPathResult {
        var spokenPCM = Data()
        do {
            let raw = try await gates.decideSlow(context: context, rejectedReason: rejectedReason, requestText: requestText) { text in
                let spoken = try await self.speak(text)
                spokenPCM = spoken.pcm
                return (ok: true, spoken: spoken.spoken)
            }
            guard let data = raw.data(using: .utf8),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .failed(code: "invalidResult") }
            if json["ok"] as? Bool == true, let utterance = json["utterance"] as? String, !utterance.isEmpty {
                return .spoken(utterance: utterance, pcm: spokenPCM)
            }
            return .failed(code: json["code"] as? String ?? json["reason"] as? String ?? "slowPathFailed")
        } catch {
            return .failed(code: "slowPathFailed")
        }
    }
}
