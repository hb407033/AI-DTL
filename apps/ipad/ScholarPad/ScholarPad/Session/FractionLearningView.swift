// 「分数探索」完整屏（工作包 E 的 iPad 部分）：题干 + 孩子可操作分数矩形 + PencilKit 笔迹层 + 主动提交闭环。
// 与 SimpleTutor 自由聊天完全隔离：只有按钮命令经 LearningSessionClient 上行；语音意图只提示确认，绝不自动提交。
// 恢复路径：杀 App 重进只展示「上次停在这里」，点继续才连接；restored 后用 LearningSessionCache.reconcile 对账，
// 冲突保留双方并要求明确选择。删除记录（HTTP DELETE + 本地草稿）与清空当前画布是两个独立确认入口。
import SwiftUI
import PencilKit
import Combine

/// 按钮可用性状态机：纯函数，便于测试。阶段推进以宿主 accepted 为准，不本地猜测。
struct FractionLearningControls: Equatable {
    var connected = false
    var phase = ""
    var explorationSubmitted = false
    var hasFeedback = false

    var canSubmit: Bool { connected && (phase == "exploring" || phase == "transfer") }
    var canRequestHelp: Bool { canSubmit }
    var canContest: Bool { connected && hasFeedback }
    /// 探索题提交完成后才允许迁移；迁移中、已结束或未连接都不可用。
    var canStartTransfer: Bool {
        connected && explorationSubmitted && phase != "transfer" && phase != "finished" && phase != "paused" && !phase.isEmpty
    }
    var canPause: Bool { connected && !phase.isEmpty && phase != "paused" && phase != "finished" }
    var canResume: Bool { connected && phase == "paused" }
}

@MainActor
final class FractionLearningModel: ObservableObject {
    enum Stage: Equatable {
        case entry
        case active
    }

    /// 恢复决策：fresh 全新开始；resumeLocal 用本地草稿恢复；conflict 双方保留、必须明确选择。
    enum RestoreDecision: Equatable {
        case fresh
        case resumeLocal
        case conflict(localRevision: Int, remoteRevision: Int)
    }

    static let exploreChallenge = "fraction-compare-01"
    static let transferChallenge = "fraction-transfer-01"
    static let exploreWholeGroup = "whole-explore"
    static let transferWholeGroup = "whole-transfer"

    @Published private(set) var stage: Stage = .entry
    @Published private(set) var boardState = FractionBoardState()
    @Published private(set) var status = "填入 Mac 地址后开始。"
    @Published private(set) var draftSummary: String?
    @Published private(set) var voicePrompt: String?
    @Published private(set) var conflict: (localRevision: Int, remoteRevision: Int)?
    @Published private(set) var explorationSubmitted = false
    @Published private(set) var hintUsedThisAttempt = false
    @Published private(set) var selectedRectangleId: String?

    /// 笔迹层控制：clearToken +1 清空；restoredInk/restoreToken 恢复。与矩形层互不写入。
    @Published private(set) var inkClearToken = 0
    @Published private(set) var restoredInk: Data?
    @Published private(set) var inkRestoreToken = 0

    @Published private(set) var phase = ""
    @Published private(set) var reply = ""
    @Published private(set) var prompt = ""
    @Published private(set) var challengeId = ""
    @Published private(set) var hasFeedback = false

    var controls: FractionLearningControls {
        FractionLearningControls(connected: client.connected, phase: phase,
                                 explorationSubmitted: explorationSubmitted, hasFeedback: hasFeedback)
    }

    let client: LearningSessionClient
    private let cache: LearningSessionCache
    private let deleteRemote: (String, String) async throws -> Void
    private let loadLastSessionId: () -> String?
    private let storeLastSessionId: (String?) -> Void
    private var latestInk = PKDrawing()
    private var submissions: [LearningSubmission] = []
    private var feedback: [LearningFeedback] = []
    private var wholeGroupId = FractionLearningModel.exploreWholeGroup
    private var rectangleSeq = 0
    private var persistTask: Task<Void, Never>?
    private let snapshotSize = CGSize(width: 1200, height: 900)

    init(client: LearningSessionClient = LearningSessionClient(),
         cache: LearningSessionCache = LearningSessionCache(),
         deleteRemote: ((String, String) async throws -> Void)? = nil,
         loadLastSessionId: (() -> String?)? = nil,
         storeLastSessionId: ((String?) -> Void)? = nil) {
        self.client = client
        self.cache = cache
        self.deleteRemote = deleteRemote ?? { host, sessionId in
            var request = URLRequest(url: URL(string: "http://\(host):8791/learning/\(sessionId)")!)
            request.httpMethod = "DELETE"
            _ = try await URLSession.shared.data(for: request)
        }
        self.loadLastSessionId = loadLastSessionId ?? { UserDefaults.standard.string(forKey: "fractionLearningLastSessionId") }
        self.storeLastSessionId = storeLastSessionId ?? { UserDefaults.standard.set($0, forKey: "fractionLearningLastSessionId") }
        wireClient()
    }

    private func wireClient() {
        client.$phase.assign(to: &$phase)
        client.$reply.assign(to: &$reply)
        client.$lastFeedbackId.map { $0 != nil }.assign(to: &$hasFeedback)
        client.onReady = { [weak self] info in self?.handleReady(info) }
        client.onAccepted = { [weak self] info in self?.handleAccepted(info) }
        client.onBoardAction = { [weak self] action in self?.applyBoardAction(action) }
        client.onVoiceIntent = { [weak self] intent, _ in
            // 语音「我做好了」只换成一句确认提示，提交仍必须点按钮。
            self?.voicePrompt = intent == .submit ? "你是说做好了吗？请点「看看我的想法」提交。" : "你是想要提示吗？请点「帮我一下」。"
        }
    }

    // MARK: 入口与恢复

    /// 进入视图只读本地草稿并展示摘要；绝不自动连接、不自动开麦。
    func prepareEntry() {
        guard let sessionId = loadLastSessionId(), !sessionId.isEmpty else { draftSummary = nil; return }
        guard let draft = try? cache.loadDraft(sessionId: sessionId) else { draftSummary = nil; return }
        draftSummary = "题目 \(draft.challengeId) · 阶段 \(draft.phase.rawValue)" + (draft.synced ? "" : " · 有未同步修改")
    }

    func startFresh(host: String) {
        resetLocalSpace()
        stage = .active
        client.connect(host: host)
    }

    /// 点「继续上次的学习」才连接，并带 sessionId 请求宿主恢复。
    func resumeLastSession(host: String) {
        guard let sessionId = loadLastSessionId(),
              let draft = try? cache.loadDraft(sessionId: sessionId) else {
            status = "没有找到上次的学习草稿，可以开始新的探索。"
            return
        }
        restoreCanvas(from: draft)
        stage = .active
        status = "上次停在这里：\(draftSummary ?? draft.challengeId)。正在连接主机核对进度…"
        client.connect(host: host, sessionId: draft.sessionId)
    }

    private func handleReady(_ info: LearningSessionClient.ReadyInfo) {
        prompt = info.prompt
        // 连接成功的默认提示（「已连接…」），恢复/冲突分支再按需覆盖
        status = client.status
        challengeId = info.challengeId.isEmpty ? challengeId : info.challengeId
        if challengeId.isEmpty { challengeId = Self.exploreChallenge }
        if info.phase == "transfer" { wholeGroupId = Self.transferWholeGroup }
        let decision = restoreDecision(sessionId: info.sessionId, ready: info)
        switch decision {
        case .fresh:
            if info.restored {
                status = "主机有这次学习的记录，但本机没有草稿内容；已从主机进度继续，画布空白。"
            }
            persistDraft(synced: true)
        case .resumeLocal:
            persistDraft(synced: true)
        case .conflict(let localRevision, let remoteRevision):
            conflict = (localRevision, remoteRevision)
            status = "这台 iPad 有未同步的画布（revision \(localRevision)），主机也有新进度（revision \(remoteRevision)）。请选择保留哪一份。"
        }
    }

    /// ready 到达后的对账：宿主 ready 只回传进度元数据（revision/phase/题包），不回传笔迹与矩形，
    /// 因此远端内容以本地已同步内容为底、元数据以 ready 为准，交给 reconcile 决定采用/保留/冲突。
    private func restoreDecision(sessionId: String, ready info: LearningSessionClient.ReadyInfo) -> RestoreDecision {
        guard info.restored else {
            if let sessionId = loadLastSessionId(), sessionId == info.sessionId,
               let local = try? cache.loadDraft(sessionId: info.sessionId) {
                restoreCanvas(from: local)
                return .resumeLocal
            }
            return .fresh
        }
        guard let local = try? cache.loadDraft(sessionId: info.sessionId) else { return .fresh }
        var remote = local
        remote.revision = info.revision
        remote.phase = LearningPhase(rawValue: info.phase) ?? local.phase
        if !info.challengeId.isEmpty { remote.challengeId = info.challengeId }
        if !info.packVersion.isEmpty { remote.packVersion = info.packVersion }
        remote.synced = true
        do {
            switch try cache.reconcile(sessionId: info.sessionId, remote: remote) {
            case .appliedRemote, .keptLocal:
                if let resolved = try cache.loadDraft(sessionId: info.sessionId) { restoreCanvas(from: resolved) }
                return .resumeLocal
            case .conflict(let localRevision, let remoteRevision):
                return .conflict(localRevision: localRevision, remoteRevision: remoteRevision)
            }
        } catch {
            status = "本地草稿校验失败，保留原文件；可删除记录后重新开始。"
            return .fresh
        }
    }

    /// 冲突选择：保留本机画布。
    func chooseLocalDraft() {
        conflict = nil
        status = "已保留本机画布，待重新同步到主机。"
    }

    /// 冲突选择：采用主机进度（冲突副本由 reconcile 保存在 .conflict.json）。
    func chooseRemoteDraft() {
        guard let sessionId = client.sessionId ?? loadLastSessionId(),
              let remote = try? cache.loadConflictDraft(sessionId: sessionId) else {
            conflict = nil
            return
        }
        try? cache.removeDraft(sessionId: sessionId)
        try? cache.saveDraft(remote)
        restoreCanvas(from: remote)
        conflict = nil
        status = "已采用主机进度，本机未同步修改已被替换。"
    }

    private func restoreCanvas(from draft: LearningSessionDraft) {
        let board = FractionBoard(
            revision: draft.board.revision,
            rectangles: draft.board.rectangles.map {
                FractionRectangle(id: $0.id, wholeGroupId: $0.wholeGroupId, rows: $0.rows, columns: $0.columns,
                                  shadedCells: $0.shadedCells, owner: $0.owner == .child ? .child : .agent)
            })
        // hintsHidden 从草稿 hintsVisible 反演：恢复呈现状态，不伪造 revision 变化。
        boardState = FractionBoardState(board: board, hintsHidden: !draft.hintsVisible)
        if let inkData = Data(base64Encoded: draft.childInkBase64) {
            restoredInk = inkData
            inkRestoreToken += 1
            latestInk = (try? PKDrawing(data: inkData)) ?? PKDrawing()
        }
        wholeGroupId = draft.phase == .transfer ? Self.transferWholeGroup : Self.exploreWholeGroup
        challengeId = draft.challengeId
        submissions = draft.submissions
        feedback = draft.feedback
        explorationSubmitted = draft.phase == .reviewing || !draft.submissions.isEmpty
        storeLastSessionId(draft.sessionId)
    }

    // MARK: 画布操作

    func inkChanged(_ drawing: PKDrawing) {
        latestInk = drawing
        schedulePersist()
    }

    func toggleCell(rectangleId: String, cell: Int) {
        if case .success = boardState.toggleCell(rectangleId: rectangleId, cell: cell) {
            selectedRectangleId = rectangleId
            schedulePersist()
        }
    }

    func addPaper() {
        rectangleSeq += 1
        let rectangle = FractionRectangle(id: "child-\(wholeGroupId)-\(rectangleSeq)", wholeGroupId: wholeGroupId,
                                          rows: 1, columns: 2, shadedCells: [], owner: .child)
        switch boardState.addRectangle(rectangle) {
        case .success:
            selectedRectangleId = rectangle.id
            schedulePersist()
        case .failure(let rejection):
            status = "加不了更多纸（\(rejection)）。"
        }
    }

    /// 改变分割会清空该矩形涂色（FractionBoardState 的显式语义），界面上先提示再执行。
    func adjustPartition(rowsDelta: Int, columnsDelta: Int) {
        guard let id = selectedRectangleId,
              let rect = boardState.board.rectangles.first(where: { $0.id == id }) else { return }
        let rows = rect.rows + rowsDelta, columns = rect.columns + columnsDelta
        switch boardState.setPartition(rectangleId: id, rows: rows, columns: columns) {
        case .success(.partitionChanged(let cleared)):
            if cleared > 0 { status = "这张纸的分割变了，原来的涂色已清空，请重新涂。" }
            schedulePersist()
        case .success:
            schedulePersist()
        case .failure(let rejection):
            status = "这个分割不合法（\(rejection)），没有改动。"
        }
    }

    // MARK: 主动命令

    func submit() {
        guard controls.canSubmit else { return }
        guard let evidence = LearningSnapshot.encodeEvidence(board: boardState.board, ink: latestInk, size: snapshotSize) else {
            status = "证据图片生成失败，本地画布未变，请再试一次。"
            return
        }
        let boardJSON = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(boardState.board))) as? [String: Any] ?? [:]
        client.submit(challengeId: challengeId, boardRevision: evidence.boardRevision,
                      image: evidence.jpeg.base64EncodedString(), board: boardJSON)
        status = "已提交，等老师看看你的想法…"
    }

    func requestHelp() {
        guard controls.canRequestHelp else { return }
        if phase == "transfer" { hintUsedThisAttempt = true }
        client.requestHelp(challengeId: challengeId)
        schedulePersist()
    }

    func contest() {
        guard let feedbackId = client.lastFeedbackId else { return }
        if let index = feedback.firstIndex(where: { $0.feedbackId == feedbackId }) {
            feedback[index].contested = true
        }
        client.contest(feedbackId: feedbackId)
        schedulePersist()
    }

    func startTransfer() {
        guard controls.canStartTransfer else { return }
        client.startTransfer(challengeId: Self.transferChallenge)
    }

    func pause() {
        guard controls.canPause else { return }
        persistDraft(synced: true)
        client.pause()
    }

    func resume() { client.resume() }

    func dismissVoicePrompt() { voicePrompt = nil }

    /// 休息退出：先保存草稿再通知宿主结束；只结束本次会话，不删除任何记录。
    func finishForRest() {
        persistDraft(synced: true)
        client.finishSession(reason: "rest")
        client.stop()
        stage = .entry
        prepareEntry()
        status = "已保存并休息。下次打开可以继续。"
    }

    /// 清空当前画布：只清笔迹与孩子矩形，保留学习记录。与「删除本次学习记录」完全分开。
    func clearCanvas() {
        boardState = FractionBoardState()
        inkClearToken += 1
        latestInk = PKDrawing()
        selectedRectangleId = nil
        schedulePersist()
        status = "当前画布已清空，学习记录仍保留。"
    }

    /// 删除本次学习记录：HTTP DELETE 主机记录 + 删除本地草稿与待决冲突，各自确认后才执行。
    func deleteRecord(host: String) {
        guard let sessionId = client.sessionId ?? loadLastSessionId() else { return }
        Task {
            try? await deleteRemote(host, sessionId)
            try? cache.removeDraft(sessionId: sessionId)
            if loadLastSessionId() == sessionId { storeLastSessionId(nil) }
            client.stop()
            resetLocalSpace()
            stage = .entry
            prepareEntry()
            status = "本次学习记录已删除。"
        }
    }

    /// 退到后台：保存本地草稿并断开连接；重新进入时从「上次停在这里」手动继续。
    func leaveForBackground() {
        guard stage == .active else { return }
        persistTask?.cancel()
        persistDraft(synced: false)
        client.stop()
        stage = .entry
        prepareEntry()
        status = "学习已暂停，点击继续后再连接老师。"
    }

    // MARK: 客户端事件

    private func handleAccepted(_ info: LearningSessionClient.AcceptedInfo) {
        phase = info.phase
        switch info.command {
        case "submit":
            explorationSubmitted = true
            submissions.append(LearningSubmission(submissionId: info.submissionId ?? "",
                                                  challengeId: challengeId,
                                                  boardRevision: boardState.boardRevision,
                                                  hintUsed: hintUsedThisAttempt))
            persistDraft(synced: true)
        case "startTransfer":
            // 迁移使用全新作答空间：新 wholeGroupId、清空矩形层（含全部 AI 提示）与笔迹。
            wholeGroupId = Self.transferWholeGroup
            challengeId = Self.transferChallenge
            boardState = FractionBoardState()
            inkClearToken += 1
            latestInk = PKDrawing()
            hintUsedThisAttempt = false
            selectedRectangleId = nil
            explorationSubmitted = false
            reply = ""
            persistDraft(synced: true)
        case "finishSession":
            persistDraft(synced: true)
        default:
            persistDraft(synced: true)
        }
    }

    private func applyBoardAction(_ action: LearningSessionClient.BoardAction) {
        let baseId = "\(action.submissionId)-\(action.responseId ?? "direct")"
        let agentAction: AgentBoardAction
        switch action.command {
        case let .showHintRectangle(id, whole, rows, columns, shaded):
            agentAction = AgentBoardAction(actionId: "\(baseId)-show-\(id)", type: "showHintRectangle", objectId: nil, cells: nil,
                                           rectangle: FractionRectangle(id: id, wholeGroupId: whole, rows: rows, columns: columns,
                                                                        shadedCells: shaded, owner: .agent))
        case let .highlightCells(objectId, cells):
            agentAction = AgentBoardAction(actionId: "\(baseId)-highlight-\(objectId)", type: "highlightCells",
                                           objectId: objectId, cells: cells, rectangle: nil)
        case let .hideHint(objectId):
            agentAction = AgentBoardAction(actionId: "\(baseId)-hide-\(objectId)", type: "hideHint",
                                           objectId: objectId, cells: nil, rectangle: nil)
        }
        switch boardState.applyAgentAction(agentAction) {
        case .success(.duplicateActionIgnored):
            break // 同一动作重放只生效一次
        case .success:
            schedulePersist()
        case .failure(let rejection):
            status = "主机下发的图形动作被拒绝（\(rejection)），画布未变。"
        }
    }

    // MARK: 草稿

    private func schedulePersist() {
        persistTask?.cancel()
        persistTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            self?.persistDraft(synced: false)
        }
    }

    func persistDraft(synced: Bool) {
        guard let sessionId = client.sessionId ?? loadLastSessionId(), !sessionId.isEmpty else { return }
        let packVersion = client.packVersion.isEmpty ? "fraction-pack-2026-09-17-v1" : client.packVersion
        let draft = LearningSessionDraft(
            schemaVersion: LearningSessionDraft.schemaVersion,
            sessionId: sessionId,
            packVersion: packVersion,
            challengeId: challengeId.isEmpty ? Self.exploreChallenge : challengeId,
            phase: LearningPhase(rawValue: phase.isEmpty ? client.phase : phase) ?? .exploring,
            revision: client.revision,
            childInkBase64: latestInk.dataRepresentation().base64EncodedString(),
            board: LearningBoard(revision: boardState.boardRevision, rectangles: boardState.board.rectangles.map {
                LearningRectangle(id: $0.id, wholeGroupId: $0.wholeGroupId, rows: $0.rows, columns: $0.columns,
                                  shadedCells: $0.shadedCells, owner: $0.owner == .child ? .child : .agent)
            }),
            hintsVisible: !boardState.hintsHidden,
            hintUsed: hintUsedThisAttempt,
            submissions: submissions,
            feedback: feedback,
            synced: synced)
        do {
            try cache.saveDraft(draft)
            storeLastSessionId(sessionId)
        } catch {
            status = "本机保存失败，请保持页面打开；不要声称已保存。"
        }
    }

    private func resetLocalSpace() {
        boardState = FractionBoardState()
        inkClearToken += 1
        latestInk = PKDrawing()
        submissions = []
        feedback = []
        reply = ""
        prompt = ""
        phase = ""
        challengeId = Self.exploreChallenge
        wholeGroupId = Self.exploreWholeGroup
        rectangleSeq = 0
        explorationSubmitted = false
        hintUsedThisAttempt = false
        selectedRectangleId = nil
        conflict = nil
        voicePrompt = nil
    }
}

struct FractionLearningView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = FractionLearningModel()
    @AppStorage("fractionLearningHost") private var host = ""
    @State private var showingRestDialog = false
    @State private var confirmingDelete = false
    @State private var confirmingClear = false

    var body: some View {
        Group {
            if model.stage == .entry { entryView } else { sessionView }
        }
        .padding()
        .background(Color(white: 0.96))
        .preferredColorScheme(.light)
        .onAppear { model.prepareEntry() }
        .onChange(of: scenePhase) { _, phase in if phase == .background { model.leaveForBackground() } }
        .alert("语音确认", isPresented: voicePromptPresented) {
            Button("知道了", role: .cancel) {}
        } message: {
            Text(model.voicePrompt ?? "")
        }
        .alert("进度冲突", isPresented: conflictPresented) {
            Button("保留本机画布") { model.chooseLocalDraft() }
            Button("使用主机进度") { model.chooseRemoteDraft() }
        } message: {
            Text("这台 iPad 与主机都有各自的新进度，双方都已保留，请选择以哪一份继续。")
        }
    }

    private var voicePromptPresented: Binding<Bool> {
        Binding(get: { model.voicePrompt != nil }, set: { if !$0 { model.dismissVoicePrompt() } })
    }

    private var conflictPresented: Binding<Bool> {
        Binding(get: { model.conflict != nil }, set: { _ in })
    }

    private var entryView: some View {
        VStack(spacing: 16) {
            Text("分数探索").font(.headline)
            TextField("Mac 主机地址，例如 192.168.1.10", text: $host)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("fractionHostField")
            if let summary = model.draftSummary {
                Text("上次停在这里：\(summary)")
                    .font(.subheadline)
                Button("继续上次的学习") { model.resumeLastSession(host: host) }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("fractionResume")
            }
            if model.draftSummary == nil {
                Button("开始分数探索") { model.startFresh(host: host) }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("fractionStartFresh")
            } else {
                Button("开始新的探索") { model.startFresh(host: host) }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("fractionStartFresh")
            }
            Text(model.status).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var sessionView: some View {
        VStack(spacing: 8) {
            Text(model.prompt.isEmpty ? "两张同样大的纸，想一想哪张涂得更多。" : model.prompt)
                .font(.title3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("fractionPrompt")
            ZStack {
                ChildCanvasView(clearToken: model.inkClearToken,
                                restored: model.restoredInk,
                                restoreToken: model.inkRestoreToken,
                                onDrawing: { drawing in model.inkChanged(drawing) },
                                onEvents: { _ in })
                FractionBoardView(board: model.boardState.board,
                                  highlights: model.boardState.highlights,
                                  hintsHidden: model.boardState.hintsHidden,
                                  onTapCell: { id, cell in model.toggleCell(rectangleId: id, cell: cell) })
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
            HStack {
                Button("加一张纸") { model.addPaper() }
                if let selected = model.selectedRectangleId,
                   let rect = model.boardState.board.rectangles.first(where: { $0.id == selected }) {
                    Stepper("行 \(rect.rows)") {
                        model.adjustPartition(rowsDelta: 1, columnsDelta: 0)
                    } onDecrement: {
                        model.adjustPartition(rowsDelta: -1, columnsDelta: 0)
                    }
                    Stepper("列 \(rect.columns)") {
                        model.adjustPartition(rowsDelta: 0, columnsDelta: 1)
                    } onDecrement: {
                        model.adjustPartition(rowsDelta: 0, columnsDelta: -1)
                    }
                }
            }
            .font(.subheadline)
            Text(model.status).font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("fractionStatus")
            if !model.reply.isEmpty {
                ScrollView {
                    Text(model.reply).frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("fractionReply")
                }
                    .frame(maxHeight: 80)
            }
            HStack {
                Button("看看我的想法") { model.submit() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.controls.canSubmit)
                    .accessibilityIdentifier("fractionSubmit")
                Button("帮我一下") { model.requestHelp() }
                    .disabled(!model.controls.canRequestHelp)
                    .accessibilityIdentifier("fractionHelp")
                Button("你理解错了") { model.contest() }
                    .disabled(!model.controls.canContest)
                    .accessibilityIdentifier("fractionContest")
            }
            HStack {
                Button("开始迁移") { model.startTransfer() }
                    .disabled(!model.controls.canStartTransfer)
                    .accessibilityIdentifier("fractionStartTransfer")
                if model.controls.canResume {
                    Button("继续") { model.resume() }
                } else {
                    Button("暂停") { model.pause() }
                        .disabled(!model.controls.canPause)
                }
                Button("休息 / 退出") { showingRestDialog = true }
                Button("清空当前画布") { confirmingClear = true }
            }
            .font(.subheadline)
        }
        .confirmationDialog("暂停或结束这次学习", isPresented: $showingRestDialog) {
            Button("休息并保存退出") { model.finishForRest() }
            Button("删除本次学习记录", role: .destructive) { confirmingDelete = true }
            Button("取消", role: .cancel) {}
        }
        .alert("删除本次学习记录？", isPresented: $confirmingDelete) {
            Button("删除", role: .destructive) { model.deleteRecord(host: host) }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将同时删除 Mac 主机与这台 iPad 上的本次记录，不可恢复。只想清空画面请用「清空当前画布」。")
        }
        .alert("清空当前画布？", isPresented: $confirmingClear) {
            Button("清空", role: .destructive) { model.clearCanvas() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("只清空当前画布上的笔迹与矩形，本次学习记录仍然保留。")
        }
    }
}
