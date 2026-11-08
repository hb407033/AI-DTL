import Foundation

struct TurnRecord: Equatable {
    var turnId: String
    var responseId: String
    var path: String
    var played: Bool
    var interrupted: Bool
    var utterance: String
    var kind: String?
    var gateReason: String?
    var latencyMs: Int?
}

@MainActor
protocol TutorAudioPlaying: AnyObject {
    func beginResponse()
    func play(_ data: Data) throws
    func completeResponse()
    func stopPlayback()
    func say(_ text: String)
    var outputMuted: Bool { get }
}

extension TutorAudioIO: TutorAudioPlaying {}

/// 一轮对话：先要文字头部，通过门禁才播放老师的声音。头部文字不进界面，也不播放。
@MainActor
final class TutorConductor: ObservableObject {
    @Published private(set) var phase: VoiceStateBar.Phase = .off
    @Published private(set) var status = "你先独立想一想。需要时可以开启对话。"
    @Published private(set) var messages: [WorkspaceClient.Message] = []
    var onTurnRecorded: ((TurnRecord) -> Void)?
    var onNeedsSlowPath: ((String, String) -> Void)?
    var onFinish: (() -> Void)?
    var onPhase: ((VoiceStateBar.Phase, String, [WorkspaceClient.Message]) -> Void)?
    private(set) var latencyFromChildFinishedToFirstPlay: TimeInterval?
    private let session: any RealtimeSessionProtocol
    private let gates: TeachingGates
    private let audio: any TutorAudioPlaying
    private let slowPath: SlowPath?
    private let context: () -> GateContext
    private let clock: () -> Date
    private var parser = TurnHeaderParser()
    private var stage: Stage = .idle
    private var header: TurnHeader?
    private var replyText = ""
    private var spokenText = ""
    private var bufferedAudio: [Data] = []
    private var sawModelAudio = false
    private var acknowledgementIndex = 0
    private var childFinishedAt: Date?
    private var turnId = UUID().uuidString
    private var responseId = UUID().uuidString
    private var interruptedNote = false
    private var failureSpoken = false
    private enum Stage { case idle, capturing, awaitingHeader, awaitingReply }

    init(session: any RealtimeSessionProtocol, gates: TeachingGates, audio: any TutorAudioPlaying, slowPath: SlowPath? = nil,
         context: @escaping () -> GateContext, clock: @escaping () -> Date = Date.init) {
        self.session = session
        self.gates = gates
        self.audio = audio
        self.slowPath = slowPath
        self.context = context
        self.clock = clock
        session.onTextDelta = { [weak self] delta in self?.takeText(delta) }
        session.onSpokenDelta = { [weak self] delta in self?.spokenText += delta }
        session.onAudioDelta = { [weak self] data in self?.takeAudio(data) }
        session.onResponseDone = { [weak self] _ in self?.responseFinished() }
        session.onClosed = { [weak self] _ in self?.connectionClosed() }
    }

    func childStartedSpeaking() {
        if phase == .speaking || phase == .thinking { interrupt() }
        session.beginTurn()
        turnId = UUID().uuidString
        responseId = UUID().uuidString
        stage = .capturing
        failureSpoken = false
        setPhase(.listening, status: "正在听你说")
    }

    func childAudio(_ pcm: Data) {
        guard stage == .capturing else { return }
        session.appendAudio(pcm)
    }

    func childFinishedSpeaking() {
        guard stage == .capturing else { return }
        stage = .awaitingHeader
        parser = TurnHeaderParser()
        header = nil
        replyText = ""
        spokenText = ""
        bufferedAudio = []
        sawModelAudio = false
        childFinishedAt = clock()
        setPhase(.thinking, status: "老师在想")
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.session.commitTurn()
                guard self.stage == .awaitingHeader else { return }
                try await self.session.requestHeader(instructions: self.gates.headerInstructions())
            } catch { self.unheard() }
        }
    }

    func interrupt() {
        audio.stopPlayback()
        session.cancelResponse()
        slowPath?.cancel()
        bufferedAudio = []
        interruptedNote = true
        stage = .idle
        record(path: "none", played: false, utterance: "", kind: nil, reason: nil, interrupted: true)
        setPhase(.listening, status: "好，你先说。")
    }

    func mergedContext() -> GateContext {
        var gate = context()
        guard interruptedNote else { return gate }
        gate.history.append(TeachingDecisionRecord(
            problemId: gate.record.problem?.problemId ?? "p", problemRevision: gate.record.problem?.statement.revision ?? 0,
            turnId: turnId, responseId: responseId, child: gate.child, focus: "clarify",
            observation: "上一句没说完", evidenceIds: [turnId], resolved: [], utterance: "上一句没说完", method: "ordinary", handoff: false))
        return gate
    }

    private func takeText(_ delta: String) {
        if stage == .awaitingHeader {
            if let parsed = parser.feed(delta) { header = parsed }
        } else if stage == .awaitingReply {
            replyText += delta
        }
    }

    private func takeAudio(_ data: Data) {
        sawModelAudio = true
        // 头部阶段的声音直接丢掉。回复要等整句通过门禁才播放。
        guard stage == .awaitingReply else { return }
        bufferedAudio.append(data)
    }

    private func responseFinished() {
        if stage == .awaitingHeader { handleHeader() }
        else if stage == .awaitingReply { Task { await finishReply() } }
    }

    private func handleHeader() {
        guard stage == .awaitingHeader else { return }
        let kind = header?.kind
        if header == nil {
            acknowledge(path: "none", kind: "idea")
            return
        }
        switch kind {
        case .idea, .selfTalk:
            acknowledge(path: "none", kind: kind?.rawValue)
        case .finish:
            record(path: "none", played: false, utterance: header?.transcript ?? "", kind: "finish", reason: nil, interrupted: false)
            setPhase(.off, status: "对话已关闭")
            onFinish?()
        case .help, .question:
            let gate = mergedContext()
            if gate.inkChanged, let jpeg = gate.canvasJPEG { session.attachImage(jpeg) }
            stage = .awaitingReply
            replyText = ""
            spokenText = ""
            bufferedAudio = []
            sawModelAudio = false
            sayAcknowledgement()
            let requested = kind ?? .help
            Task { [weak self] in
                guard let self, self.stage == .awaitingReply else { return }
                try? await self.session.requestReply(instructions: self.gates.replyInstructions(kind: requested))
            }
        case nil:
            acknowledge(path: "none", kind: "idea")
        }
    }

    private func finishReply() async {
        guard stage == .awaitingReply else { return }
        let utterance = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        let jsonOnly = utterance.hasPrefix("{") && utterance.hasSuffix("}")
        if utterance.isEmpty || jsonOnly || header == nil {
            bufferedAudio = []
            acknowledge(path: "none", kind: "idea")
            return
        }
        let gate = mergedContext()
        let verdict: GateVerdict
        do { verdict = try gates.check(utterance: utterance, context: gate) }
        catch { unheard(); return }
        let speechMatches = spokenText.isEmpty || gates.matchesSpeech(spokenText, utterance)
        if verdict.ok && speechMatches {
            messages.append(.init(id: responseId, role: "teacher", text: utterance))
            record(path: "fast", played: true, utterance: utterance, kind: header?.kind.rawValue, reason: nil, interrupted: false)
            setPhase(.speaking, status: audio.outputMuted ? WorkspaceClient.mutedNotice : "老师说完后，再由你来想。")
            await Task.yield()
            playBuffered(utterance)
            return
        }
        bufferedAudio = []
        let reason = verdict.ok ? "speechMismatch" : (verdict.reason ?? "rejected")
        onNeedsSlowPath?(utterance, reason)
        guard let slowPath else {
            setPhase(.listening, status: "正在听你说")
            stage = .idle
            return
        }
        let ticket = slowPath.token()
        let turn = turnId
        let result = await slowPath.run(context: gate, rejectedReason: reason)
        // 取消、卸载或已经进入下一轮时，旧的改写和声音都不能再播出来。
        guard slowPath.isCurrent(ticket), stage == .awaitingReply, turnId == turn, !Task.isCancelled else { return }
        if case .failed(let code) = result, code == "cancelled" { return }
        switch result {
        case .spoken(let rewritten, let pcm):
            audio.beginResponse()
            if !pcm.isEmpty { try? audio.play(pcm); noteFirstPlay() }
            audio.completeResponse()
            messages.append(.init(id: responseId, role: "teacher", text: rewritten))
            record(path: "slow", played: true, utterance: rewritten, kind: header?.kind.rawValue, reason: reason, interrupted: false)
            setPhase(.speaking, status: "老师说完后，再由你来想。")
        case .failed:
            audio.say("老师刚才没想好，你再说一遍好吗？")
            record(path: "slow", played: false, utterance: utterance, kind: header?.kind.rawValue, reason: reason, interrupted: false)
            setPhase(.listening, status: "老师刚才没想好，你再说一遍好吗？")
        }
        stage = .idle
    }

    private func playBuffered(_ utterance: String) {
        audio.beginResponse()
        for chunk in bufferedAudio {
            try? audio.play(chunk)
            noteFirstPlay()
        }
        audio.completeResponse()
        stage = .idle
        _ = utterance
    }

    private func noteFirstPlay() {
        guard latencyFromChildFinishedToFirstPlay == nil, let childFinishedAt else { return }
        latencyFromChildFinishedToFirstPlay = clock().timeIntervalSince(childFinishedAt)
    }

    private func acknowledge(path: String, kind: String?) {
        sayAcknowledgement()
        record(path: path, played: false, utterance: "", kind: kind, reason: nil, interrupted: false)
        stage = .idle
        setPhase(.listening, status: "正在听你说")
    }

    private func sayAcknowledgement() {
        let text = WorkspaceClient.acknowledgements[acknowledgementIndex % WorkspaceClient.acknowledgements.count]
        acknowledgementIndex += 1
        audio.say(text)
    }

    private func unheard() {
        guard !failureSpoken else { return }
        failureSpoken = true
        bufferedAudio = []
        session.close()
        audio.say("刚才没听清，你再说一遍好吗？")
        stage = .idle
        setPhase(.listening, status: "刚才没听清，你再说一遍好吗？")
    }

    private func connectionClosed() {
        guard stage == .capturing || stage == .awaitingHeader || stage == .awaitingReply else { return }
        unheard()
    }

    private func record(path: String, played: Bool, utterance: String, kind: String?, reason: String?, interrupted: Bool) {
        var latency: Int?
        if let childFinishedAt { latency = Int((clock().timeIntervalSince(childFinishedAt) * 1000).rounded()) }
        onTurnRecorded?(TurnRecord(turnId: turnId, responseId: responseId, path: path, played: played, interrupted: interrupted,
                                   utterance: utterance, kind: kind, gateReason: reason, latencyMs: latency))
    }

    private func setPhase(_ phase: VoiceStateBar.Phase, status: String) {
        self.phase = phase
        self.status = status
        onPhase?(phase, status, messages)
    }
}
