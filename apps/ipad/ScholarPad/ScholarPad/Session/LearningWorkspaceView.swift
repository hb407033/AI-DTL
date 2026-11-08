import SwiftUI
import AVFoundation
import PencilKit

/// 同一空间核对、写画与对话；教学授权和当前画布绑定。
struct LearningWorkspaceView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model: ProblemCaptureModel
    @StateObject private var voice = WorkspaceClient()
    @StateObject private var scaffold: LineScaffoldModel
    @StateObject private var discovery = HostDiscovery()
    @StateObject private var drawingTools = CanvasTools()
    @State private var confirmClearInk = false
    @AppStorage("workspaceHostId") private var selectedHostId = ""
    @State private var showCamera = false
    @State private var cameraDenied = false
    @State private var confirmReplace = false
    @State private var validationStatus = "未运行"
    @State private var editingStatement = false
    @State private var statementDraft = ""
    @State private var conflictProbeStatus = ""
    @State private var showInquiry = false
    @State private var showPortfolio = false
    @State private var showParentSettings = false
    @State private var showPhotoSheet = false
    @State private var showTranscriptDetail = false
    @State private var showReplyDetail = false
    @State private var editingOwnQuestion = false
    #if DEBUG
    @State private var lineValidationStep = 0
    @State private var recoveryValidationStep = 0
    #endif
    init() {
        var cache = WorkspaceCache()
        var revocationsURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ai-dtl/scaffold-revocations.json")
        #if DEBUG
        // 自动化草稿与家庭草稿物理隔离；不把测试注入做成儿童端导题入口。
        if let id = ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_TEST_ID"], UUID(uuidString: id) != nil {
            let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("ai-dtl/workspace-validation/\(id)", isDirectory: true)
            cache = WorkspaceCache(directory: root)
            revocationsURL = root.appendingPathComponent("scaffold-revocations.json")
            // confirmed 合成 fixture：仅 DEBUG 隔离测试，不碰家庭 cache、不改儿童生产入口。
            if ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_CONFIRMED_FIXTURE"] != nil {
                Self.writeConfirmedFixture(to: root)
            }
            if ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_CONFIRMED_FIXTURE_WITH_FEEDBACK"] != nil {
                Self.writeConfirmedFixtureWithFeedback(to: root)
            }
        }
        #endif
        var validationTransport: ProblemCaptureModel.Transport?
        #if DEBUG
        if ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_TEST_ID"].flatMap(UUID.init(uuidString:)) != nil,
           let rawPort = ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_HTTP_PORT"], let port = Int(rawPort), (1024...65535).contains(port) {
            validationTransport = { request in
                var request = request
                var components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
                components.port = port; request.url = components.url!
                return try await URLSession.shared.data(for: request)
            }
        }
        #endif
        let captureModel = ProblemCaptureModel(transport: validationTransport, cache: cache)
        #if DEBUG
        if let id = ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_TEST_ID"], UUID(uuidString: id) != nil,
           let testHost = ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_HOST"] {
            captureModel.host = testHost
            if let unit = ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_UNIT"] {
                captureModel.currentUnit = unit
            }
        }
        #endif
        _model = StateObject(wrappedValue: captureModel)
        _scaffold = StateObject(wrappedValue: LineScaffoldModel(revocationsURL: revocationsURL))
    }
    private var simulatedInput: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_TEST_ID"].flatMap(UUID.init(uuidString:)) != nil
        #else
        return false
        #endif
    }
    var body: some View {
        GeometryReader { geometry in
        let wide = geometry.size.width > geometry.size.height && geometry.size.width >= 900
        let confirmed = model.record?.problem?.statement.confirmed == true && !model.requiresStatementRepair
        if confirmed {
            confirmedBody(geometry: geometry, wide: wide)
        } else {
            ScrollViewReader { proxy in
            ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("AI 学科心智学习系统").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Menu {
                        Button("我的作品") { showPortfolio = true }
                        Button("家长设置") { showParentSettings = true }
                        if model.photo != nil { Button("我想提出自己的问题") { editingOwnQuestion = true } }
                    } label: { Image(systemName: "ellipsis.circle").frame(width: 44, height: 44) }
                        .disabled(model.busy || voice.connected).accessibilityLabel("更多选项")
                }
                Text(model.photo == nil ? "拍一道题，一起看看" : model.record == nil ? "看看照片里的题" : "题目认对了吗？").font(.title2.bold())
                if model.photo == nil {
                    Text("可以拍一道题，也可以观察身边的东西，提出自己的问题。").foregroundStyle(.secondary)
                } else {
                    Text(model.status).accessibilityIdentifier("workspaceStatus")
                    if model.needsConfig {
                        Button("去家长设置") { showParentSettings = true }
                            .buttonStyle(.borderedProminent).tint(.orange)
                            .accessibilityIdentifier("workspaceNeedsConfig")
                    }
                    if model.busy {
                        ProgressView().accessibilityIdentifier("workspacePhotoProgress")   // 状态文字上方已显示，转圈不再重复一遍
                    }
                }
                if !scaffold.syncMessage.isEmpty {
                    Text(scaffold.syncMessage).font(.footnote).accessibilityIdentifier("workspaceRevocationSync")
                }
                Button(model.photo == nil ? "拍题并识别" : "重新拍照") {
                    if model.photo != nil { confirmReplace = true } else { openCamera() }
                }.buttonStyle(.borderedProminent).disabled(model.busy || voice.connected).accessibilityIdentifier("workspaceCamera")
                if let photo = model.photo {
                    Image(uiImage: photo).resizable().scaledToFit().frame(maxHeight: wide ? 180 : 260)
                        .accessibilityLabel("题目照片")
                    if model.record == nil {
                        if model.photoCandidates.isEmpty {
                        if !model.busy {
                        HStack {
                            Button("重试识别") { Task { await model.usePhoto() } }
                                .buttonStyle(.bordered).disabled(model.hasPendingOwnQuestion).accessibilityIdentifier("workspaceUsePhoto")
                            Button { model.rotatePhoto(); Task { await model.usePhoto() } } label: {
                                Label("照片歪了，转一下", systemImage: "rotate.right")
                            }.buttonStyle(.bordered).disabled(model.hasPendingOwnQuestion).accessibilityIdentifier("workspaceRotatePhoto")
                        }
                        }
                        } else {
                            Text("照片里有多道题，先选择一道").font(.headline).accessibilityIdentifier("workspaceChooseProblem")
                            ForEach(Array(model.photoCandidates.enumerated()), id: \.offset) { index, candidate in
                                Button { Task { await model.selectPhotoCandidate(index) } } label: {
                                    HStack(alignment: .top) {
                                        Text("\(index + 1)").font(.headline)
                                        Text(candidate).frame(maxWidth: .infinity, alignment: .leading)
                                        Image(systemName: "chevron.right")
                                    }.padding(12).frame(minHeight: 44)
                                }.buttonStyle(.bordered).disabled(model.busy).accessibilityIdentifier("workspaceCandidate-\(index)")
                            }
                        }
                    }
                }
                if model.photo == nil {
                    Text(model.status).accessibilityIdentifier("workspaceStatus")
                }
                if model.offersResumption, !voice.connected, let record = model.record,
                   let summary = WorkspaceResumeSummary.make(record) {
                    WorkspaceResumeView(summary: summary,
                        independent: { model.dismissResumption() },
                        review: { showInquiry = true },
                        talk: { model.dismissResumption(); voice.connect(host: model.host, conversationMode: "dialogue", leadDiscussion: true) })
                        .disabled(model.busy)
                }
                if let problem = model.record?.problem {
                    Text("请对照照片检查").font(.headline)
                    Text(problem.statement.text).textSelection(.enabled).accessibilityIdentifier("workspaceStatement")
                    if !problem.statement.confirmed || model.requiresStatementRepair {
                        if model.requiresStatementRepair {
                            Text("这段是识别说明，不是题干。请对照原照重新填写题意；原笔迹仍保留。")
                                .foregroundStyle(.orange).accessibilityIdentifier("workspaceRecognitionNotice")
                        }
                        Button("修改题意") { statementDraft = problem.statement.text; editingStatement = true }
                            .disabled(model.busy).accessibilityIdentifier("workspaceEditStatement")
                        Button("题目没问题，一起聊聊") {
                            Task {
                                await model.confirm()
                                if model.record?.problem?.statement.confirmed == true && !model.requiresStatementRepair { beginDiscussion() }
                            }
                        }
                            .buttonStyle(.borderedProminent).disabled(model.busy || model.requiresStatementRepair).accessibilityIdentifier("workspaceConfirm")
                        Button("先自己想想") { Task { await model.confirm() } }
                            .frame(minHeight: 44).disabled(model.busy || model.requiresStatementRepair)
                            .accessibilityIdentifier("workspaceConfirmIndependent")
                    }
                }
            }.frame(maxWidth: wide ? 320 : .infinity, alignment: .leading).padding().id("workspaceTop")
            }
            .onChange(of: wide) { _, _ in proxy.scrollTo("workspaceTop", anchor: .top) }
            .onChange(of: model.photo) { _, _ in proxy.scrollTo("workspaceTop", anchor: .top) }
            }
        }
        }
        .toolbar(.hidden, for: .navigationBar)
        .preferredColorScheme(.light)
        .onChange(of: model.record?.problem?.problemId) { _, _ in drawingTools.resetHistory(to: model.drawing) }
        .sheet(isPresented: $showInquiry) {
            if let record = model.record { InquiryJournalView(sessionId: record.sessionId, host: model.host, evidence: record.submissions) }
        }
        .sheet(isPresented: $showPortfolio) { WorkspacePortfolioView(model: model) }
        .sheet(isPresented: $showParentSettings, onDismiss: {
            if voice.recovery == .host { voice.pause() }
        }) {
            WorkspaceParentSettingsView(host: $model.host, currentUnit: $model.currentUnit,
                discovery: discovery, selectedHostId: $selectedHostId, chooseHost: { chooseHost($0) },
                connected: voice.connected, busy: model.busy, claimRealtime: { code in
                    try await RealtimeKeyStore.fetch(host: model.host, code: code)
                })
        }
        .sheet(isPresented: $showPhotoSheet) {
            if let photo = model.photo {
                NavigationStack {
                    VStack(alignment: .leading, spacing: 16) {
                        Image(uiImage: photo).resizable().scaledToFit()
                            .accessibilityLabel("题目原照")
                            .accessibilityIdentifier("workspaceOriginalPhotoFull")
                        if let problem = model.record?.problem {
                            Text(problem.statement.text).textSelection(.enabled).accessibilityIdentifier("workspaceStatement")
                            Button("修改题意") { statementDraft = problem.statement.text; editingStatement = true; showPhotoSheet = false }
                                .disabled(model.busy).accessibilityIdentifier("workspaceEditStatement")
                        }
                        Button(model.photo == nil ? "拍一张照片" : "重新拍照") {
                            showPhotoSheet = false; confirmReplace = true
                        }.disabled(model.busy || voice.connected).accessibilityIdentifier("workspaceCamera")
                    }.padding().navigationTitle("题目与照片")
                        .toolbar { Button("返回") { showPhotoSheet = false } }
                }
            }
        }
        .sheet(isPresented: $showTranscriptDetail) {
            NavigationStack {
                ScrollView { Text("我说：\(voice.transcript)").textSelection(.enabled).padding() }
                    .navigationTitle("我说的话")
                    .toolbar { Button("返回") { showTranscriptDetail = false } }
            }
        }
        .sheet(isPresented: $showReplyDetail) {
            NavigationStack {
                ScrollView { Text(voice.reply).textSelection(.enabled).padding() }
                    .navigationTitle("老师回复")
                    .toolbar { Button("返回") { showReplyDetail = false } }
            }
        }
        .sheet(isPresented: $editingOwnQuestion) {
            NavigationStack {
                VStack(alignment: .leading, spacing: 16) {
                    Text("照片里有什么让你好奇？这次你想弄清楚什么？不必把它改成一道标准题。")
                    TextEditor(text: Binding(get: { model.questionDraft }, set: { model.updateQuestionDraft($0) }))
                        .disabled(model.busy || model.hasPendingOwnQuestion).accessibilityIdentifier("workspaceOwnQuestionEditor")
                    Text("照片和问题先保存在家里的学习主机，不调用老师。确认问题后，你可以先画画、写写自己的猜想。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button(model.hasPendingOwnQuestion ? "重试保存这份问题" : "保存我的问题，再确认") {
                        Task { if await model.useOwnQuestion() { editingOwnQuestion = false } }
                    }.disabled(model.busy || model.questionDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("workspaceSaveOwnQuestion")
                    Text(model.status)
                }.padding().navigationTitle("我的问题")
                    .toolbar { Button("返回照片，草稿保留") { editingOwnQuestion = false } }
            }
        }
        .sheet(isPresented: $editingStatement) {
            NavigationStack {
                VStack(alignment: .leading, spacing: 12) {
                    Text("对照原照修改；也可以使用键盘上的听写。保存后仍需你确认，不会开始讲题。")
                    TextEditor(text: $statementDraft).accessibilityIdentifier("workspaceStatementEditor")
                    Button("保存修改，重新核对") {
                        Task {
                            if await model.reviseStatement(statementDraft) { editingStatement = false }
                        }
                    }.buttonStyle(.borderedProminent)
                        .frame(minHeight: 44)
                        .disabled(model.busy || statementDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("workspaceSaveStatement")
                    Text(model.status)
                }.padding().navigationTitle("修改候选题意")
                    .toolbar { Button("取消") { editingStatement = false } }
            }
        }
        .onAppear {
            if !simulatedInput { discovery.start() }
            restoreHostIdentity()
            voice.record = { model.record }
            model.onRecordSaved = { saved in voice.noteSavedRecord(saved) }
            scaffold.record = { model.record }
            model.teacherHint = { scaffold.evidenceSummary }
            voice.acceptRecord = { try model.acceptServerRecord($0) }
            voice.evidence = { try await model.freezeEvidence($0) }
            voice.acceptScaffold = { journal in
                if let id = model.record?.sessionId { scaffold.accept(journal, sessionId: id) }
            }
            model.permitsAutosave = { !voice.connected }
            #if DEBUG
            if simulatedInput, let preview = ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_CHAT_PREVIEW"] {
                voice.previewConversationForValidation(long: preview == "long")
            }
            if simulatedInput, model.photo == nil,
               let encoded = ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_PHOTO"],
               let data = Data(base64Encoded: encoded), let image = UIImage(data: data) {
                captureAndRecognize(image)
                // 真机无需 UI 测试运行器（不需要 Xcode 账号签名）：识别后自动选题、确认并进入合成语音闭环。
                if ProcessInfo.processInfo.environment["AI_DTL_AUTOSTART"] == "1" { Task { await autostartForValidation() } }
            }
            // 真机启动参数有长度上限，题图改由测试宿主按网址提供。
            if simulatedInput, model.photo == nil, ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_PHOTO"] == nil,
               let raw = ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_PHOTO_URL"], let url = URL(string: raw) {
                Task {
                    guard let (data, response) = try? await URLSession.shared.data(from: url),
                          (response as? HTTPURLResponse)?.statusCode == 200, let image = UIImage(data: data) else {
                        validationStatus = "自动开始失败：题图下载"; return
                    }
                    captureAndRecognize(image)
                    if ProcessInfo.processInfo.environment["AI_DTL_AUTOSTART"] == "1" { await autostartForValidation() }
                }
            }
            #endif
        }
        .onDisappear { discovery.stop(); Task { await voice.finishSession { await model.saveToHost() } } }
        .task(id: "\(discovery.candidates)-\(voice.connected)-\(model.busy)") {
            guard !simulatedInput, !voice.connected, !model.busy else { return }
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            if let previous = discovery.candidates.first(where: { $0.id == selectedHostId }) { chooseHost(previous) }
            else if selectedHostId.isEmpty, discovery.candidates.count == 1 {
                let address = model.host
                let existing = await LearningHostHealth.probe(address)
                guard !Task.isCancelled, address == model.host else { return }
                if existing == nil { chooseHost(discovery.candidates[0]) }
            }
        }
        .onChange(of: model.host) { _, _ in restoreHostIdentity() }
        .task(id: "\(scenePhase)-\(model.host)") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                let address = model.host
                if let id = await LearningHostHealth.probe(address), address == model.host {
                    scaffold.verifiedHostId = id
                    if !simulatedInput {
                        selectedHostId = id
                        UserDefaults.standard.set(address, forKey: "workspaceHost")
                        UserDefaults.standard.set(address, forKey: "workspaceIdentityAddress")
                    }
                }
                guard !Task.isCancelled else { return }
                await scaffold.syncRevocations(host: address)
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .task(id: model.record?.sessionId) {
            scaffold.bind(sessionId: model.record?.sessionId)
            await scaffold.syncRevocations(host: model.host)
            await scaffold.refresh(host: model.host)
        }
        .onChange(of: model.record?.sessionId) { _, _ in voice.resetForWorkChange() }
        .onChange(of: model.record?.problem?.statement.revision) { old, new in
            if old != nil, old != new { scaffold.dismissLocally() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { Task { await voice.finishSession { await model.saveToHost() } } }
            if !simulatedInput {
                if phase == .active { discovery.start() } else if phase == .background { discovery.stop() }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            ProblemCameraView(onCapture: { image in captureAndRecognize(image); showCamera = false },
                onCancel: { model.cancelCamera(); showCamera = false }).ignoresSafeArea()
                .safeAreaInset(edge: .top, alignment: .leading) {
                    Button("返回题目") { model.cancelCamera(); showCamera = false }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("workspaceCancelCamera")
                        .padding()
                }
        }
        .confirmationDialog("当前照片和笔迹会先留在“我的作品”，再开始拍照。", isPresented: $confirmReplace) {
            Button("继续拍照", role: .destructive) { openCamera() }
        }
        .alert("清空当前画布笔迹？", isPresented: $confirmClearInk) {
            Button("确认清空笔迹", role: .destructive) { drawingTools.clear() }
            Button("保留笔迹", role: .cancel) {}
        } message: { Text("照片、题目和已保存的作品不会删除。清空后也可以点撤销恢复。") }
        .alert("相机不可用", isPresented: $cameraDenied) {
            Button("打开设置") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
            Button("返回", role: .cancel) {}
        } message: { Text("请在系统设置允许 AI-DTL 使用相机。本版不读取相册。") }
        .alert("照片没有保存成功", isPresented: Binding(
            get: { model.photoCaptureError != nil },
            set: { if !$0 { model.dismissPhotoCaptureError() } })) {
                Button("重新拍照") { model.dismissPhotoCaptureError(); openCamera() }
                Button("保留原稿", role: .cancel) { model.dismissPhotoCaptureError() }
        } message: { Text(model.photoCaptureError ?? "原来的照片和笔迹仍保留。") }
    }

    // MARK: - confirmed 画布首屏布局（不包整页 ScrollView，画布固定 ≥55% 视口）
    @ViewBuilder private func confirmedBody(geometry: GeometryProxy, wide: Bool) -> some View {
        let problem = model.record?.problem
        if wide {
            HStack(alignment: .top, spacing: 16) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        confirmedHeader(problem: problem, wide: true)
                        Divider()
                        VStack(alignment: .leading, spacing: 12) {
                            Label("一起讨论", systemImage: "waveform").font(.subheadline.weight(.semibold))
                            confirmedVoiceControls(wide: true, chatHeight: min(220, geometry.size.height * 0.29))
                        }
                        Divider()
                        confirmedSecondary(problem: problem)
                    }.padding(20)
                }.frame(width: 268).background(.background, in: RoundedRectangle(cornerRadius: 20))
                writingSurface
            }.padding(12).background(Color(uiColor: .systemGroupedBackground))
        } else {
            VStack(alignment: .leading, spacing: 8) {
                confirmedHeader(problem: problem)
                writingSurface
                confirmedVoiceControls(chatHeight: 64)
                ScrollView { confirmedSecondary(problem: problem) }
                    // 为 44pt 打断触控与恢复入口留空间，次要内容滚动，画布保持优先。
                    .frame(maxHeight: geometry.size.height * 0.075)
            }.padding(12).background(Color(uiColor: .systemGroupedBackground))
        }
    }

    private var writingSurface: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Label("想法画布", systemImage: "pencil.and.outline")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                drawingTool("画笔", icon: "pencil.tip", id: "workspacePen", selected: drawingTools.selected == .pen) { drawingTools.select(.pen) }
                drawingTool("橡皮", icon: "eraser", id: "workspaceEraser", selected: drawingTools.selected == .eraser) { drawingTools.select(.eraser) }
                Divider().frame(height: 24)
                drawingTool("撤销", icon: "arrow.uturn.backward", id: "workspaceUndo") { drawingTools.undo() }
                    .disabled(!drawingTools.canUndo)
                drawingTool("重做", icon: "arrow.uturn.forward", id: "workspaceRedo") { drawingTools.redo() }
                    .disabled(!drawingTools.canRedo)
                drawingTool("清空", icon: "trash", id: "workspaceClearInk") { confirmClearInk = true }
                    .disabled(!drawingTools.hasInk)
            }.padding(.horizontal, 12).padding(.vertical, 6)
                .background(Color(uiColor: .secondarySystemGroupedBackground))
            Divider()
            ChildCanvasView(clearToken: 0, restored: model.drawing.dataRepresentation(), restoreToken: model.restoreToken,
                permitsFingerDrawing: simulatedInput, tools: drawingTools,
                onDrawing: { model.updateDrawing($0) }, onEvents: { model.recordDrawingEvents($0) })
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }.clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.secondary.opacity(0.18)))
    }

    private func drawingTool(_ title: String, icon: String, id: String, selected: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon).font(.system(size: 17, weight: .medium))
                Text(title).font(.caption2)
            }.frame(width: 44, height: 44)
                .foregroundStyle(selected ? Color.accentColor : Color.primary)
                .background(selected ? Color.accentColor.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 10))
                .contentShape(Rectangle())
        }.buttonStyle(.plain).frame(minHeight: 44).accessibilityLabel(title)
            .accessibilityValue(selected ? "已选" : "")
            .accessibilityIdentifier(id)
    }

    @ViewBuilder private func confirmedHeader(problem: WorkspaceProblem?, wide: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 12) {
        if wide {
            HStack {
                Text("AI-DTL · 当前探索").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                settingsButton
            }
        }
        HStack {
            if let photo = model.photo {
                Button { showPhotoSheet = true } label: {
                    Image(uiImage: photo).resizable().scaledToFit()
                        .frame(width: 64, height: 44)
                        .background(.white, in: RoundedRectangle(cornerRadius: 4))
                }.buttonStyle(.plain)
                    .accessibilityLabel("题目原照，点按放大")
                    .accessibilityIdentifier("workspaceViewPhoto")
            }
            Text(problem?.statement.text ?? "").font(.headline).lineLimit(wide ? 5 : 2)
                .accessibilityIdentifier("workspaceStatement")
            if !wide { Spacer(minLength: 0); cameraEntryButton(); settingsButton }
        }
        if wide {
            cameraEntryButton(wide: true)
        }
        }
    }

    private var settingsButton: some View {
        Button { showParentSettings = true } label: {
            Image(systemName: "gearshape").frame(width: 44, height: 44)
        }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("家长设置")
            .disabled(model.busy || voice.connected).accessibilityIdentifier("workspaceParentSettings")
    }

    @ViewBuilder private func confirmedVoiceControls(wide: Bool = false, chatHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VoiceStateBar(phase: VoiceStateBar.phase(connected: voice.connected, listening: voice.listening,
                                                     working: voice.working, thinking: voice.thinking),
                          micLevel: voice.micLevel, detail: voice.status)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if voice.messages.isEmpty {
                            if let previous = model.record?.feedback.last(where: { !$0.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                                Text(previous.contested ? "上次反馈已被你提出异议，不作为学习结论。" : "上次一起讨论：\(previous.summary)")
                                    .font(.footnote).accessibilityIdentifier("workspaceRestoredFeedback")
                            } else { Text("先说说你的想法，老师会接着和你讨论。").font(.footnote).foregroundStyle(.secondary) }
                        }
                        ForEach(voice.messages) { message in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(message.contested ? "\(message.role) · 已提出异议" : message.role)
                                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                Text(message.text).font(.subheadline).textSelection(.enabled)
                            }.frame(maxWidth: .infinity, alignment: .leading).id(message.id)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
                }.frame(height: chatHeight).background(Color(uiColor: .tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityIdentifier("workspaceConversation")
                    .onChange(of: voice.messages.count) { _, _ in
                        if let last = voice.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
            }
            // 记录只在自己的窗口滚动，操作区不随对话内容伸缩。
            HStack(spacing: 8) {
                voiceToggleButton; voiceCorrectButton
            }
        }
        // 紧凑恢复入口（confirmed 重开已有作品时三个选择可触达，不自动开麦）
        if model.offersResumption, !voice.connected, let record = model.record,
           WorkspaceResumeSummary.make(record) != nil {
            HStack {
                Text("可以接着上次的想法写画。").foregroundStyle(.secondary)
                Button("回看想法") { showInquiry = true }
                    .accessibilityIdentifier("workspaceResumeReview")
            }.disabled(model.busy).font(.caption)
        }
    }

    private func cameraEntryButton(wide: Bool = false) -> some View {
        // 复用操作栏已有高度，让拍照常驻可见而不挤占孩子的书写空间。
        Button { confirmReplace = true } label: {
            Group {
                if wide {
                    Label("拍照换题", systemImage: "camera.fill").font(.subheadline.weight(.medium))
                } else {
                    VStack(spacing: 2) {
                        Image(systemName: "camera.fill")
                        Text("拍照").font(.caption)
                    }
                }
            }
            .frame(maxWidth: wide ? .infinity : 44, minHeight: 44)
            .foregroundStyle(Color.accentColor)
            .background(Color.accentColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain).accessibilityLabel("拍照换题")
        .disabled(model.busy || voice.connected).accessibilityIdentifier("workspaceCamera")
    }

    private func captureAndRecognize(_ image: UIImage) {
        Task {
            await model.captureUpright(image)
            guard model.photoCaptureError == nil else { return }
            await model.usePhoto()
        }
    }
    private func beginDiscussion() {
        model.dismissResumption()
        var microphone = true
        #if DEBUG
        if simulatedInput, ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_AUDIO_URL"] != nil { microphone = false }
        #endif
        voice.connect(host: model.host, microphone: microphone, conversationMode: "dialogue", leadDiscussion: true)
    }
    private var voiceToggleButton: some View {
        Button {
            if voice.recovery == .host { showParentSettings = true }
            else if voice.connected && (voice.working || voice.thinking) { voice.interruptReply() }
            else if voice.connected { Task { await voice.finishSession { await model.saveToHost() } } }
            else { beginDiscussion() }
        } label: {
            conversationActionLabel(voice.connected ? ((voice.working || voice.thinking) ? "先停一下" : "结束对话")
                : voice.recovery == .host ? "检查主机" : voice.recovery == .retry ? "重试对话" : "一起聊聊",
                icon: voice.recovery == .host ? "gearshape" : voice.connected ? ((voice.working || voice.thinking) ? "hand.raised.fill" : "stop.fill") : "mic.fill",
                primary: true, tint: voice.connected && !(voice.working || voice.thinking) ? .red : .accentColor)
        }.buttonStyle(.plain).disabled(model.busy).accessibilityIdentifier("workspaceVoice")
    }
    private var voiceClarifyButton: some View {
        Button { voice.authorize("clarify") } label: { conversationActionLabel("解释题意", icon: "questionmark.bubble") }
            .buttonStyle(.plain).disabled(!voice.canAuthorize)
            .accessibilityIdentifier("workspaceClarify")
    }
    private var voiceCorrectButton: some View {
        Button {
            Task { await scaffold.act("invalidate", host: model.host) }
            voice.correctLastFeedback(host: model.host)
        } label: { conversationActionLabel("理解有误", icon: "bubble.left.and.exclamationmark.bubble.right") }
            .buttonStyle(.plain).accessibilityLabel("你理解错了")
            .disabled(model.busy || model.record?.feedback.isEmpty != false).accessibilityIdentifier("workspaceCorrect")
    }

    private func conversationActionLabel(_ title: String, icon: String, primary: Bool = false, tint: Color = .accentColor) -> some View {
        VStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 16, weight: .medium))
            Text(title).font(.caption.weight(.medium)).lineLimit(1).minimumScaleFactor(0.85)
        }.frame(maxWidth: .infinity).frame(height: 48)
            .foregroundStyle(primary ? Color.white : tint)
            .background(primary ? tint : tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
    }

    @ViewBuilder private func confirmedSecondary(problem: WorkspaceProblem?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            LineScaffoldView(model: scaffold, host: model.host)
            if !model.diagram.board.rectangles.isEmpty {
                DisclosureGroup("已有辅助图") {
                    Text("先想想：这个整体代表什么？点格子涂色；改变行列会清空旧涂色。").font(.footnote)
                    Button("添加一个整体") {
                        model.editDiagram { $0.addRectangle(.init(id: UUID().uuidString, wholeGroupId: "child-wholes",
                            rows: 1, columns: 1, shadedCells: [], owner: .child)) }
                    }.disabled(model.diagram.board.rectangles.filter { $0.owner == .child }.count >= 4)
                        .accessibilityIdentifier("workspaceAddDiagram")
                    ForEach(model.diagram.board.rectangles.filter { $0.owner == .child }, id: \.id) { rect in
                        VStack(alignment: .leading) {
                            Text("已涂 \(rect.shadedCells.count) / \(rect.cellCount) 格").accessibilityIdentifier("workspaceDiagramCount")
                            Stepper("\(rect.rows) 行", value: Binding(get: { rect.rows }, set: { rows in
                                model.editDiagram { $0.setPartition(rectangleId: rect.id, rows: rows, columns: rect.columns) }
                            }), in: 1...max(1, 60 / rect.columns))
                            Stepper("\(rect.columns) 列", value: Binding(get: { rect.columns }, set: { columns in
                                model.editDiagram { $0.setPartition(rectangleId: rect.id, rows: rect.rows, columns: columns) }
                            }), in: 1...max(1, 60 / rect.rows))
                            GeometryReader { g in
                                FractionRectangleView(rectangle: rect, frame: CGRect(origin: .zero, size: g.size), onTapCell: { cell in
                                    model.editDiagram { $0.toggleCell(rectangleId: rect.id, cell: cell) }
                                })
                            }.frame(height: 140)
                            Button("移除这个图") { model.editDiagram { $0.removeRectangle(rectangleId: rect.id) } }
                        }.padding(.vertical, 8)
                    }
                }
            }
            DisclosureGroup("我的作品与记录") {
            Button("保存到学习主机") { Task { await model.saveToHost() } }
                .buttonStyle(.bordered).disabled(model.busy || voice.connected).accessibilityIdentifier("workspaceSave")
            Button("把这次笔迹留作证据") { Task { await model.saveIndependentEvidence() } }
                .disabled(model.busy || voice.connected).accessibilityIdentifier("workspaceKeepEvidence")
            HStack {
                Button("我的作品") { showPortfolio = true }
                    .disabled(model.busy || voice.connected).accessibilityIdentifier("workspacePortfolio")
                Button("我的作品历程") { showInquiry = true }
                    .disabled(model.busy || voice.connected).accessibilityIdentifier("workspaceInquiry")
            }
            voiceClarifyButton
            }.accessibilityIdentifier("workspaceMoreRecords")
            if let remote = model.conflictRecord {
                VStack(alignment: .leading, spacing: 8) {
                    Text("发现两个版本：本机第 \(model.record?.revision ?? 0) 版，主机第 \(remote.revision) 版。选择前会把双方副本留档。")
                    Button("保留本机笔迹，接续主机记录") { Task { await model.resolveConflict(useLocal: true) } }
                        .accessibilityIdentifier("workspaceKeepLocal")
                    Button("继续主机版本，本机稿留档") { Task { await model.resolveConflict(useLocal: false) } }
                        .accessibilityIdentifier("workspaceKeepRemote")
                }.disabled(model.busy || voice.connected)
            }
            Text("写画自动留在本机。想聊时再叫老师。").font(.footnote).foregroundStyle(.secondary)
            #if DEBUG
            if simulatedInput {
                Text(model.record?.sessionId ?? "").font(.caption2).accessibilityIdentifier("workspaceTestSession")
                Text(String(model.record?.revision ?? -1)).accessibilityIdentifier("workspaceTestRevision")
                Button("制造隔离测试会话版本冲突") { Task { await createValidationConflict() } }
                    .accessibilityIdentifier("workspaceTestConflict")
                Text(conflictProbeStatus).accessibilityIdentifier("workspaceTestConflictStatus")
            }
            if simulatedInput, ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_AUDIO_URL"] != nil {
                Button("运行合成语音闭环") { Task { await runSyntheticVoice() } }
                    .accessibilityIdentifier("workspaceSyntheticVoice")
                Text(validationStatus).accessibilityIdentifier("workspaceValidationStatus")
            }
            #endif
        }
    }

    #if DEBUG
    /// 仅 DEBUG 隔离测试：写 confirmed 合成 fixture 到指定目录，不碰家庭 cache。
    static func writeConfirmedFixture(to directory: URL) {
        let dir = directory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let record = WorkspaceRecord(schemaVersion: 2, sessionId: "fixture-confirmed-s", eventId: "fixture-confirmed-e",
            revision: 1,
            problem: WorkspaceProblem(problemId: "fixture-p", source: "curated", photoId: nil, challengeId: "fixture-c",
                packVersion: "1", curriculum: WorkspaceCurriculum(currentUnit: "小数乘法"),
                statement: .init(text: "每米彩带2.4元，买0.3米需要多少元？", revision: 0, confirmed: true)),
            phase: "exploring", childInkBase64: "",
            board: LearningBoard(revision: 0, rectangles: []),
            submissions: [], feedback: [], openQuestions: [])
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 60, height: 40)).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 60, height: 40))
        }
        let draft = WorkspaceLocalDraft(photo: photo.jpegData(compressionQuality: 0.8) ?? Data(),
            drawing: PKDrawing().dataRepresentation(), record: record, boardRevision: 0)
        let data = try? JSONEncoder().encode(draft)
        try? data?.write(to: dir.appendingPathComponent("current.json"), options: .atomic)
    }

    /// 仅 DEBUG 隔离测试：写 confirmed + 有表达证据的 fixture，offersResumption 应为 true。
    static func writeConfirmedFixtureWithFeedback(to directory: URL) {
        let dir = directory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let evidence = WorkspaceEvidence(submissionId: "fixture-sub-1", problemId: "fixture-p",
            problemRevision: 0, boardRevision: 0, previewId: "fixture-preview",
            explanation: "我画了3排4列，涂了6格")
        let record = WorkspaceRecord(schemaVersion: 2, sessionId: "fixture-resume-s", eventId: "fixture-resume-e",
            revision: 2,
            problem: WorkspaceProblem(problemId: "fixture-p", source: "curated", photoId: nil, challengeId: "fixture-c",
                packVersion: "1", curriculum: WorkspaceCurriculum(currentUnit: "小数乘法"),
                statement: .init(text: "每米彩带2.4元，买0.3米需要多少元？", revision: 0, confirmed: true)),
            phase: "exploring", childInkBase64: "",
            board: LearningBoard(revision: 0, rectangles: []),
            submissions: [evidence],
            feedback: [WorkspaceFeedback(responseId: "r1", turnId: "t1", summary: "你涂了6格，想想为什么", contested: false)],
            openQuestions: [])
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 60, height: 40)).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 60, height: 40))
        }
        let draft = WorkspaceLocalDraft(photo: photo.jpegData(compressionQuality: 0.8) ?? Data(),
            drawing: PKDrawing().dataRepresentation(), record: record, boardRevision: 0)
        let data = try? JSONEncoder().encode(draft)
        try? data?.write(to: dir.appendingPathComponent("current.json"), options: .atomic)
    }
    #endif

    #if DEBUG
    /// 仅 DEBUG 隔离测试：等识别完成→（多题时）选指定候选→确认题意→开始讨论→运行合成语音闭环。
    private func autostartForValidation() async {
        func waitUntil(_ seconds: Double, _ condition: () -> Bool) async -> Bool {
            let deadline = Date().addingTimeInterval(seconds)
            while Date() < deadline { if condition() { return true }; try? await Task.sleep(for: .milliseconds(300)) }
            return condition()
        }
        guard await waitUntil(120, { !model.busy && (model.record?.problem != nil || !model.photoCandidates.isEmpty) }) else {
            validationStatus = "自动开始失败：识别超时"; return
        }
        if model.record?.problem == nil, !model.photoCandidates.isEmpty {
            let index = Int(ProcessInfo.processInfo.environment["AI_DTL_AUTOSTART_CANDIDATE"] ?? "0") ?? 0
            await model.selectPhotoCandidate(index)
            guard await waitUntil(60, { !model.busy && model.record?.problem != nil }) else { validationStatus = "自动开始失败：选题"; return }
        }
        await model.confirm()
        guard model.record?.problem?.statement.confirmed == true, !model.requiresStatementRepair else { validationStatus = "自动开始失败：确认题意"; return }
        beginDiscussion()
        if ProcessInfo.processInfo.environment["AI_DTL_WORKSPACE_AUDIO_URL"] != nil { await runSyntheticVoice() }
    }
    private func createValidationConflict() async {
        guard simulatedInput, let id = model.record?.sessionId,
              let url = URL(string: "http://\(model.host):8791/workspace/\(id)") else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  var remote = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let revision = remote["revision"] as? Int else { throw WorkspaceError.invalidRecord }
            remote["revision"] = revision + 1; remote["eventId"] = UUID().uuidString
            var request = URLRequest(url: url); request.httpMethod = "PUT"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["expectedRevision": revision, "record": remote])
            let (_, receipt) = try await URLSession.shared.data(for: request)
            guard (receipt as? HTTPURLResponse)?.statusCode == 200 else { throw WorkspaceError.invalidRecord }
            conflictProbeStatus = "主机版本已更新"
        } catch { conflictProbeStatus = "测试冲突准备失败" }
    }
    private func runSyntheticVoice() async {
        guard let base = ProcessInfo.processInfo.processInfoEnvironmentAudioURL else { return }
        if let caseID = ProcessInfo.processInfo.environment["AI_DTL_ADAPTIVE_PHOTO_CASE"], simulatedInput {
            // 验收控制器看完真实老师回应后才提供下一段孩子音频，不能预填教师答案。
            for _ in 0..<900 {
                if voice.connected && !voice.working && voice.completedTurns > 0 { break }
                try? await Task.sleep(for: .milliseconds(100))
            }
            guard voice.connected, !voice.working, let initial = model.record else { validationStatus = "逐题开场失败：\(voice.status)"; return }
            let offset = Int(ProcessInfo.processInfo.environment["AI_DTL_ADAPTIVE_PHOTO_OFFSET"] ?? "0") ?? 0
            guard (0..<10).contains(offset) else { validationStatus = "逐题回放起点无效失败"; return }
            for index in offset..<10 {
                validationStatus = "等待模拟孩子第\(index + 1)轮"
                let deadline = Date().addingTimeInterval(180)
                var pcm: Data?
                do {
                    var parts = URLComponents(url: base.appendingPathComponent(caseID).appendingPathComponent(String(index)), resolvingAgainstBaseURL: false)!
                    parts.queryItems = [URLQueryItem(name: "sessionId", value: initial.sessionId)]
                    while Date() < deadline {
                        let (data, response) = try await URLSession.shared.data(from: parts.url!)
                        let status = (response as? HTTPURLResponse)?.statusCode
                        if status == 204 {
                            await voice.finishSession { await model.saveToHost() }
                            guard let saved = model.record, saved.sessionId == initial.sessionId,
                                  saved.problem == initial.problem, saved.submissions.count >= 4,
                                  model.status == "已保存到学习主机。" else { validationStatus = "逐题保存失败"; return }
                            validationStatus = "逐题讨论已保存"; return
                        }
                        if status == 200 { pcm = data; break }
                        guard status == 404 else { validationStatus = "逐题输入失败"; return }
                        try await Task.sleep(for: .milliseconds(500))
                    }
                    guard let pcm, let before = model.record else { validationStatus = "模拟孩子输入等待超时失败"; return }
                    let count = voice.completedTurns
                    voice.submitPCM(pcm)
                    for _ in 0..<900 {
                        if voice.completedTurns > count || !voice.connected { break }
                        try? await Task.sleep(for: .milliseconds(100))
                    }
                    guard voice.connected, !voice.working, voice.completedTurns > count,
                          let after = model.record, after.submissions.count == before.submissions.count + 1,
                          after.feedback.count == before.feedback.count + 1, after.feedback.last?.contested == false else {
                        validationStatus = "逐题第\(index + 1)轮失败：\(voice.status)"; return
                    }
                    validationStatus = "逐题第\(index + 1)轮已回应"
                } catch { validationStatus = "逐题音频输入失败"; return }
            }
            validationStatus = "逐题达到十轮上限，未通过"; return
        }
        // 单步回放仍走真实语音/授权/播放通道，让 UI 测试在回合之间执行真实暂停和进程重启。
        // 仅隔离 DEBUG 草稿可触达；不自动重连，不替测试掩盖应用本身的失败。
        if ProcessInfo.processInfo.environment["AI_DTL_RECOVERY_REPLAY"] == "1" {
            let offset = Int(ProcessInfo.processInfo.environment["AI_DTL_RECOVERY_AUDIO_OFFSET"] ?? "0") ?? 0
            let index = offset + recoveryValidationStep
            guard voice.connected, !voice.working, (0..<5).contains(index), let before = model.record else {
                validationStatus = "续聊回放未就绪：\(voice.status)"; return
            }
            validationStatus = "续聊第\(index + 1)轮进行中"
            do {
                let (pcm, response) = try await URLSession.shared.data(from: base.appendingPathComponent("\(index)"))
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { validationStatus = "音频夹具失败"; return }
                let count = voice.completedTurns
                voice.submitPCM(pcm)
                for _ in 0..<900 {
                    if voice.completedTurns > count || !voice.connected { break }
                    try? await Task.sleep(for: .milliseconds(100))
                }
                guard voice.connected, !voice.working, voice.completedTurns > count,
                      let after = model.record, after.sessionId == before.sessionId, after.problem == before.problem,
                      after.submissions.count == before.submissions.count + 1,
                      after.feedback.count == before.feedback.count + 1,
                      after.feedback.last?.contested == false, after.feedback.last?.summary.isEmpty == false else {
                    validationStatus = "续聊第\(index + 1)轮失败：\(voice.status)"; return
                }
                recoveryValidationStep += 1
                validationStatus = "续聊第\(index + 1)轮完成"
            } catch { validationStatus = "音频读取失败" }
            return
        }
        if ProcessInfo.processInfo.environment["AI_DTL_DIALOGUE_LOOP"] == "1" {
            await runSyntheticDialogue(base: base); return
        }
        if ProcessInfo.processInfo.environment["AI_DTL_LINE_LOOP"] == "1" {
            await runSyntheticLineVoice(base: base); return
        }
        let natural = ProcessInfo.processInfo.environment["AI_DTL_NATURAL_LOOP"] == "1"
        validationStatus = "连接中"
        voice.connect(host: model.host, microphone: false)
        for _ in 0..<200 { if voice.connected { break }; try? await Task.sleep(for: .milliseconds(100)) }
        guard voice.connected else { validationStatus = "连接失败：\(voice.status)"; return }
        for index in 0..<5 {
            validationStatus = "第\(index + 1)轮"
            do {
                let (pcm, response) = try await URLSession.shared.data(from: base.appendingPathComponent("\(index)"))
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { validationStatus = "音频夹具失败"; return }
                let count = voice.completedTurns
                voice.submitPCM(pcm)
                for _ in 0..<1200 {
                    if voice.completedTurns > count || !voice.connected { break }
                    try? await Task.sleep(for: .milliseconds(100))
                }
                guard voice.connected, voice.completedTurns > count else { validationStatus = "第\(index + 1)轮失败：\(voice.status)"; return }
                if natural {
                    let expected = [0, 1, 2, 2, 3][index]
                    guard model.record?.feedback.count == expected else {
                        validationStatus = "第\(index + 1)轮失败：自然接续或独立尝试边界错误"; return
                    }
                }
                if index == 1 && !natural {
                    let before = voice.completedTurns
                    voice.authorize("clarify")
                    for _ in 0..<1200 {
                        if voice.completedTurns > before || !voice.connected { break }
                        try? await Task.sleep(for: .milliseconds(100))
                    }
                    guard voice.connected, voice.completedTurns > before else { validationStatus = "澄清失败：\(voice.status)"; return }
                }
            } catch { validationStatus = "音频读取失败"; return }
        }
        await voice.finishSession { await model.saveToHost() }
        if natural {
            guard let record = model.record, record.feedback.count == 3, record.submissions.count == 3,
                  record.feedback.allSatisfy({ !$0.contested && !$0.summary.isEmpty && $0.summary.count <= 60 }) else {
                validationStatus = "自然闭环失败：回应或证据不完整"; return
            }
            validationStatus = "自然学习闭环已保存"; return
        }
        guard let record = model.record, record.feedback.count == 3, record.submissions.count == 2,
              record.feedback.filter({ $0.contested }).count == 1 else { validationStatus = "证据或纠正记录不匹配"; return }
        guard record.feedback.allSatisfy({ !$0.summary.contains("0.72") && !$0.summary.contains("角") && !$0.summary.contains("还没画") && $0.summary.count <= 60 }) else {
            validationStatus = "教学边界失败：跑题、泄露答案或过长"; return
        }
        guard record.feedback[1].summary != record.feedback[2].summary else {
            validationStatus = "教学边界失败：求助后原样重复上一问"; return
        }
        validationStatus = "五轮语音、画布证据和纠正已保存"
    }
    /// 隔离真机验收：沿真实照片、PencilKit 快照和连续对话通道，只有孩子音频为合成夹具。
    private func runSyntheticDialogue(base: URL) async {
        validationStatus = "等待老师观察作品"
        if !voice.connected { beginDiscussion() }
        for _ in 0..<900 {
            if voice.connected && voice.completedTurns > 0 && !voice.working { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard voice.connected, voice.completedTurns > 0, !voice.working else {
            validationStatus = "开场失败：\(voice.status)"; return
        }
        let requestedTurns = Int(ProcessInfo.processInfo.environment["AI_DTL_DIALOGUE_TURNS"] ?? "3") ?? 3
        let turnCount = min(8, max(1, requestedTurns))
        for index in 0..<turnCount {
            validationStatus = "讨论第\(index + 1)轮"
            do {
                let (pcm, response) = try await URLSession.shared.data(from: base.appendingPathComponent("\(index)"))
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { validationStatus = "音频夹具失败"; return }
                let count = voice.completedTurns
                voice.submitPCM(pcm)
                for _ in 0..<900 {
                    if voice.completedTurns > count || !voice.connected { break }
                    try? await Task.sleep(for: .milliseconds(100))
                }
                guard voice.connected, voice.completedTurns > count else {
                    validationStatus = "讨论失败：\(voice.status)"; return
                }
            } catch { validationStatus = "音频读取失败"; return }
        }
        await voice.finishSession { await model.saveToHost() }
        guard let record = model.record, record.submissions.count == turnCount, record.feedback.count == turnCount + 1,
              record.feedback.allSatisfy({ !$0.contested && !$0.summary.isEmpty }),
              Set(record.feedback.map(\.summary)).count == turnCount + 1,
              !record.feedback[0].summary.contains("0.72"), !record.feedback[0].summary.contains("零点七二") else {
            validationStatus = "讨论证据或开场边界不符"; return
        }
        if ProcessInfo.processInfo.environment["AI_DTL_DECISION_VERDICT"] == "1" {
            // 拍照会创建新的作品ID；沿应用已经连通的通道核对实际作品，不能用启动时的隔离缓存ID。
            do {
                let url = base.deletingLastPathComponent().appendingPathComponent("verdict").appendingPathComponent(record.sessionId)
                let (data, response) = try await URLSession.shared.data(from: url)
                guard (response as? HTTPURLResponse)?.statusCode == 200,
                      let verdict = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      verdict["valid"] as? Bool == true else {
                    validationStatus = "教学决策验收未通过"; return
                }
            } catch { validationStatus = "教学决策验收连接失败"; return }
        }
        validationStatus = "拍照学习讨论已保存"
    }
    private func runSyntheticLineVoice(base: URL) async {
        let first = lineValidationStep == 0
        validationStatus = "连接合成语音测试"
        if !voice.connected { voice.connect(host: model.host, microphone: false) }
        for _ in 0..<200 { if voice.connected { break }; try? await Task.sleep(for: .milliseconds(100)) }
        guard voice.connected else { validationStatus = "失败：语音未连接"; return }
        for index in (first ? 0...1 : 2...3) {
            do {
                let (pcm, response) = try await URLSession.shared.data(from: base.appendingPathComponent("\(index)"))
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { validationStatus = "失败：合成音频缺失"; return }
                let before = voice.completedTurns
                voice.submitPCM(pcm)
                for _ in 0..<900 {
                    if voice.completedTurns > before || !voice.connected { break }
                    try? await Task.sleep(for: .milliseconds(100))
                }
                guard voice.connected, voice.completedTurns > before else { validationStatus = "失败：\(voice.status)"; return }
            } catch { validationStatus = "失败：音频请求异常"; return }
        }
        if first {
            for _ in 0..<400 {
                if scaffold.current != nil { break }
                try? await Task.sleep(for: .milliseconds(100))
            }
            guard scaffold.current?.status == "offered" else { validationStatus = "失败：语音求助没有收到邀请"; return }
            lineValidationStep = 1; validationStatus = "语音求助邀请已到达"
        } else {
            await voice.finishSession { await model.saveToHost() }
            guard model.record?.feedback.count ?? 0 >= 2, model.record?.submissions.count ?? 0 >= 2 else {
                validationStatus = "失败：后续表达证据未保存"; return
            }
            validationStatus = "隐藏后独立表达已保存"
        }
    }
    #endif
    private func chooseHost(_ host: HostDiscovery.Candidate) {
        guard !voice.connected, !model.busy else { return }
        selectedHostId = host.id
        model.host = host.address
        scaffold.verifiedHostId = host.id
        UserDefaults.standard.set(host.address, forKey: "workspaceHost")
        UserDefaults.standard.set(host.address, forKey: "workspaceIdentityAddress")
    }
    private func restoreHostIdentity() {
        scaffold.verifiedHostId = !simulatedInput && !selectedHostId.isEmpty
            && UserDefaults.standard.string(forKey: "workspaceIdentityAddress") == model.host ? selectedHostId : nil
    }
    private func openCamera() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { cameraDenied = true; return }
        Task { @MainActor in
            let allowed = await AVCaptureDevice.requestAccess(for: .video)
            if allowed { showCamera = true } else { cameraDenied = true }
        }
    }
}

#if DEBUG
private extension ProcessInfo {
    var processInfoEnvironmentAudioURL: URL? { environment["AI_DTL_WORKSPACE_AUDIO_URL"].flatMap(URL.init(string:)) }
}
#endif
