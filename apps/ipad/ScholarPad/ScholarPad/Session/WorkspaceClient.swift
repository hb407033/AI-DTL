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
    var record: (() -> WorkspaceRecord?)?
    var acceptRecord: ((WorkspaceRecord) throws -> Void)?
    var evidence: ((String) async throws -> WorkspaceEvidence)?
    var acceptScaffold: ((LineScaffoldJournal) -> Void)?
    private let audio = TutorAudioIO()
    private var socket: (any WorkspaceTransport)?
    private let transportFactory: (URL) -> any WorkspaceTransport
    private var generation = UUID()
    private var turnId: String?
    private var responseId: String?
    private var rearm: Task<Void, Never>?
    private var continuous = false
    private var awaitingAuthorization = false
    private var withoutMicrophone = false
    private var discussionRequested = false
    private var correctionOnly: String?
    private var ending = false
    private var interruptionAcknowledged = false
    private var interruptingReply = false
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
        audio.onDrained = { [weak self] in
            guard let self, self.connected else { return }
            self.working = false; self.thinking = false; self.completedTurns += 1; self.scheduleListening()
        }
        audio.onError = { [weak self] message in self?.pause(); self?.recovery = .retry; self?.status = message }
    }
    func connect(host: String, microphone: Bool = true, conversationMode: String? = nil, leadDiscussion: Bool = false) {
        pause()
        guard let record = record?(), record.problem?.statement.confirmed == true,
              !host.contains("/"), !host.contains("@"), let url = URL(string: "ws://\(host):8791/tutor/workspace") else {
            status = "请先核对题意和主机地址。"; return
        }
        continuous = true; withoutMicrophone = !microphone
        discussionRequested = leadDiscussion && conversationMode == "dialogue"
        let id = generation, task = transportFactory(url)
        socket = task; status = "正在连接学习主机…"
        Task { [weak self] in
            guard let self else { return }
            do {
                var hello: [String: Any] = ["type": "hello", "sessionId": record.sessionId]
                if conversationMode == "dialogue" { hello["conversationMode"] = "dialogue" }
                try await self.send(hello)
                while id == self.generation {
                    let text = try await task.receiveText()
                    guard id == self.generation else { return }
                    if let data = text.data(using: .utf8),
                       let event = try JSONSerialization.jsonObject(with: data) as? [String: Any] { self.receive(event) }
                }
            } catch { if id == self.generation { self.fail(); self.status = "和老师的连接断了，你写的都还在。点“重试对话”再连一次。" } }
        }
    }
    private func startDiscussion() {
        guard connected, !ending, let current = record?(), let problem = current.problem else { return }
        discussionRequested = false; working = true; listening = false
        let turn = UUID().uuidString; turnId = turn; responseId = nil; thinking = false
        let id = generation
        status = "老师正在看题目和已有解答，准备一起核对…"
        Task {
            do {
                guard let evidence else { throw WorkspaceError.unavailable }
                let frozen = try await evidence("")
                guard id == generation, !ending, let latest = record?() else { return }
                guard latest.problem == problem else { throw WorkspaceError.invalidRecord }
                let snapshot = try JSONSerialization.jsonObject(with: JSONEncoder().encode(frozen))
                try await send(envelope("startDiscussion", record: latest, extra: ["turnId": turn, "evidence": snapshot]))
            } catch { if id == generation { fail() } }
        }
    }
    func submitPCM(_ pcm: Data) {
        guard connected, !ending, !working, !pcm.isEmpty, pcm.count <= 960000, let record = record?(), let problem = record.problem else { return }
        rearm?.cancel(); audio.stop(); listening = false; working = true; awaitingAuthorization = false
        let turn = UUID().uuidString; turnId = turn; responseId = nil; thinking = false
        let id = generation
        status = "正在听取你的想法；尚未授权讲解。"
        Task {
            do {
                try await send(envelope("voiceStart", record: record, extra: ["turnId": turn, "problemId": problem.problemId]))
                guard let socket else { throw WorkspaceError.unavailable }
                for offset in stride(from: 0, to: pcm.count, by: 3200) {
                    guard id == generation, !ending else { return }
                    try await socket.sendPCM(pcm.subdata(in: offset..<min(offset + 3200, pcm.count)))
                }
                guard id == generation, !ending else { return }
                try await send(envelope("voiceEnd", record: record, extra: ["turnId": turn, "problemId": problem.problemId]))
            } catch { if id == generation { fail() } }
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
    func interruptReply() {
        guard connected, !ending, !interruptingReply, (working || thinking),
              let turnId, let current = record?() else { return }
        rearm?.cancel(); audio.stop(); listening = false
        thinking = false; responseId = nil; awaitingAuthorization = false; interruptingReply = true
        status = "老师已停声，正在取消这次回复…"
        let id = generation
        Task {
            do {
                try await send(["type": "interrupt", "sessionId": current.sessionId, "turnId": turnId])
                for _ in 0..<150 {
                    if !interruptingReply || generation != id { return }
                    try await Task.sleep(for: .milliseconds(20))
                }
                guard generation == id else { return }
                pause(); status = "已停声，主机未确认停止。原稿保留，请重新开启对话。"
            } catch { if generation == id { fail() } }
        }
    }
    func authorize(_ action: String) {
        guard connected, !ending, !interruptingReply, let current = record?(),
              let targetTurn = turnId ?? (action == "correct" ? current.feedback.last?.turnId : nil),
              action == "correct" || (awaitingAuthorization && !working) else { return }
        let hadActiveTurn = turnId != nil
        turnId = targetTurn
        rearm?.cancel(); audio.stop(); listening = false; working = true; awaitingAuthorization = false
        let id = generation; responseId = nil; thinking = false
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
                    guard id == generation, interruptionAcknowledged else { throw WorkspaceError.unavailable }
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
                guard id == generation, !ending, let latest = record?() else { return }
                try await send(envelope("authorize", record: latest, extra: extra))
            } catch { if id == generation { fail() } }
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
                      let turnId, event["turnId"] as? String == turnId,
                      let responseId, event["responseId"] as? String == responseId else { return }
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
                rearm?.cancel(); audio.stop(); listening = false; working = false; thinking = false
                self.turnId = nil; self.responseId = nil; awaitingAuthorization = false
                // 孩子听得懂的说法：如实说明老师这次没回应，写的画的都还在，不让孩子以为自己说错了。
                status = transcript.isEmpty
                    ? "老师还没想好怎么开头。你可以先说说自己的想法，或者先写写画画。"
                    : "老师刚才没想好怎么回答你，你说的和画的都还在。可以再说一遍，或者接着写写画画。"
                scheduleListening(preservingStatus: true)
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
            if let target = correctionOnly {
                guard record?()?.feedback.last?.responseId == target else { pause(); status = "主机反馈已更新，请先核对新的记录再纠正。"; return }
                authorize("correct")
            } else if discussionRequested && event["discussionOpeningSupported"] as? Bool == true { startDiscussion() }
            else { scheduleListening() }
        case "interrupted":
            thinking = false
            interruptionAcknowledged = true
            if interruptingReply {
                interruptingReply = false; working = false; turnId = nil; responseId = nil
                status = "已打断。轮到你了，可以继续说。"; scheduleListening()
            }
        case "paused": pause()
        case "transcript":
            guard !ending else { return }
            transcript = event["text"] as? String ?? ""; working = false; awaitingAuthorization = true
            appendMessage(id: "child-\(turnId ?? UUID().uuidString)", role: "我", text: transcript)
            let action = event["action"] as? String
            if (action == "uncertain" || action == "express" || event["continuation"] as? Bool == true),
               !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let problem = record?()?.problem {
                latestExpression = (problem.problemId, problem.statement.revision, transcript)
            }
            if let action = event["action"] as? String, ["review", "help", "correct"].contains(action) { authorize(action) }
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
            self.responseId = nil
            reply = event["text"] as? String ?? ""; status = "老师说完后，再由你来想。"; audio.completeResponse()
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
            try? await Task.sleep(for: .milliseconds(400))
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
        ending = true; continuous = false; thinking = false; rearm?.cancel(); audio.stop(); listening = false
        let id = generation
        if connected, working, let turnId, let record = record?() {
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
    func pause() {
        generation = UUID(); rearm?.cancel(); audio.stop()
        socket?.close(); socket = nil
        connected = false; listening = false; working = false; thinking = false; continuous = false
        turnId = nil; responseId = nil; awaitingAuthorization = false
        correctionOnly = nil; ending = false; interruptionAcknowledged = false
        interruptingReply = false
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
