import Foundation

enum RealtimeState: Equatable { case idle, connecting, ready, closed(reason: String) }

struct RealtimeUsage: Equatable, Codable {
    let inputTokens: Int
    let outputTokens: Int
    let totalTokens: Int
}

@MainActor
protocol RealtimeSessionProtocol: AnyObject {
    var state: RealtimeState { get }
    func prewarm(instructions: String) async
    func beginTurn()
    func appendAudio(_ pcm16k: Data)
    func attachImage(_ jpeg: Data)
    func commitTurn() async throws
    func requestHeader(instructions: String) async throws
    func requestReply(instructions: String) async throws
    func cancelResponse()
    func close()
    var onTextDelta: ((String) -> Void)? { get set }
    var onSpokenDelta: ((String) -> Void)? { get set }
    var onAudioDelta: ((Data) -> Void)? { get set }
    var onResponseDone: ((RealtimeUsage) -> Void)? { get set }
    var onClosed: ((String) -> Void)? { get set }
}

/// 千问实时连接。录音只留在内存队列里，关闭或失败时丢掉，不写文件。
@MainActor
final class RealtimeSession: RealtimeSessionProtocol {
    private(set) var state: RealtimeState = .idle
    var onTextDelta: ((String) -> Void)?
    var onSpokenDelta: ((String) -> Void)?
    var onAudioDelta: ((Data) -> Void)?
    var onResponseDone: ((RealtimeUsage) -> Void)?
    var onClosed: ((String) -> Void)?
    private let url: URL
    private let apiKey: String
    private let transportFactory: (URLRequest) -> any WorkspaceTransport
    private var transport: (any WorkspaceTransport)?
    private var instructions = ""
    private var buffered: [Data] = []
    private var bufferedBytes = 0
    private var images: [Data] = []
    private let maxBufferedBytes = 16_000 * 2 * 60
    private var mode: Mode = .idle
    private var activeResponse: String?
    private var cancelled: Set<String> = []
    private var heldAudio: [(String?, Data)] = []
    /// 已经发出、还没收到 response.created 的请求数。取消时如果还没有 id，就记下要丢掉的下一个 created。
    private var outstanding = 0
    private var cancelledOutstanding = 0
    private var generation = UUID()
    private var sendChain: Task<Void, Never> = Task {}
    private enum Mode { case idle, header, reply }

    init(url: URL, apiKey: String, transportFactory: ((URLRequest) -> any WorkspaceTransport)? = nil) {
        self.url = url
        self.apiKey = apiKey
        self.transportFactory = transportFactory ?? { request in RealtimeSocketTransport(request: request) }
    }

    func prewarm(instructions: String) async {
        if case .ready = state, self.instructions == instructions, transport != nil { return }
        if case .connecting = state, self.instructions == instructions {
            await waitUntilReady()
            return
        }
        self.instructions = instructions
        closeTransport(reason: nil)
        state = .connecting
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let socket = transportFactory(request)
        transport = socket
        let token = generation
        Task { [weak self] in
            guard let self else { return }
            while token == self.generation {
                do {
                    let text = try await socket.receiveText()
                    guard token == self.generation else { return }
                    self.receive(text)
                } catch {
                    guard token == self.generation else { return }
                    self.fail("connectionFailed")
                    return
                }
            }
        }
        await waitUntilReady()
    }

    func beginTurn() { images.removeAll() }

    func appendAudio(_ pcm16k: Data) {
        guard !pcm16k.isEmpty else { return }
        if case .ready = state { sendAudio(pcm16k); return }
        buffered.append(pcm16k)
        bufferedBytes += pcm16k.count
        while bufferedBytes > maxBufferedBytes, !buffered.isEmpty {
            bufferedBytes -= buffered.removeFirst().count
        }
    }

    func attachImage(_ jpeg: Data) { images.append(jpeg) }

    func commitTurn() async throws {
        let token = generation
        while token == generation {
            if case .closed(let reason) = state { throw RealtimeSessionError.closed(reason) }
            if case .ready = state, buffered.isEmpty { break }
            if case .idle = state { throw RealtimeSessionError.closed("idle") }
            try await Task.sleep(for: .milliseconds(10))
        }
        guard token == generation else { throw RealtimeSessionError.closed("replaced") }
        for image in images { send(["type": "input_image_buffer.append", "image": image.base64EncodedString()]) }
        images.removeAll()
        send(["type": "input_audio_buffer.commit"])
        await sendChain.value
    }

    func requestHeader(instructions: String) async throws {
        try ensureReady()
        mode = .header
        activeResponse = nil
        outstanding += 1
        send(["type": "response.create", "response": ["modalities": ["text"], "instructions": instructions]])
        await sendChain.value
    }

    func requestReply(instructions: String) async throws {
        try ensureReady()
        mode = .reply
        activeResponse = nil
        outstanding += 1
        send(["type": "response.create", "response": ["modalities": ["text", "audio"], "instructions": instructions]])
        await sendChain.value
    }

    func cancelResponse() {
        if let activeResponse { cancelled.insert(activeResponse) }
        else if outstanding > cancelledOutstanding { cancelledOutstanding += 1 }
        activeResponse = nil
        heldAudio.removeAll()
        send(["type": "response.cancel"])
    }

    func close() {
        buffered.removeAll()
        bufferedBytes = 0
        images.removeAll()
        heldAudio.removeAll()
        if case .closed = state { return }
        fail("closed")
    }

    private func ensureReady() throws {
        if case .ready = state { return }
        throw RealtimeSessionError.closed("notReady")
    }

    private func waitUntilReady() async {
        let token = generation
        for _ in 0..<500 {
            if token != generation { return }
            if case .ready = state { return }
            if case .closed = state { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        if token == generation, state == .connecting { fail("timeout") }
    }

    private func fail(_ reason: String) {
        let socket = transport
        transport = nil
        generation = UUID()
        outstanding = 0
        cancelledOutstanding = 0
        state = .closed(reason: reason)
        socket?.close()
        onClosed?(reason)
    }

    private func closeTransport(reason: String?) {
        generation = UUID()
        transport?.close()
        transport = nil
        if let reason { state = .closed(reason: reason) }
    }

    /// 按入队顺序发出，避免 commit 跑到还没发出的音频前面。
    private func send(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event), let text = String(data: data, encoding: .utf8) else { return }
        let socket = transport
        sendChain = Task { [sendChain] in
            await sendChain.value
            try? await socket?.sendText(text)
        }
    }

    private func sendAudio(_ pcm: Data) {
        send(["type": "input_audio_buffer.append", "audio": pcm.base64EncodedString()])
    }

    private func receive(_ text: String) {
        guard let data = text.data(using: .utf8), let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = event["type"] as? String else { return }
        if type == "session.created" {
            sendSessionUpdate()
            return
        }
        if type == "session.updated" {
            state = .ready
            let frames = buffered
            buffered.removeAll()
            bufferedBytes = 0
            frames.forEach(sendAudio)
            return
        }
        let responseId = (event["response_id"] as? String) ?? ((event["response"] as? [String: Any])?["id"] as? String)
        if let responseId, cancelled.contains(responseId) { return }
        // 取消发生在 response.created 之前时，这条响应还没有 id。它的文字和声音先到也要丢掉。
        if activeResponse == nil, cancelledOutstanding > 0, type != "response.created" { return }
        if type == "response.created" {
            if outstanding > 0 { outstanding -= 1 }
            guard let responseId else { return }
            if cancelledOutstanding > 0 {
                cancelledOutstanding -= 1
                cancelled.insert(responseId)
                return
            }
            guard !cancelled.contains(responseId) else { return }
            activeResponse = responseId
            if mode == .reply {
                let waiting = heldAudio
                heldAudio.removeAll()
                for (id, audio) in waiting where id == nil || id == responseId { onAudioDelta?(audio) }
            } else { heldAudio.removeAll() }
            return
        }
        if type == "response.audio.delta", let delta = event["delta"] as? String, let audio = Data(base64Encoded: delta) {
            // 头部只要文字。这段声音属于头部或已取消的响应时直接丢掉。
            guard mode == .reply else { return }
            if activeResponse == nil { heldAudio.append((responseId, audio)); return }
            if let responseId, responseId != activeResponse { return }
            onAudioDelta?(audio)
            return
        }
        if type == "response.text.delta" || type == "response.audio_transcript.delta", let delta = event["delta"] as? String {
            if let responseId, let activeResponse, responseId != activeResponse { return }
            if activeResponse == nil, mode == .idle { return }
            if type == "response.audio_transcript.delta" { onSpokenDelta?(delta) }
            else { onTextDelta?(delta) }
            return
        }
        if type == "response.done" {
            if let responseId, let activeResponse, responseId != activeResponse { return }
            let usage = (event["response"] as? [String: Any])?["usage"] as? [String: Any]
            let input = usage?["input_tokens"] as? Int ?? 0
            let output = usage?["output_tokens"] as? Int ?? 0
            let total = usage?["total_tokens"] as? Int ?? input + output
            onResponseDone?(RealtimeUsage(inputTokens: input, outputTokens: output, totalTokens: total))
            activeResponse = nil
            mode = .idle
        }
    }

    private func sendSessionUpdate() {
        send([
            "type": "session.update",
            "session": [
                "modalities": ["text", "audio"],
                "voice": "Tina",
                "turn_detection": NSNull(),
                "audio": [
                    "input": ["format": ["type": "pcm", "sample_rate": 16000]],
                    "output": ["format": ["type": "pcm", "sample_rate": 24000]],
                ],
                "instructions": instructions,
            ],
        ])
    }
}

enum RealtimeSessionError: Error { case closed(String) }

@MainActor
private final class RealtimeSocketTransport: WorkspaceTransport {
    private let task: URLSessionWebSocketTask
    init(request: URLRequest) { task = URLSession.shared.webSocketTask(with: request); task.resume() }
    func sendText(_ text: String) async throws { try await task.send(.string(text)) }
    func sendPCM(_ data: Data) async throws { try await task.send(.data(data)) }
    func receiveText() async throws -> String {
        while true { if case .string(let text) = try await task.receive() { return text } }
    }
    func close() { task.cancel(with: .goingAway, reason: nil) }
}
