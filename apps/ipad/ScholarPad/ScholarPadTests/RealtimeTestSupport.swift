import XCTest
@testable import ScholarPad

enum RealtimeTestSupport {
    @MainActor static func gates() throws -> TeachingGates {
        let url = try XCTUnwrap(Bundle(for: TeachingGatesTests.self).url(forResource: "teaching-gates", withExtension: "js"))
        return try TeachingGates(script: String(contentsOf: url, encoding: .utf8))
    }

    static func sampleContext() throws -> GateContext {
        let url = try XCTUnwrap(Bundle(for: TeachingGatesTests.self).url(forResource: "teaching-gates-samples", withExtension: "json"))
        let samples = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        let sample = try XCTUnwrap(samples.first { $0["name"] as? String == "正常通过-小例子" })
        let data = try JSONSerialization.data(withJSONObject: try XCTUnwrap(sample["context"]))
        return try JSONDecoder().decode(GateContext.self, from: data)
    }

    static let passingUtterance = "先只画一段短路，在起点点一个点表示树。"
}

@MainActor
final class FakeTutorAudio: TutorAudioPlaying {
    var said: [String] = []
    var played: [Data] = []
    var began = 0
    var completed = 0
    var stopped = 0
    var diskWrites = 0
    var outputMuted = false
    func beginResponse() { began += 1 }
    func play(_ data: Data) throws { played.append(data) }
    func completeResponse() { completed += 1 }
    func stopPlayback() { stopped += 1 }
    func say(_ text: String) { said.append(text) }
}

@MainActor
final class FakeRealtimeSession: RealtimeSessionProtocol {
    var state: RealtimeState = .ready
    var calls: [String] = []
    var audio: [Data] = []
    var images: [Data] = []
    var cancelled = 0
    var closedReasons: [String] = []
    var prewarmed: [String] = []
    var failCommit = false
    var onTextDelta: ((String) -> Void)?
    var onSpokenDelta: ((String) -> Void)?
    var onAudioDelta: ((Data) -> Void)?
    var onResponseDone: ((RealtimeUsage) -> Void)?
    var onClosed: ((String) -> Void)?

    func prewarm(instructions: String) async { prewarmed.append(instructions); state = .ready; calls.append("prewarm") }
    func beginTurn() { calls.append("begin") }
    func appendAudio(_ pcm16k: Data) { audio.append(pcm16k) }
    func attachImage(_ jpeg: Data) { images.append(jpeg) }
    func commitTurn() async throws {
        calls.append("commit")
        if failCommit || state == .connecting { throw RealtimeSessionError.closed("connectionFailed") }
    }
    func requestHeader(instructions: String) async throws { calls.append("header") }
    func requestReply(instructions: String) async throws { calls.append("reply") }
    func cancelResponse() { cancelled += 1; calls.append("cancel") }
    func close() { closedReasons.append("closed"); state = .closed(reason: "closed"); onClosed?("closed") }

    func emitHeader(_ json: String) {
        onTextDelta?(json)
        onResponseDone?(RealtimeUsage(inputTokens: 2, outputTokens: 2, totalTokens: 4))
    }

    func emitReply(text: String, spoken: String? = nil, audio chunks: [Data]) {
        if let spoken { onSpokenDelta?(spoken) }
        onTextDelta?(text)
        chunks.forEach { onAudioDelta?($0) }
        onResponseDone?(RealtimeUsage(inputTokens: 3, outputTokens: 5, totalTokens: 8))
    }
}
