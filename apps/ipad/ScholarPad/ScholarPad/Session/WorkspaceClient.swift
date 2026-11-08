import SwiftUI

@MainActor
protocol WorkspaceTransport: AnyObject {
    func sendText(_ text: String) async throws
    func sendPCM(_ data: Data) async throws
    func receiveText() async throws -> String
    func close()
}

@MainActor
private final class WorkspaceSocketTransport: WorkspaceTransport {
    private let task: URLSessionWebSocketTask
    init(url: URL) { task = URLSession.shared.webSocketTask(with: url); task.resume() }
    func sendText(_ text: String) async throws { try await task.send(.string(text)) }
    func sendPCM(_ data: Data) async throws { try await task.send(.data(data)) }
    func receiveText() async throws -> String {
        while true { if case .string(let text) = try await task.receive() { return text } }
    }
    func close() { task.cancel(with: .goingAway, reason: nil) }
}

@MainActor
final class WorkspaceClient: ObservableObject {
    enum Recovery { case retry, host }
    @Published private(set) var recovery: Recovery?
    struct Message: Identifiable {
        let id: String
        let role: String
        var text: String
        var contested = false
    }
    @Published private(set) var messages: [Message] = []
    @Published private(set) var connected = false
    @Published private(set) var listening = false
    @Published private(set) var working = false
    @Published private(set) var transcript = ""
    @Published private(set) var reply = ""
    @Published private(set) var status = "你先独立想一想。需要时可以开启对话。"
    @Published private(set) var completedTurns = 0
    @Published private(set) var thinking = false
    /// 麦克风音量分 0…5 档，界面声波用；分档避免每帧刷新界面。
    @Published private(set) var micLevel = 0
    var record: (() -> WorkspaceRecord?)?
    var acceptRecord: ((WorkspaceRecord) throws -> Void)?
    var evidence: ((String) async throws -> WorkspaceEvidence)?
    var acceptScaffold: ((LineScaffoldJournal) -> Void)?
    private let audio = TutorAudioIO()
    /// 本机短应答，轮换使用；不含教学内容，不替老师表态对错。
    static let acknowledgements = ["嗯，我想想。", "好，我看看。", "嗯，让我想一下。", "好，我来看一看。"]
    private var acknowledgementIndex = 0
    private func acknowledge() {
        let text = Self.acknowledgements[acknowledgementIndex % Self.acknowledgements.count]
        acknowledgementIndex += 1
        if let speakPrompt { speakPrompt(text) } else { audio.say(text) }
    }
    static let mutedNotice = "iPad 音量是 0，听不到老师说话。按侧面的音量加键调大。"
    private var socket: (any WorkspaceTransport)?
    private let transportFactory: (URL) -> any WorkspaceTransport
    private var generation = UUID()
    private var turnId: String?
    private var responseId: String?
    private var rearm: Task<Void, Never>?
    /// 本机说一句短提示；默认用本机语音合成，测试可替换。
    var speakPrompt: ((String) -> Void)?
    private var continuous = false
    private var awaitingAuthorization = false
    private var withoutMicrophone = false
    private var discussionRequested = false
    private var correctionOnly: String?
    private var ending = false
    private var interruptionAcknowledged = false
    private var interruptingReply = false
    private var interruptAccepted = false
    private var pendingSpeech: Data?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempts = 0
    private var operation = UUID()
    private var turnSubmitted = false
    private var connectionSettings: (url: URL, mode: String?, sessionId: String, problem: WorkspaceProblem)?
    private var latestExpression: (problemId: String, revision: Int, text: String)?
    var canAuthorize: Bool { connected && awaitingAuthorization && !working }

    init(transportFactory: ((URL) -> any WorkspaceTransport)? = nil) {
        self.transportFactory = transportFactory ?? { url in
            var target = url
            #if DEBUG
            if ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_TEST_ID"].flatMap(UUID.init(uuidString:)) != nil,
               let raw = ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_HTTP_PORT"], let port = Int(raw), (1024...65535).contains(port),
               var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
                components.port = port
                if let rewritten = components.url { target = rewritten }
            }
            #endif
            return WorkspaceSocketTransport(url: target)
        }
        audio.onTurn = { [weak self] pcm in self?.submitPCM(pcm) }
        audio.onLevel = { [weak self] rms in
            // 说话时 RMS 约 0.02–0.2；开方拉开低音量区分度。
            let level = min(5, Int((sqrt(rms) * 12).rounded()))
            if self?.micLevel != level { self?.micLevel = level }
        }
        audio.onSpeechStart = { [weak self] in
            guard let self, self.working || self.thinking else { return }
            self.interruptReply(preservingSpeech: true)
        }
        audio.onDrained = { [weak self] in
            guard let self, self.connected else { return }
            self.working = false; self.thinking = false; self.completedTurns += 1
            // iPad 音量为 0 时声音照常播完却听不见（2026-11-08 真机：outputVolume=0）；提示留在屏幕上，不被“轮到你了”盖掉。
            if self.audio.outputMuted { self.status = Self.mutedNotice; self.scheduleListening(preservingStatus: true) }
            else { self.scheduleListening() }
        }
        audio.onError = { [weak self] message in self?.pause(); self?.recovery = .retry; self?.status = message }
    }
    func connect(host: String, microphone: Bool = true, conversationMode: String? = nil, leadDiscussion: Bool = false) {
        pause()
        guard let record = record?(), record.problem?.statement.confirmed == true,
              !host.contains("/"), !host.contains("@"), let url = URL(string: "ws://\(host):8791/tutor/workspace?voiceRecovery=1") else {
            status = "请先核对题意和主机地址。"; return
        }
        continuous = true; withoutMicrophone = !microphone
        reconnectAttempts = 0
        connectionSettings = (url, conversationMode, record.sessionId, record.problem!)
        discussionRequested = leadDiscussion && conversationMode == "dialogue"
        openConnection()
    }
    private func openConnection() {
        guard let settings = connectionSettings, continuous else { return }
        let id = generation, task = transportFactory(settings.url)
        socket = task; status = "正在连接学习主机…"
        Task { [weak self] in
            guard let self else { return }
            do {
                guard id == self.generation, self.continuous else { return }
                var hello: [String: Any] = ["type": "hello", "sessionId": settings.sessionId]
                if settings.mode == "dialogue" { hello["conversationMode"] = "dialogue" }
                try await self.send(hello)
                while id == self.generation {
                    let text = try await task.receiveText()
                    guard id == self.generation else { return }
                    if let data = text.data(using: .utf8),
                       let event = try JSONSerialization.jsonObject(with: data) as? [String: Any] { self.receive(event) }
                }
            } catch { if id == self.generation { self.recoverConnection() } }
        }
    }
    private func recoverConnection() {
        guard continuous, !ending, let settings = connectionSettings,
              let current = record?(), current.sessionId == settings.sessionId, current.problem == settings.problem else { fail(); return }
        guard reconnectAttempts < 2 else { fail(); status = "暂时连不上老师，原稿保留。点“重试对话”再试。"; return }
        reconnectAttempts += 1
        generation = UUID(); operation = UUID(); turnSubmitted = false
        rearm?.cancel(); reconnectTask?.cancel(); audio.stop(); socket?.close(); socket = nil
        connected = false; listening = false; working = false; thinking = false
        turnId = nil; responseId = nil; awaitingAuthorization = false; interruptingReply = false; interruptAccepted = false; pendingSpeech = nil
        discussionRequested = false // 只恢复通道，不重复开场或重发上一轮音频。
        status = "连接恢复中…（\(reconnectAttempts)/2）"
        let id = generation, delay = reconnectAttempts == 1 ? 350 : 900
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(delay))
            guard !Task.isCancelled, let self, self.generation == id, self.continuous, !self.ending else { return }
            self.openConnection()
        }
    }
    private func startDiscussion() {
        guard connected, !ending, let current = record?(), let problem = current.problem else { return }
        discussionRequested = false; working = true; listening = false
        operation = UUID(); turnSubmitted = false
        let turn = UUID().uuidString; turnId = turn; responseId = nil; thinking = false
        let id = generation, op = operation
        status = "老师正在看题目和已有解答，准备一起核对…"
        Task {
            do {
                guard let evidence else { throw WorkspaceError.unavailable }
                let frozen = try await evidence("")
                guard id == generation, op == operation, !ending, let latest = record?() else { return }
                guard latest.problem == problem else { throw WorkspaceError.invalidRecord }
                let snapshot = try JSONSerialization.jsonObject(with: JSONEncoder().encode(frozen))
                turnSubmitted = true
                try await send(envelope("startDiscussion", record: latest, extra: ["turnId": turn, "evidence": snapshot]))
            } catch { if id == generation, op == operation { turnFailed(error) } }
        }
    }
    func submitPCM(_ pcm: Data) {
        if connected, !ending, interruptingReply, !pcm.isEmpty, pcm.count <= 960000 {
            // 取消回执前仅在本机保留一轮新插话，不交给旧回合、也不自动重发旧录音。
            if pendingSpeech == nil { pendingSpeech = pcm }
            return
        }
        guard connected, !ending, !working, !pcm.isEmpty, pcm.count <= 960000, let record = record?(), let problem = record.problem else { return }
        rearm?.cancel(); audio.resetInput(); working = true; awaitingAuthorization = false
        operation = UUID(); turnSubmitted = false
        let turn = UUID().uuidString; turnId = turn; responseId = nil; thinking = false
        let id = generation, op = operation
        status = "正在听取你的想法；尚未授权讲解。"
        Task {
            do {
                guard id == generation, op == operation, !ending else { return }
                turnSubmitted = true
                try await send(envelope("voiceStart", record: record, extra: ["turnId": turn, "problemId": problem.problemId]))
                guard let socket else { throw WorkspaceError.unavailable }
                for offset in stride(from: 0, to: pcm.count, by: 3200) {
                    guard id == generation, op == operation, !ending else { return }
                    try await socket.sendPCM(pcm.subdata(in: offset..<min(offset + 3200, pcm.count)))
                }
                guard id == generation, op == operation, !ending else { return }
                try await send(envelope("voiceEnd", record: record, extra: ["turnId": turn, "problemId": problem.problemId]))
            } catch { if id == generation, op == operation { turnFailed(error) } }
        }
    }
    func correctLastFeedback(host: String) {
        guard !ending, !interruptingReply, let feedback = record?()?.feedback.last else { return }
        if feedback.contested { status = "这条反馈已标记为有异议。"; return }
        if connected { authorize("correct"); return }
        connect(host: host, microphone: false)
        correctionOnly = feedback.responseId
        status = "正在记录你对上次反馈的异议；不会打开麦克风。"
    }
    func interruptReply(preservingSpeech: Bool = false) {
        guard connected, !ending, !interruptingReply, (working || thinking),
              let turnId, let current = record?() else { return }
        rearm?.cancel(); audio.stopPlayback()
        if !preservingSpeech { audio.resetInput() }
        operation = UUID()
        if !turnSubmitted {
            working = false; thinking = false; self.turnId = nil; responseId = nil; awaitingAuthorization = false
            discussionRequested = false; status = "好，你先说。"; scheduleListening()
            return
        }
        thinking = false; responseId = nil; awaitingAuthorization = false; interruptingReply = true
        interruptAccepted = false; pendingSpeech = nil
        status = "老师已停声，正在取消这次回复…"
        let id = generation
        Task {
            do {
                try await send(["type": "interrupt", "sessionId": current.sessionId, "turnId": turnId])
                for tick in 0..<500 {
                    if !interruptingReply || generation != id { return }
                    if tick == 150 && !interruptAccepted { break }
                    try await Task.sleep(for: .milliseconds(20))
                }
                guard generation == id else { return }
                recoverConnection()
            } catch { if generation == id { recoverConnection() } }
        }
    }
    func authorize(_ action: String) {
        guard connected, !ending, !interruptingReply, let current = record?(),
              let targetTurn = turnId ?? (action == "correct" ? current.feedback.last?.turnId : nil),
              action == "correct" || (awaitingAuthorization && !working) else { return }
        let hadActiveTurn = turnId != nil
        turnId = targetTurn
        rearm?.cancel(); audio.stopPlayback(); working = true; awaitingAuthorization = false
        operation = UUID()
        let id = generation, op = operation; responseId = nil; thinking = false
        status = action == "correct" ? "已停声，正在记录你的纠正。" : "正在查看这一刻的想法…"
        Task {
            do {
                if action == "correct", hadActiveTurn {
                    interruptionAcknowledged = false
                    try await send(["type": "interrupt", "sessionId": current.sessionId, "turnId": targetTurn])
                    for _ in 0..<150 {
                        if interruptionAcknowledged || id != generation { break }
                        try? await Task.sleep(for: .milliseconds(20))
                    }
                    guard id == generation, op == operation else { return }
                    guard interruptionAcknowledged else { throw WorkspaceError.unavailable }
                }
                var extra: [String: Any] = ["turnId": targetTurn, "action": action]
                if action == "help" || action == "review" {
                    guard let evidence else { throw WorkspaceError.unavailable }
                    let expression = latestExpression.flatMap { expression in
                        current.problem?.problemId == expression.problemId && current.problem?.statement.revision == expression.revision
                            ? expression.text : nil
                    }
                    let frozen = try await evidence(expression ?? transcript)
                    extra["evidence"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(frozen))
                }
                guard id == generation, op == operation, !ending, let latest = record?() else { return }
                try await send(envelope("authorize", record: latest, extra: extra))
            } catch { if id == generation, op == operation { turnFailed(error) } }
        }
    }
    func receive(_ event: [String: Any]) {
        let type = event["type"] as? String
        guard socket != nil else { return }
        if type == "error" {
            if event["recoverable"] as? Bool == true,
               let code = event["code"] as? String,
               ["decisionNeedsReview", "speechMismatch", "providerTimeout", "providerError", "connectionClosed", "connectionFailed", "workspaceVoiceFailed"].contains(code) {
                guard !ending, !interruptingReply,
                      let turnId, event["turnId"] as? String == turnId else { return }
                let transcriptionFailure = event["stage"] as? String == "transcription"
                if transcriptionFailure {
                    guard working, responseId == nil, event["responseId"] == nil else { return }
                } else {
                    guard let responseId, event["responseId"] as? String == responseId else { return }
                }
                if let object = event["record"] {
                    do {
                        let data = try JSONSerialization.data(withJSONObject: object)
                        let incoming = try JSONDecoder().decode(WorkspaceRecord.self, from: data).validated()
                        guard let current = record?(), incoming.sessionId == current.sessionId,
                              incoming.problem == current.problem else { throw WorkspaceError.invalidRecord }
                        try acceptRecord?(incoming)
                    } catch { fail(); return }
                }
                // 单次回复失败不结束对话，也不把失败回复记作已完成或重发录音。
                rearm?.cancel(); audio.stopPlayback(); audio.resetInput(); working = false; thinking = false
                self.turnId = nil; self.responseId = nil; awaitingAuthorization = false
                operation = UUID(); turnSubmitted = false
                // 孩子听得懂的说法：如实说明老师这次没回应，写的画的都还在，不让孩子以为自己说错了。
                status = transcriptionFailure ? "刚才这句没听清，你可以接着说，不用重新开启。" : transcript.isEmpty
                    ? "老师还没想好怎么开头。你可以先说说自己的想法，或者先写写画画。"
                    : "老师刚才没想好怎么回答你，你说的和画的都还在。可以再说一遍，或者接着写写画画。"
                scheduleListening(preservingStatus: true)
                // 只显示一行字孩子常常注意不到，以为老师不理他（2026-11-08 真机）；本机说出来，断网也能说。
                // 等收音重新就绪再说，免得重启麦克风时把提示掐掉。
                let prompt = transcriptionFailure ? "刚才没听清，你再说一遍好吗？" : "老师刚才没想好，你再说一遍好吗？"
                let pending = rearm, epoch = operation
                Task { [weak self] in
                    await pending?.value
                    guard let self, self.operation == epoch, !self.working, !self.ending else { return }
                    if let speakPrompt = self.speakPrompt { speakPrompt(prompt) } else { self.audio.say(prompt) }
                }
                return
            }
            fail()
            switch event["code"] as? String {
            case "recordMissing":
                recovery = .host
                status = "当前主机没有这份作品，原稿保留。请检查学习主机。"
            case "recordCorrupt":
                recovery = .host
                status = "主机作品暂时读不了，原稿保留。请检查学习主机。"
            default: break
            }
            return
        }
        if let incoming = event["turnId"] as? String, incoming != turnId { return }
        if ["thinkingStart", "thinkingEnd", "thinkingCancel"].contains(type ?? "") {
            guard !ending, !interruptingReply,
                  let activeTurn = turnId, event["turnId"] as? String == activeTurn,
                  let responseId, event["responseId"] as? String == responseId else { return }
        }
        if interruptingReply && ["transcript", "responseStart", "audio", "responseDone", "scaffold", "corrected"].contains(type ?? "") { return }
        if let object = event["record"] {
            do {
                let data = try JSONSerialization.data(withJSONObject: object)
                let record = try JSONDecoder().decode(WorkspaceRecord.self, from: data).validated()
                try acceptRecord?(record)
            } catch { fail(); return }
        }
        switch type {
        case "scaffold":
            if let object = event["scaffold"],
               let data = try? JSONSerialization.data(withJSONObject: object),
               let journal = try? JSONDecoder().decode(LineScaffoldJournal.self, from: data) {
                acceptScaffold?(journal)
            }
        case "ready":
            connected = true
            if !withoutMicrophone {
                let id = generation
                Task { [weak self] in
                    guard let self, self.generation == id, self.connected, self.continuous else { return }
                    await self.audio.listen()
                    guard self.generation == id else { return }
                    self.listening = self.audio.recording
                    if self.discussionRequested && event["discussionOpeningSupported"] as? Bool == true { self.startDiscussion() }
                    else { self.scheduleListening() }
                }
            }
            if let target = correctionOnly {
                guard record?()?.feedback.last?.responseId == target else { pause(); status = "主机反馈已更新，请先核对新的记录再纠正。"; return }
                authorize("correct")
            } else if withoutMicrophone {
                if discussionRequested && event["discussionOpeningSupported"] as? Bool == true { startDiscussion() }
                else { scheduleListening() }
            }
        case "interruptAccepted":
            guard interruptingReply, event["turnId"] as? String == turnId else { return }
            interruptAccepted = true
            status = "老师已停，你可以继续说。"
        case "interrupted":
            thinking = false
            interruptionAcknowledged = true
            if interruptingReply {
                interruptingReply = false; working = false; turnId = nil; responseId = nil
                turnSubmitted = false
                status = "已打断。轮到你了，可以继续说。"
                if let pcm = pendingSpeech { pendingSpeech = nil; submitPCM(pcm) } else { scheduleListening() }
            }
        case "paused":
            if event["resumable"] as? Bool == true {
                guard !ending, !interruptingReply else { return }
                operation = UUID(); turnSubmitted = false; turnId = nil; responseId = nil
                working = false; thinking = false; awaitingAuthorization = false
                audio.stopPlayback(); audio.resetInput()
                status = "好，你先想。我还在，想聊时直接说。"; scheduleListening(preservingStatus: true)
            } else { pause() }
        case "transcript":
            guard !ending else { return }
            transcript = event["text"] as? String ?? ""; working = false; awaitingAuthorization = true
            appendMessage(id: "child-\(turnId ?? UUID().uuidString)", role: "我", text: transcript)
            let action = event["action"] as? String
            if (action == "uncertain" || action == "express" || event["continuation"] as? Bool == true),
               !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let problem = record?()?.problem {
                latestExpression = (problem.problemId, problem.statement.revision, transcript)
            }
            if let action = event["action"] as? String, ["review", "help", "correct"].contains(action) {
                // 老师要想几秒才能回复：转写一到就在本机先应一声，让孩子知道被听见了，不在沉默里干等。
                acknowledge(); authorize(action)
            }
            else { completedTurns += 1; status = "已听见。你可以继续想；想请老师讲题意时点“解释题意”。"; scheduleListening() }
        case "responseStart":
            guard !ending else { return }
            responseId = event["responseId"] as? String; reply = ""; thinking = false; audio.beginResponse(); working = true
        case "thinkingStart":
            thinking = true
        case "thinkingEnd":
            thinking = false
        case "thinkingCancel":
            thinking = false
        case "audio":
            guard !ending else { return }
            guard let responseId, event["responseId"] as? String == responseId,
                  let encoded = event["pcm"] as? String, let data = Data(base64Encoded: encoded) else { return }
            do { try audio.play(data) } catch { fail(); status = "声音播放失败，原稿保留。请重试。" }
        case "responseDone":
            guard !ending else { return }
            guard let responseId, event["responseId"] as? String == responseId else { return }
            thinking = false
            reconnectAttempts = 0
            self.responseId = nil
            reply = event["text"] as? String ?? ""; status = audio.outputMuted ? Self.mutedNotice : "老师说完后，再由你来想。"; audio.completeResponse()
            appendMessage(id: responseId, role: "老师", text: reply)
        case "corrected":
            latestExpression = nil
            if let index = messages.lastIndex(where: { $0.role == "老师" }) { messages[index].contested = true }
            if event["continuing"] as? Bool == true, correctionOnly == nil {
                // 口头纠正带补充说明：主机正在回应同一回合，不能提前重开麦或标记完成。
                working = true; status = "刚才的理解已标记异议，老师正在听你的补充。"
                return
            }
            reply = "刚才的理解已标记为有异议，不作为你的学习结论。"; working = false; completedTurns += 1
            if correctionOnly != nil { pause(); status = "上次反馈已标记为有异议；麦克风未开启。" }
            else { scheduleListening() }
        default: break
        }
    }
    private func scheduleListening(preservingStatus: Bool = false) {
        guard continuous, connected, !working, !ending, !interruptingReply else { return }
        let id = generation
        rearm?.cancel()
        rearm = Task { [weak self] in
            if self?.audio.recording != true { try? await Task.sleep(for: .milliseconds(400)) }
            guard !Task.isCancelled, let self, self.generation == id, self.continuous, self.connected,
                  !self.working, !self.ending, !self.interruptingReply else { return }
            if !self.withoutMicrophone { await self.audio.listen() }
            guard self.generation == id, !Task.isCancelled, self.connected, self.continuous,
                  !self.working, !self.ending, !self.interruptingReply else { return }
            self.listening = self.audio.recording
            if !preservingStatus { self.status = "轮到你了。可以继续说或安静写画；需要帮助时说“帮我一下”。" }
        }
    }
    private func envelope(_ type: String, record: WorkspaceRecord, extra: [String: Any]) -> [String: Any] {
        ["type": type, "sessionId": record.sessionId, "eventId": UUID().uuidString, "expectedRevision": record.revision].merging(extra) { _, new in new }
    }
    private func send(_ event: [String: Any]) async throws {
        guard let socket else { throw WorkspaceError.unavailable }
        let object = ["schemaVersion": 2].merging(event) { _, new in new }
        let data = try JSONSerialization.data(withJSONObject: object)
        try await socket.sendText(String(decoding: data, as: UTF8.self))
    }
    func finishSession(save: () async -> Void) async {
        guard !ending else { return }
        ending = true; continuous = false; operation = UUID(); thinking = false; rearm?.cancel(); audio.stop(); listening = false
        let id = generation
        if connected, working, turnSubmitted, let turnId, let record = record?() {
            interruptionAcknowledged = false
            do { try await send(["type": "interrupt", "sessionId": record.sessionId, "turnId": turnId]) }
            catch { pause(); status = "已停声，主机未确认停止；本机原稿保留，请稍后同步。"; return }
            for _ in 0..<150 {
                if interruptionAcknowledged || id != generation { break }
                try? await Task.sleep(for: .milliseconds(20))
            }
            guard id == generation, interruptionAcknowledged else {
                pause(); status = "已停声，主机未确认停止；本机原稿保留，请稍后同步。"; return
            }
        }
        working = true
        await save()
        pause()
    }
    private func fail() { pause(); recovery = .retry; status = "这次没连上老师，你写的都还在。点“重试对话”再试一次。" }
    private func turnFailed(_ error: Error) {
        if error is URLError { recoverConnection() } else { fail() }
    }
    func pause() {
        generation = UUID(); operation = UUID(); turnSubmitted = false
        rearm?.cancel(); reconnectTask?.cancel(); audio.stop()
        socket?.close(); socket = nil
        connected = false; listening = false; working = false; thinking = false; continuous = false
        turnId = nil; responseId = nil; awaitingAuthorization = false
        correctionOnly = nil; ending = false; interruptionAcknowledged = false
        interruptingReply = false
        interruptAccepted = false; pendingSpeech = nil; connectionSettings = nil
        discussionRequested = false
        recovery = nil
        latestExpression = nil
        status = "对话已暂停，原稿保留；没有自动开启麦克风。"
    }
    func resetForWorkChange() {
        pause()
        transcript = ""; reply = ""; completedTurns = 0; messages = []
        status = "你先独立想一想。需要时可以开启对话。"
    }
    private func appendMessage(id: String, role: String, text: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if let index = messages.firstIndex(where: { $0.id == id }) { messages[index].text = text }
        else { messages.append(Message(id: id, role: role, text: text)) }
        if messages.count > 60 { messages.removeFirst(messages.count - 60) }
    }
    #if DEBUG
    /// 仅隔离UI夹具：测试长短对话布局，不连接家庭服务或生成学习证据。
    func previewConversationForValidation(long: Bool) {
        messages = [Message(id: "preview-child", role: "我", text: "我觉得剩下的还可以再分。"),
            Message(id: "preview-teacher", role: "老师", text: long ? String(repeating: "把你的想法说给我听，我们一起检查数量关系。", count: 20) : "你想怎么检验？")]
    }
    #endif
}
