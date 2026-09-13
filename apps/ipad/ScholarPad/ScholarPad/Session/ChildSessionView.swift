// 孩子面对的唯一一块屏（设计稿 8.1）：一句任务、一块画布、一个说话入口、常驻的“我卡住了 / 我做完了 / 我想休息 / 你理解错了”。
// 不显示聊天历史、提示级别与任何技术状态；Agent 的话只保留最新一句并朗读，孩子一动就打断。
import SwiftUI

struct ChildSessionView: View {
    @State private var client = SessionClient()
    @State private var drawing = DrawingArchive()
    @State private var voice = AgentVoice()
    @State private var draft = ""
    @State private var draftKind: DraftKind = .thought
    @State private var clearToken = 0
    @State private var breathing = false
    @State private var showNotice = false
    @State private var showUnderstanding = false
    @State private var firstUseNotice: ChildFirstUseNotice?
    @State private var firstUseError: String?
    @State private var noticeBusy = false

    private enum DraftKind: String, CaseIterable, Identifiable {
        case thought = "想法"
        case answer = "答案"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let notice = firstUseNotice, !notice.acknowledged {
                ScrollView {
                    FirstUseNoticeView(notice: notice, isBusy: noticeBusy, acknowledge: acknowledgeFirstUse)
                }.frame(maxHeight: 220)
            }
            if let firstUseError {
                HStack {
                    Text(firstUseError).font(.caption)
                    Button("重试说明") { Task { await loadFirstUse() } }
                }.padding(.horizontal)
            }
            Divider()
            ZStack {
                ChildCanvasView(clearToken: clearToken, restored: drawing.restored, restoreToken: drawing.restoreToken, onDrawing: drawing.changed) { events in
                    childActed()
                    for event in events { client.send(event, source: .childTouch) }
                }
                .allowsHitTesting(!drawing.isDeleted)
                AgentLayerView(objects: client.view.agentObjects, highlightedIds: client.view.highlightedIds, pointer: client.view.pointer)
                if let preview = client.view.memoryPreview, !client.view.isPaused, firstUseNotice?.acknowledged == true {
                    MemoryPreviewCard(preview: preview, act: act)
                }
                if client.view.isPaused { pauseOverlay }
                if let landing = client.view.softLanding { softLandingOverlay(landing) }
                if client.view.isCompleted { completedOverlay }
                noticeBanner
            }
            Divider()
            agentBubble
            if !drawing.status.isEmpty {
                HStack { Text(drawing.status).font(.caption); Button("重试保存") { drawing.reconnect() } }.padding(.horizontal)
            }
            inputBar
            controlBar
        }
        .background(Color(.systemBackground))
        .onAppear { client.connect(); breathing = true }
        .task(id: client.sessionId) { drawing.configure(host: client.host, sessionId: client.sessionId); if client.isConnected { drawing.reconnect() } }
        .onChange(of: client.isConnected) { _, connected in if connected { drawing.configure(host: client.host, sessionId: client.sessionId); drawing.reconnect() } }
        .task(id: client.host) { await loadFirstUse() }
        .sheet(isPresented: $showUnderstanding) {
            if let ledger = ledgerClient { ChildUnderstandingView(client: ledger) }
            else { Text("主机地址暂时不可用，请返回后重试。").padding() }
        }
        .onChange(of: client.view.speakVersion) { _, _ in voice.speak(client.view.agentLine) }
        .onChange(of: client.view.notice) { _, notice in
            guard notice != nil else { return }
            showNotice = true
            Task {
                try? await Task.sleep(for: .seconds(3))
                showNotice = false
                client.clearNotice()
            }
        }
        .alert("你是说：", isPresented: confirmationBinding, presenting: client.view.pendingConfirmation) { confirmation in
            Button("对") { respond(confirmation, confirmed: true) }
            Button("不是") { respond(confirmation, confirmed: false) }
        } message: { confirmation in
            Text("“\(confirmation.text)”")
        }
    }

    // MARK: - 顶部：任务一句话 + 呼吸灯

    private var header: some View {
        HStack(spacing: 12) {
            BrandLogoView()
            Circle()
                .fill(client.isConnected ? Color.green.opacity(0.7) : Color.gray.opacity(0.4))
                .frame(width: 14, height: 14)
                .scaleEffect(breathing && client.view.presence == .listening ? 1.25 : 0.85)
                .animation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true), value: breathing)
                .accessibilityHidden(true)
            Text(client.view.taskText.isEmpty ? "正在准备今天的题目…" : client.view.taskText)
                .font(.title2)
                .lineLimit(2)
                .accessibilityIdentifier("taskText")
            Spacer()
            Button("系统怎么理解我") { showUnderstanding = true }
                .accessibilityIdentifier("openChildUnderstanding")
            Button("清空笔迹", role: .destructive) { clearToken += 1 }
                .font(.caption)
            Button("换一题") {
                client.startNewSession()
                drawing.configure(host: client.host, sessionId: client.sessionId)
            }
                .font(.caption)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    // MARK: - Agent 的话（只留最新一句）

    private var agentBubble: some View {
        HStack {
            Image(systemName: "bubble.left.fill").foregroundStyle(.blue)
            Text(client.view.agentLine.isEmpty ? "我在这里，你先试试看。" : client.view.agentLine)
                .font(.title3)
                .accessibilityIdentifier("agentLine")
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(Color.blue.opacity(0.06))
    }

    // MARK: - 说话入口（语音未接通前用文字代替）

    private var inputBar: some View {
        HStack(spacing: 12) {
            Picker("", selection: $draftKind) {
                ForEach(DraftKind.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .frame(width: 160)
            TextField("说一说你的想法…", text: $draft)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("draftField")
                .onSubmit(sendDraft)
            Button("说") { sendDraft() }
                .buttonStyle(.borderedProminent)
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
    }

    // MARK: - 常驻入口

    private var controlBar: some View {
        HStack(spacing: 16) {
            Button("我卡住了") { act(.helpRequest) }
            Button("我做完了") { act(.done) }
            Button(client.view.isPaused ? "继续" : "我想休息") { act(client.view.isPaused ? .resumeRequest : .pauseRequest(by: "child")) }
            Button("你理解错了") { act(.contest(target: client.view.contestTarget(sessionId: client.sessionId))) }
        }
        .buttonStyle(.bordered)
        .font(.title3)
        .padding(.bottom, 12)
    }

    // MARK: - 覆盖层

    private var pauseOverlay: some View {
        Color.black.opacity(0.35).overlay {
            Text("休息一下，想继续就按“继续”").font(.largeTitle).foregroundStyle(.white)
        }
    }

    private var completedOverlay: some View {
        Color.green.opacity(0.15).overlay {
            Text("今天这一题到这里，你做得很认真。").font(.largeTitle)
        }
        .allowsHitTesting(false)
    }

    private func softLandingOverlay(_ landing: SessionViewState.SoftLanding) -> some View {
        Color.black.opacity(0.35).overlay {
            VStack(spacing: 20) {
                Text(landing.message).font(.title2).foregroundStyle(.white).multilineTextAlignment(.center)
                HStack(spacing: 16) {
                    ForEach(landing.options, id: \.self) { option in
                        Button(Self.softLandingTitle(option)) { act(.softLandingChoice(choice: option)) }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
            .padding(32)
        }
    }

    private var noticeBanner: some View {
        VStack {
            if showNotice, let notice = client.view.notice {
                Text(notice)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule())
                    .accessibilityIdentifier("notice")
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            Spacer()
        }
        .padding(.top, 8)
        .animation(.easeInOut, value: showNotice)
    }

    // MARK: - 动作

    private var confirmationBinding: Binding<Bool> {
        Binding(get: { client.view.pendingConfirmation != nil }, set: { _ in })
    }

    private func respond(_ confirmation: SessionViewState.Confirmation, confirmed: Bool) {
        act(.confirmTranscript(targetEventId: confirmation.targetEventId, confirmed: confirmed, correctedText: nil))
    }

    private func sendDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        childActed()
        // 讲回阶段说的话就是讲回；其余按孩子自己选的“想法 / 答案”发
        let payload: EventPayload
        if client.view.phase == "EXPLAIN_BACK" { payload = .explain(text: text) }
        else if draftKind == .answer { payload = .answer(text: text) }
        else { payload = .utterance(text: text) }
        client.send(payload, source: .childVoice)
    }

    private func act(_ payload: EventPayload) {
        childActed()
        client.send(payload, source: .childButton)
    }

    /// 孩子一动，Agent 就闭嘴（设计稿 8.2）
    private func childActed() { voice.interrupt() }

    private var ledgerClient: ChildLedgerClient? {
        guard let url = URL(string: "ws://\(client.host):8788/session") else { return nil }
        return try? ChildLedgerClient(webSocketURL: url)
    }

    @MainActor private func loadFirstUse() async {
        #if DEBUG
        if let json = ProcessInfo.processInfo.environment["SCHOLARPAD_TEST_FIRST_USE_NOTICE"],
           let notice = try? JSONDecoder().decode(ChildFirstUseNotice.self, from: Data(json.utf8)) {
            firstUseNotice = notice
            return
        }
        #endif
        guard let ledger = ledgerClient else { firstUseError = "学习说明暂时读不到，仍然可以在画布上学习。"; return }
        noticeBusy = true
        defer { noticeBusy = false }
        do { firstUseNotice = try await ledger.firstUseNotice(); firstUseError = nil }
        catch { firstUseError = "学习说明未读取成功：\(error.localizedDescription)" }
    }

    private func acknowledgeFirstUse() {
        guard let notice = firstUseNotice, !notice.acknowledged, let ledger = ledgerClient else { return }
        noticeBusy = true
        Task {
            defer { noticeBusy = false }
            do {
                try await ledger.acknowledgeNotice(version: notice.version)
                firstUseNotice = ChildFirstUseNotice(version: notice.version, text: notice.text, acknowledged: true)
                firstUseError = nil
            } catch { firstUseError = "没有确认成功，请再试一次：\(error.localizedDescription)" }
        }
    }

    private static func softLandingTitle(_ option: String) -> String {
        switch option {
        case "simpler": "换一个更简单的"
        case "hint": "看看一个提示"
        case "stop": "今天先到这里"
        default: option
        }
    }
}
