import Foundation
import Combine
import AVFoundation

/// 分数学习练习模式客户端（2026-09-17 批准设计，工作包 C）。
/// 与 SimpleTutor 自由连续聊天完全隔离：只有按钮/明确语音意图确认后的 submit/requestHelp 信封
/// 才会让宿主发起教学响应；本客户端绝不把停顿、笔迹变化翻译成任何命令。
/// 打断/异议/切题后，迟到的音频与图形事件按 responseId/submissionId 丢弃。

@MainActor
protocol LearningTransport: AnyObject {
    var onMessage: ((String) -> Void)? { get set }
    var onClose: (() -> Void)? { get set }
    func send(_ text: String)
    func close()
}

/// 正式传输：宿主 /tutor/learning 的 WebSocket。
final class LearningWebSocketTransport: LearningTransport {
    var onMessage: ((String) -> Void)?
    var onClose: (() -> Void)?
    private let task: URLSessionWebSocketTask
    private var closed = false

    init(url: URL) {
        task = URLSession.shared.webSocketTask(with: url)
        task.resume()
        Task { [weak self] in await self?.receiveLoop() }
    }

    private func receiveLoop() async {
        while !closed {
            do {
                let message = try await task.receive()
                if case .string(let text) = message { onMessage?(text) }
            } catch {
                if !closed { closed = true; onClose?() }
                return
            }
        }
    }

    func send(_ text: String) {
        task.send(.string(text)) { _ in }
    }

    func close() {
        closed = true
        task.cancel(with: .goingAway, reason: nil)
    }
}

@MainActor
final class LearningSessionClient: ObservableObject {
    struct BoardAction: Equatable {
        enum Command: Equatable {
            case showHintRectangle(id: String, wholeGroupId: String, rows: Int, columns: Int, shadedCells: [Int])
            case highlightCells(objectId: String, cells: [Int])
            case hideHint(objectId: String)
        }
        var responseId: String?
        var submissionId: String
        var boardRevision: Int
        var command: Command
    }

    /// ready 事件全貌：restored=true 表示宿主从存档恢复，界面应先展示「上次停在这里」，不做任何云端动作。
    struct ReadyInfo: Equatable {
        var sessionId: String
        var revision: Int
        var phase: String
        var challengeId: String
        var prompt: String
        var restored: Bool
        var packVersion: String
    }

    /// accepted 事件摘要：视图层据此推进按钮状态机（如提交完成后才允许「开始迁移」）。
    struct AcceptedInfo: Equatable {
        var command: String
        var revision: Int
        var phase: String
        var submissionId: String?
    }

    enum VoiceIntent: String {
        case submit
        case help
    }

    @Published private(set) var status = "未连接。"
    @Published private(set) var phase = ""
    @Published private(set) var revision = 0
    @Published private(set) var sessionId: String?
    @Published private(set) var reply = ""
    @Published private(set) var lastFeedbackId: String?
    @Published private(set) var connected = false
    @Published private(set) var prompt = ""
    @Published private(set) var challengeId = ""
    @Published private(set) var restored = false
    @Published private(set) var packVersion = ""

    /// 图形动作回调：只有宿主校验通过、且绑定当前提交的动作才会到达这里。
    var onBoardAction: ((BoardAction) -> Void)?
    /// 语音明确意图回调：只通知，绝不自动提交；由界面要求孩子/家长确认后再走按钮路径。
    var onVoiceIntent: ((VoiceIntent, String) -> Void)?
    /// ready / accepted 的结构化回调，供视图层做恢复决策与状态机推进。
    var onReady: ((ReadyInfo) -> Void)?
    var onAccepted: ((AcceptedInfo) -> Void)?

    private var transport: LearningTransport?
    private let makeTransport: (URL) -> LearningTransport
    private let audioPlayback: ((Data) throws -> Void)?
    private var blockedResponseIds = Set<String>()
    private var activeResponseId: String?
    private var currentSubmissionId: String?
    private var eventSeq = 0
    private var playback: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var playbackID = UUID()
    private let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!

    init(makeTransport: @escaping (URL) -> LearningTransport = { LearningWebSocketTransport(url: $0) },
         audioPlayback: ((Data) throws -> Void)? = nil) {
        self.makeTransport = makeTransport
        self.audioPlayback = audioPlayback
    }

    /// 连接后立即发 hello：带 sessionId 表示请求恢复既有会话，不带表示新会话。
    func connect(host: String, port: Int = 8791, sessionId resumeSessionId: String? = nil) {
        stop()
        guard let url = URL(string: "ws://\(host.trimmingCharacters(in: .whitespacesAndNewlines)):\(port)/tutor/learning"), url.host != nil else {
            status = "请填写有效的 Mac 地址"
            return
        }
        let transport = makeTransport(url)
        self.transport = transport
        status = "连接学习服务中…"
        transport.onMessage = { [weak self] text in self?.handleIncoming(text) }
        transport.onClose = { [weak self] in
            guard let self, self.transport != nil else { return }
            self.stop()
            self.status = "连接中断，画布仍保留；可重新连接。"
        }
        var hello: [String: Any] = ["type": "hello"]
        if let resumeSessionId { hello["sessionId"] = resumeSessionId }
        if let data = try? JSONSerialization.data(withJSONObject: hello) {
            transport.send(String(decoding: data, as: UTF8.self))
        }
    }

    // MARK: 主动命令（仅这 7 种信封 + 播放控制 interrupt，与契约一致）

    /// 按钮提交：冻结证据（submissionId + boardRevision + 快照与结构化画布）后上行。
    func submit(challengeId: String, boardRevision: Int, image: String, board: [String: Any]) {
        let submissionId = "sub-\(UUID().uuidString)"
        sendEnvelope(type: "submit", submissionId: submissionId,
                     payload: ["challengeId": challengeId, "boardRevision": boardRevision],
                     extra: ["image": image, "board": board])
    }

    func requestHelp(challengeId: String) {
        sendEnvelope(type: "requestHelp", payload: ["challengeId": challengeId])
    }

    /// 「你理解错了」：本地立即屏蔽在播响应，信封由宿主走同一取消路径。
    func contest(feedbackId: String) {
        blockActiveResponse()
        sendEnvelope(type: "contest", payload: ["feedbackId": feedbackId])
    }

    func startTransfer(challengeId: String) {
        sendEnvelope(type: "startTransfer", payload: ["challengeId": challengeId])
    }

    func pause() { sendEnvelope(type: "pause", payload: [:]) }
    func resume() { sendEnvelope(type: "resume", payload: [:]) }
    func finishSession(reason: String) { sendEnvelope(type: "finishSession", payload: ["reason": reason]) }

    /// 按钮打断：停本地播放 + 通知宿主取消生成 + 屏蔽旧响应片段。
    func interrupt() {
        blockActiveResponse()
        transport?.send(#"{"type":"interrupt"}"#)
    }

    func stop() {
        blockActiveResponse()
        activeResponseId = nil
        transport?.close()
        transport = nil
        stopPlayback()
        sessionId = nil
        currentSubmissionId = nil
        lastFeedbackId = nil
        revision = 0
        phase = ""
        connected = false
        prompt = ""
        challengeId = ""
        restored = false
        packVersion = ""
        status = "已停止，画布保留。"
    }

    // MARK: 宿主事件

    func handleIncoming(_ text: String) {
        guard transport != nil else { return } // 停止后迟到事件一律不处理
        guard let data = text.data(using: .utf8),
              let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = event["type"] as? String else { return }
        switch type {
        case "ready":
            sessionId = event["sessionId"] as? String
            revision = event["revision"] as? Int ?? 0
            phase = event["phase"] as? String ?? ""
            challengeId = event["challengeId"] as? String ?? ""
            prompt = event["prompt"] as? String ?? ""
            restored = event["restored"] as? Bool ?? false
            packVersion = event["packVersion"] as? String ?? ""
            connected = true
            status = "已连接。先自己想一想，准备好再提交。"
            if let sessionId {
                onReady?(ReadyInfo(sessionId: sessionId, revision: revision, phase: phase,
                                   challengeId: challengeId, prompt: prompt, restored: restored, packVersion: packVersion))
            }
        case "accepted":
            // 信封 revision 校验：只接受严格前进一步的确认；重复、倒退或跳跃都不改变本地状态。
            guard let newRevision = event["revision"] as? Int, newRevision > revision else { return }
            guard newRevision == revision + 1 else { status = "与主机进度不同步，请停止后重连。"; return }
            revision = newRevision
            phase = event["phase"] as? String ?? phase
            let command = event["command"] as? String
            if command == "submit" { currentSubmissionId = event["submissionId"] as? String }
            if command == "startTransfer" || command == "contest" || command == "finishSession" { currentSubmissionId = nil }
            if let command {
                onAccepted?(AcceptedInfo(command: command, revision: newRevision, phase: phase,
                                         submissionId: event["submissionId"] as? String))
            }
        case "rejected":
            status = "这次操作没有被接受（\(event["reason"] as? String ?? "未知原因")），画布内容未变。"
        case "audio":
            guard let responseId = event["responseId"] as? String, !blockedResponseIds.contains(responseId),
                  let base64 = event["data"] as? String, let audio = Data(base64Encoded: base64) else { return }
            activeResponseId = responseId
            receiveAudio(audio)
        case "text":
            guard let responseId = event["responseId"] as? String, !blockedResponseIds.contains(responseId) else { return }
            reply += event["text"] as? String ?? ""
        case "action":
            // 迟到图形事件：被屏蔽的响应、或不属于当前提交的动作一律丢弃（切题/异议后旧画布不得改变）。
            if let responseId = event["responseId"] as? String, blockedResponseIds.contains(responseId) { return }
            guard let submissionId = event["submissionId"] as? String, submissionId == currentSubmissionId,
                  let boardRevision = event["boardRevision"] as? Int,
                  let rawCommand = event["command"] as? [String: Any],
                  let command = Self.decodeCommand(rawCommand) else { return }
            onBoardAction?(BoardAction(responseId: event["responseId"] as? String,
                                       submissionId: submissionId,
                                       boardRevision: boardRevision,
                                       command: command))
        case "feedback":
            guard let feedbackId = event["feedbackId"] as? String else { return }
            lastFeedbackId = feedbackId
        case "responseDone":
            if activeResponseId == event["responseId"] as? String { activeResponseId = nil }
        case "interrupted":
            if let responseId = event["responseId"] as? String { blockedResponseIds.insert(responseId) }
            stopPlayback()
        case "voiceIntent":
            // 语音「我做好了」只到这里：通知界面，由孩子/家长确认后走按钮提交，绝不自动发信封。
            guard let raw = event["intent"] as? String, let intent = VoiceIntent(rawValue: raw) else { return }
            onVoiceIntent?(intent, event["transcript"] as? String ?? "")
        case "error":
            let message = event["message"] as? String ?? "连接失败"
            stop()
            status = message
        default:
            break
        }
    }

    // MARK: 内部

    private func sendEnvelope(type: String, submissionId: String? = nil, payload: [String: Any], extra: [String: Any] = [:]) {
        guard let transport, let sessionId else { return }
        eventSeq += 1
        var envelope: [String: Any] = [
            "schemaVersion": 1,
            "sessionId": sessionId,
            "eventId": "ipad-\(eventSeq)-\(UUID().uuidString)",
            "revision": revision,
            "type": type,
            "payload": payload,
        ]
        if let submissionId { envelope["submissionId"] = submissionId }
        for (key, value) in extra { envelope[key] = value }
        guard let data = try? JSONSerialization.data(withJSONObject: envelope) else { return }
        transport.send(String(decoding: data, as: UTF8.self))
    }

    private func blockActiveResponse() {
        if let activeResponseId { blockedResponseIds.insert(activeResponseId) }
        stopPlayback()
    }

    private static func decodeCommand(_ raw: [String: Any]) -> BoardAction.Command? {
        guard let type = raw["type"] as? String else { return nil }
        switch type {
        case "showHintRectangle":
            guard let rect = raw["rectangle"] as? [String: Any],
                  let id = rect["id"] as? String,
                  let wholeGroupId = rect["wholeGroupId"] as? String,
                  let rows = rect["rows"] as? Int,
                  let columns = rect["columns"] as? Int,
                  let shadedCells = rect["shadedCells"] as? [Int] else { return nil }
            return .showHintRectangle(id: id, wholeGroupId: wholeGroupId, rows: rows, columns: columns, shadedCells: shadedCells)
        case "highlightCells":
            guard let objectId = raw["objectId"] as? String, let cells = raw["cells"] as? [Int] else { return nil }
            return .highlightCells(objectId: objectId, cells: cells)
        case "hideHint":
            guard let objectId = raw["objectId"] as? String else { return nil }
            return .hideHint(objectId: objectId)
        default:
            return nil
        }
    }

    // MARK: 音频播放（与 SimpleTutor 同一 24kHz PCM16 播放样式；测试经 audioPlayback 注入）

    private func receiveAudio(_ data: Data) {
        do {
            if let audioPlayback { try audioPlayback(data) } else { try play(data) }
        } catch {
            stopPlayback()
            status = "声音播放失败，连接仍保留，可阅读文字。"
        }
    }

    private func play(_ data: Data) throws {
        guard data.count % 2 == 0, data.count > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: AVAudioFrameCount(data.count / 2)) else { return }
        buffer.frameLength = buffer.frameCapacity
        let bytes = [UInt8](data)
        for i in 0..<Int(buffer.frameLength) {
            let raw = UInt16(bytes[i * 2]) | UInt16(bytes[i * 2 + 1]) << 8
            buffer.floatChannelData![0][i] = Float(Int16(bitPattern: raw)) / 32768
        }
        if playback == nil {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            let engine = AVAudioEngine()
            let node = AVAudioPlayerNode()
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: outputFormat)
            try engine.start()
            playback = engine
            player = node
        }
        let id = playbackID
        player?.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { @Sendable [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.playbackID == id else { return }
            }
        }
        if player?.isPlaying == false { player?.play() }
    }

    private func stopPlayback() {
        playbackID = UUID()
        player?.stop()
        playback?.stop()
        player = nil
        playback = nil
    }
}
