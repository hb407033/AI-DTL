import Foundation

/// 临时实时连接只负责把慢路径改写后的句子读出来。它不复用正在对话的那条连接，取消后晚到的声音不再收集。
@MainActor
enum RealtimeSpeechSynthesis {
    static func speak(_ text: String, credentialURL: URL, apiKey: String, timeout: Duration = .seconds(45),
                      tally: TokenTally? = nil, makeSession: (URL, String) -> RealtimeSession) async throws -> (pcm: Data, spoken: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { throw ThinkingTextError.invalidInstructions }
        guard credentialURL.scheme == "wss", credentialURL.user == nil else { throw ThinkingTextError.insecureEndpoint }
        let instructions = "只逐字读这句话：\(trimmed)"
        let session = makeSession(credentialURL, apiKey)
        let box = SpeechCollect()
        session.onAudioDelta = { if box.open { box.pcm.append($0) } }
        session.onSpokenDelta = { if box.open { box.spoken += $0 } }
        session.onResponseDone = { usage in
            tally?.slowSpeech += usage.totalTokens
            box.finish()
        }
        defer {
            box.open = false
            session.onAudioDelta = nil
            session.onSpokenDelta = nil
            session.onResponseDone = nil
            session.cancelResponse()
            session.close()
        }
        let worker = Task { @MainActor in
            try await withTaskCancellationHandler {
                await session.prewarm(instructions: instructions)
                try Task.checkCancellation()
                guard case .ready = session.state else { throw RealtimeSessionError.closed("notReady") }
                try await session.requestReply(instructions: instructions)
                try await box.wait()
            } onCancel: {
                Task { @MainActor in box.fail() }
            }
        }
        let timer = Task {
            try await Task.sleep(for: timeout)
            worker.cancel()
        }
        try await withTaskCancellationHandler {
            do {
                try await worker.value
                timer.cancel()
            } catch {
                timer.cancel()
                if error is CancellationError, !Task.isCancelled { throw ThinkingTextError.timedOut }
                throw error
            }
        } onCancel: {
            worker.cancel()
            timer.cancel()
        }
        try Task.checkCancellation()
        guard box.finished else { throw ThinkingTextError.incomplete }
        return (box.pcm, box.spoken)
    }
}

@MainActor
private final class SpeechCollect {
    var open = true
    var pcm = Data()
    var spoken = ""
    private(set) var finished = false
    private var continuation: CheckedContinuation<Void, Error>?

    func wait() async throws {
        if finished { return }
        try await withCheckedThrowingContinuation { continuation = $0 }
    }

    func finish() {
        guard !finished else { return }
        finished = true
        continuation?.resume()
        continuation = nil
    }

    func fail() {
        guard !finished else { return }
        open = false
        finished = true
        continuation?.resume(throwing: CancellationError())
        continuation = nil
    }
}
