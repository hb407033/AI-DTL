import SwiftUI
import PencilKit

@MainActor
final class ProblemCaptureModel: ObservableObject {
    var teacherHint: (() -> String?)?
    typealias Transport = @MainActor (URLRequest) async throws -> (Data, URLResponse)
    typealias Save = @MainActor (WorkspaceRecord, Int, String) async throws -> Int
    typealias Fetch = @MainActor (String, String) async throws -> WorkspaceRecord
    @Published var host = UserDefaults.standard.string(forKey: "workspaceHost") ?? ""
    @Published var currentUnit = UserDefaults.standard.string(forKey: "workspaceCurrentUnit") ?? ""
    /// 家长没选单元时不挡住孩子识别：宿主提示词读作“当前单元未指定（按题目内容判断）”。
    static let unspecifiedUnit = "未指定（按题目内容判断）"
    var effectiveUnit: String {
        let unit = currentUnit.trimmingCharacters(in: .whitespacesAndNewlines)
        return unit.isEmpty ? Self.unspecifiedUnit : unit
    }
    /// 只保存家长真正选过的单元，默认说法不写回家长设置。
    private func rememberUnit(_ unit: String) {
        if unit != Self.unspecifiedUnit { UserDefaults.standard.set(unit, forKey: "workspaceCurrentUnit") }
    }
    @Published private(set) var photo: UIImage?
    @Published private(set) var photoCaptureError: String?
    @Published private(set) var record: WorkspaceRecord?
    @Published private(set) var offersResumption = false
    @Published private(set) var needsConfig = false
    @Published private(set) var busy = false
    @Published private(set) var conflictRecord: WorkspaceRecord?
    @Published private(set) var restoreToken = 1
    @Published var status = "先拍一道题，我们一起核对题意。"
    @Published private(set) var drawing = PKDrawing()
    @Published private(set) var questionDraft = ""
    private(set) var localBoardRevision = 0
    private var processTracker = WorkspaceProcessSignalTracker()
    var processSignal: WorkspaceProcessSignal? { processTracker.snapshot }
    private var photoData: Data?
    /// 所选题在照片里的放大区；按照片和题干缓存，每轮证据图不重复做文字识别。
    private var photoFocus: (photo: UIImage, statement: String, focus: PhotoFocus.Focus?)?
    private let transport: Transport
    private let save: Save
    private let fetch: Fetch
    private let cache: WorkspaceCache?
    private var generation = UUID()
    private var pendingSave: WorkspaceRecord?
    private var pendingEvidence: WorkspaceEvidenceSave?
    private var pendingOwnQuestion: OwnQuestionRequest?
    @Published private var pendingPhotoRecognition: PendingPhotoRecognition?
    var photoCandidates: [String] { pendingPhotoRecognition?.candidates ?? [] }
    var requiresStatementRepair: Bool { record?.problem.map { PhotoRecognitionResponse.isNotice($0.statement.text) } ?? false }
    var hasPendingOwnQuestion: Bool { pendingOwnQuestion != nil }
    private var autosave: Task<Void, Never>?
    private var savingTask: Task<Void, Never>?
    var permitsAutosave: (() -> Bool)?

    var diagram: FractionBoardState {
        FractionBoardState(board: FractionBoard(revision: localBoardRevision,
            rectangles: (record?.board.rectangles ?? []).map {
                FractionRectangle(id: $0.id, wholeGroupId: $0.wholeGroupId, rows: $0.rows, columns: $0.columns,
                    shadedCells: $0.shadedCells, owner: $0.owner == .child ? .child : .agent)
            }))
    }
    func editDiagram(_ edit: (inout FractionBoardState) -> Result<FractionBoardEffect, FractionRejection>) {
        guard record?.problem?.statement.confirmed == true else { return }
        var next = diagram
        switch edit(&next) {
        case .failure: status = "这次分格不能应用；最多 60 格、4 个整体，原图仍保留。"; return
        case .success(let effect):
            guard next.boardRevision != localBoardRevision else { return }
            localBoardRevision = next.boardRevision
            record?.board = LearningBoard(revision: localBoardRevision, rectangles: next.board.rectangles.map {
                LearningRectangle(id: $0.id, wholeGroupId: $0.wholeGroupId, rows: $0.rows, columns: $0.columns,
                    shadedCells: $0.shadedCells, owner: $0.owner == .child ? .child : .agent)
            })
            status = "图已保存在本机；说说这个整体代表什么。"
            if case .partitionChanged(let count) = effect, count > 0 { status = "分格改变，旧涂色已清空，请按新格子重新表达。" }
            persist()
        }
    }

    init(transport: Transport? = nil, cache: WorkspaceCache? = nil, save: Save? = nil, fetch: Fetch? = nil) {
        let t: Transport = transport ?? { req in try await URLSession.shared.data(for: req) }
        self.transport = t
        self.cache = cache
        self.save = save ?? { r, e, h in try await Self.saveRecord(r, expected: e, host: h, transport: t) }
        self.fetch = fetch ?? { id, h in try await Self.request(h, path: "/workspace/\(id)", body: nil, transport: t) }
        do {
            if let saved = try cache?.load() {
                photoData = saved.photo; photo = UIImage(data: saved.photo)
                record = saved.record; drawing = try PKDrawing(data: saved.drawing)
                offersResumption = saved.record.flatMap(WorkspaceResumeSummary.make) != nil
                localBoardRevision = saved.boardRevision ?? saved.record?.board.revision ?? 0
                pendingSave = saved.pendingSave
                pendingEvidence = saved.pendingEvidence
                questionDraft = saved.questionDraft ?? ""
                pendingOwnQuestion = saved.pendingOwnQuestion
                pendingPhotoRecognition = saved.pendingPhotoRecognition
                status = "已恢复本机原稿；没有自动连接老师。"
                if !photoCandidates.isEmpty { status = "照片里有多道题，请选择一道，再核对题意。" }
                if requiresStatementRepair { status = "旧题意是识别说明，不是题干。请对照原照重新填写题意，原笔迹保留。" }
            }
        } catch { status = "上次草稿无法读取，已保留原文件。" }
    }
    func dismissResumption() { offersResumption = false }
    func capture(_ image: UIImage) {
        guard !busy else { return }
        guard let data = TutorSnapshot.originalPhoto(image) else {
            status = "这张照片未能保存：照片过大或无法读取。请只对准一道题重拍；原来的照片和笔迹仍保留。"
            photoCaptureError = status
            return
        }
        guard preserveBeforeSwitch() else { photoCaptureError = status; return }
        photoCaptureError = nil
        generation = UUID(); photoData = data; photo = UIImage(data: data); record = nil; drawing = PKDrawing(); localBoardRevision = 0
        processTracker.reset()
        offersResumption = false
        pendingSave = nil; conflictRecord = nil; autosave?.cancel()
        pendingEvidence = nil
        pendingOwnQuestion = nil; questionDraft = ""
        pendingPhotoRecognition = nil
        status = "照片已保存在本机。"
        persist()
    }
    /// 先在本机把照片摆正再保存，原图、预览和识别用的是同一张正向照片。
    func captureUpright(_ image: UIImage) async {
        guard !busy else { return }
        busy = true; status = "正在把照片摆正…"
        let source = PhotoOrientation.Image(image: image)
        let upright = await Task.detached(priority: .userInitiated) { PhotoOrientation.Image(image: PhotoOrientation.upright(source.image)) }.value
        busy = false
        capture(upright.image)
    }
    /// 自动没摆对时，孩子可在识别前手动顺时针转 90°；换成新照片重新识别，不复用旧上传。
    func rotatePhoto() {
        guard !busy, record == nil, let photo, let turned = PhotoOrientation.rotated(photo, quarterTurns: 1, maxEdge: nil) else { return }
        capture(turned)
    }
    func cancelCamera() { /* 取消采集不丢弃已选照片或原稿。 */ }
    func dismissPhotoCaptureError() { photoCaptureError = nil }
    func updateDrawing(_ value: PKDrawing) {
        guard value.dataRepresentation() != drawing.dataRepresentation() else { return }
        drawing = value
        localBoardRevision += 1
        status = "本机已保存，等待同步到学习主机。"
        persist()
        autosave?.cancel()
        autosave = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, let self, self.permitsAutosave?() == true else { return }
            await self.saveToHost()
        }
    }
    func recordDrawingEvents(_ events: [EventPayload]) {
        processTracker.record(events)
    }
    func acceptServerRecord(_ incoming: WorkspaceRecord) throws {
        guard incoming.sessionId == record?.sessionId, incoming.problem == record?.problem,
              incoming.revision >= (record?.revision ?? 0) else { throw WorkspaceError.invalidRecord }
        var merged = incoming
        merged.board = record?.board ?? incoming.board
        // 老师回执已推进版本后，旧离线保存不能再把旧反馈写回去。
        // 笔迹和图形仍在独立本机状态中；下一次保存按新回执重新组装。
        if let pendingSave, incoming.revision >= pendingSave.revision { self.pendingSave = nil }
        record = merged
        persist() // 保留当前 PencilKit 原稿，不用网络快照覆盖刚写的笔迹。
    }
    func freezeEvidence(_ explanation: String) async throws -> WorkspaceEvidence {
        guard let record, let problem = record.problem else { throw WorkspaceError.noProblem }
        let frozen = drawing
        let frozenRevision = localBoardRevision
        let frozenProcessSignal = processTracker.snapshot
        let focus = await focusForEvidence(statement: problem.statement.text)
        let image = TutorSnapshot.workspaceImage(drawing: frozen, statement: problem.statement.text, board: diagram.board, sourcePhoto: photo, photoFocus: focus, teacherHint: teacherHint?())
        guard let jpeg = TutorSnapshot.encode(image) else { throw WorkspaceError.invalidRecord }
        struct Media: Decodable { let mediaId: String }
        let media: Media = try await request(host, path: "/workspace/\(record.sessionId)/media", body: [
            "eventId": UUID().uuidString, "kind": "preview", "base64": jpeg.base64EncodedString(),
        ])
        return WorkspaceEvidence(submissionId: UUID().uuidString, problemId: problem.problemId,
            problemRevision: problem.statement.revision, boardRevision: frozenRevision,
            previewId: media.mediaId, explanation: explanation, processSignal: frozenProcessSignal)
    }
    private func focusForEvidence(statement: String) async -> PhotoFocus.Focus? {
        guard let photo else { return nil }
        if let cached = photoFocus, cached.photo === photo, cached.statement == statement { return cached.focus }
        let wrapped = PhotoOrientation.Image(image: photo)
        let focus = await Task.detached(priority: .userInitiated) { PhotoFocus.locate(wrapped.image, statement: statement) }.value
        if self.photo === photo { photoFocus = (photo, statement, focus) }
        return focus
    }
    /// 保存成功后通知实时同步队列。没接上队列时什么都不做。
    var onRecordSaved: ((WorkspaceRecord) -> Void)?
    func saveToHost() async {
        if let savingTask { await savingTask.value; return }
        guard !busy, record?.problem?.statement.confirmed == true else { return }
        busy = true
        let task = Task { await self.drainSaves() }
        savingTask = task
        await task.value
        savingTask = nil; busy = false
    }
    func saveIndependentEvidence() async {
        guard !busy, let current = record, current.problem?.statement.confirmed == true else { return }
        guard pendingEvidence != nil || !drawing.strokes.isEmpty || !diagram.board.rectangles.isEmpty else {
            status = "先留下你的表示，再把这次尝试存成证据。"; return
        }
        busy = true; defer { busy = false }
        do {
            if pendingEvidence == nil {
                let evidence = try await freezeEvidence("")
                pendingEvidence = .init(eventId: UUID().uuidString, expectedRevision: current.revision, evidence: evidence)
            }
            guard persist(), let pendingEvidence else { return }
            let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(pendingEvidence))
            guard let body = object as? [String: Any] else { throw WorkspaceError.invalidRecord }
            let receipt: WorkspaceRecord = try await request(host, path: "/workspace/\(current.sessionId)/evidence", body: body)
            guard receipt.submissions.contains(pendingEvidence.evidence) else { throw WorkspaceError.invalidRecord }
            try acceptServerRecord(receipt)
            self.pendingEvidence = nil
            guard persist() else { return }
            status = "这次笔迹已留作证据。可以在作品历程中选择它，没有请求老师讲解。"
        } catch WorkspaceError.server(409, _) {
            if let remote = try? await fetch(current.sessionId, host), remote.problem == current.problem {
                do { try acceptServerRecord(remote); pendingEvidence?.expectedRevision = remote.revision; _ = persist() }
                catch { /* 保留原快照，不能用别的题目替代。 */ }
            }
            status = "主机版本已变化，证据快照仍保留。再次点击可重试这份快照，不会重新截取。"
        } catch {
            status = pendingEvidence == nil
                ? "快照上传未完成，当前笔迹仍在本机；重试会截取届时的画布。"
                : "证据保存尚未确认，请检查连接后重试；待提交快照会保留。"
        }
    }
    private func drainSaves() async {
        // 多次保存共享一个在途任务；旧回执到达后只补发最新原稿，不逐笔排长队。
        let deadline = ContinuousClock.now + .seconds(10)
        while var snapshot = record {
            if let pendingSave { snapshot = pendingSave }
            else {
                snapshot.eventId = UUID().uuidString
                snapshot.revision += 1
                snapshot.childInkBase64 = drawing.dataRepresentation().base64EncodedString()
                snapshot.board.revision = localBoardRevision
                pendingSave = snapshot
            }
            let ink = Data(base64Encoded: snapshot.childInkBase64) ?? Data()
            status = "正在保存到学习主机…"
            persist()
            do {
                let revision = try await save(snapshot, snapshot.revision - 1, host)
                guard revision == snapshot.revision else { throw WorkspaceError.invalidRecord }
                let latestBoard = record?.board ?? snapshot.board
                record = snapshot; record?.board = latestBoard; pendingSave = nil
                let caughtUp = drawing.dataRepresentation() == ink && latestBoard.rectangles == snapshot.board.rectangles
                status = caughtUp ? "已保存到学习主机。" : "本机有新笔迹，等待再次同步。"
                persist()
                if let saved = record { onRecordSaved?(saved) }
                if caughtUp || ContinuousClock.now >= deadline { return }
            } catch WorkspaceError.server(409, _) {
                do { conflictRecord = try await fetch(snapshot.sessionId, host).validated() }
                catch { status = "版本冲突且无法读取主机副本；本机原稿保留，联网后重试。"; return }
                status = "主机记录版本冲突；本机原稿已保留，未覆盖任何版本。"; return
            } catch {
                status = "主机保存失败；本机原稿已保留，请检查连接后重试。"; return
            }
        }
    }
    func resolveConflict(useLocal: Bool) async {
        guard !busy, let remote = conflictRecord, let photoData, let local = record else { return }
        do {
            guard remote.sessionId == local.sessionId, remote.problem == local.problem, let cache else { throw WorkspaceError.invalidRecord }
            // 先保存两个版本；任何选择或后续网络失败都可以回查原稿。
            try cache.archiveConflict(local: .init(photo: photoData, drawing: drawing.dataRepresentation(), record: local,
                boardRevision: localBoardRevision, pendingSave: pendingSave), remote: remote)
            let remoteInk = remote.childInkBase64.isEmpty ? PKDrawing() : try PKDrawing(data: Data(base64Encoded: remote.childInkBase64) ?? Data())
            if !useLocal { drawing = remoteInk; localBoardRevision = remote.board.revision; restoreToken += 1; processTracker.reset() }
            else { localBoardRevision = max(localBoardRevision, remote.board.revision) + 1 }
            record = remote
            if useLocal { record?.board = local.board }
            pendingSave = nil; conflictRecord = nil; persist()
            if useLocal { await saveToHost() }
            else { status = "已继续主机版本；本机旧稿和主机副本都已留档。" }
        } catch { status = "不能安全切换版本，双方内容未覆盖。请保留本机草稿。" }
    }
    func reviseStatement(_ text: String) async -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy else { status = "正在保存，请稍等再试；修改内容仍保留。"; return false }
        guard !text.isEmpty, text.count <= 8000, !PhotoRecognitionResponse.isNotice(text) else {
            status = "请填写可核对的题意，不能把重拍说明保存成题干。"; return false
        }
        guard let record, let problem = record.problem, !problem.statement.confirmed || requiresStatementRepair else {
            status = "当前题目已变化，修改内容仍保留，请返回照片核对。"; return false
        }
        busy = true; defer { busy = false }
        status = "正在保存修改，保存后还需核对确认。"
        do {
            let response: WorkspaceRecord = try await request(host, path: "/workspace/\(record.sessionId)/statement", body: [
                "eventId": UUID().uuidString, "expectedRevision": record.revision, "problemId": problem.problemId,
                "statementRevision": problem.statement.revision, "text": text,
            ])
            self.record = try response.validated(); processTracker.reset(); persist()
            status = "修改已保存为新候选，请对照原照再次确认。"
            return true
        } catch { status = "题意修改未保存，请保留修改内容并重试。"; return false }
    }
    @discardableResult private func persist() -> Bool {
        guard let photoData else { return true }
        do {
            try cache?.save(WorkspaceLocalDraft(photo: photoData, drawing: drawing.dataRepresentation(), record: record, boardRevision: localBoardRevision, pendingSave: pendingSave, pendingEvidence: pendingEvidence, questionDraft: questionDraft, pendingOwnQuestion: pendingOwnQuestion, pendingPhotoRecognition: pendingPhotoRecognition))
            return true
        } catch { status = "本机保存失败，请暂时不要退出；原有草稿未覆盖。"; return false }
    }
    private func preserveBeforeSwitch() -> Bool {
        guard persist() else { return false }
        do { try cache?.preserveCurrent(); return true }
        catch { status = "当前草稿留档失败，已取消切换，请不要退出。"; return false }
    }
    func localWorks() throws -> [WorkspaceArchive] {
        guard persist() else { throw WorkspaceError.unavailable }
        return try cache?.archives() ?? []
    }
    func openWork(_ id: String, local: Bool) async -> Bool {
        guard !busy, LearningSessionCache.isValidSessionId(id), preserveBeforeSwitch() else { return false }
        busy = true; autosave?.cancel()
        defer { busy = false }
        do {
            let draft: WorkspaceLocalDraft
            if local {
                guard let saved = try cache?.loadArchive(id) else { throw WorkspaceError.unavailable }
                draft = saved
            } else {
                let remote = try await fetch(id, host).validated()
                guard remote.sessionId == id, let photoId = remote.problem?.photoId,
                      !host.contains("/"), !host.contains("@"),
                      let url = URL(string: "http://\(host):8791/workspace/\(id)/media/\(photoId)") else { throw WorkspaceError.invalidRecord }
                let (photo, response) = try await URLSession.shared.data(from: url)
                guard (response as? HTTPURLResponse)?.statusCode == 200, photo.count <= 2 * 1024 * 1024 else { throw WorkspaceError.unavailable }
                let ink = remote.childInkBase64.isEmpty ? PKDrawing().dataRepresentation() : Data(base64Encoded: remote.childInkBase64)
                guard let ink else { throw WorkspaceError.invalidRecord }
                draft = .init(photo: photo, drawing: ink, record: remote, boardRevision: remote.board.revision)
            }
            guard let image = UIImage(data: draft.photo) else { throw WorkspaceError.invalidRecord }
            let ink = try PKDrawing(data: draft.drawing)
            // 目标稿也先落盘；任一步失败均保留原来的当前稿。
            try cache?.save(draft)
            generation = UUID(); photoData = draft.photo; photo = image; drawing = ink
            processTracker.reset()
            record = draft.record; pendingSave = draft.pendingSave; conflictRecord = nil
            offersResumption = draft.record.flatMap(WorkspaceResumeSummary.make) != nil
            pendingEvidence = draft.pendingEvidence
            questionDraft = draft.questionDraft ?? ""; pendingOwnQuestion = draft.pendingOwnQuestion
            pendingPhotoRecognition = draft.pendingPhotoRecognition
            localBoardRevision = draft.boardRevision ?? draft.record?.board.revision ?? 0
            restoreToken += 1
            if let unit = draft.record?.problem?.curriculum.currentUnit, unit != Self.unspecifiedUnit { currentUnit = unit }
            status = local ? "已打开本机保留稿；同步时会检查主机版本，没有自动开麦。" : "已打开主机作品，原图和笔迹已恢复，没有自动开麦。"
            return true
        } catch { status = "作品未能打开，当前原稿仍保留。请检查连接或作品文件。"; return false }
    }
    func usePhoto() async {
        guard !busy, pendingOwnQuestion == nil, let data = photoData else { return }
        if !photoCandidates.isEmpty { status = "照片里有多道题，请选择一道，再核对题意。"; return }
        let unit = effectiveUnit
        let hostTrimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
        // 缺配置直接引导，不发请求
        if hostTrimmed.isEmpty {
            needsConfig = true
            status = "还没有连接学习主机。请家长在“家长设置”里填写主机地址。"
            return
        }
        if unit.count > 80 {
            needsConfig = true
            status = "家长设置里的当前单元太长了，请改短一点，再点“重试识别”。"
            return
        }
        needsConfig = false
        let id = generation; busy = true
        defer { busy = false }
        // 主机或课程改变时不能重放原请求；保留原照，下一次明确提交新请求。
        if let pending = pendingPhotoRecognition, pending.host != hostTrimmed || pending.unit != unit {
            pendingPhotoRecognition = nil
            if pending.host == nil { status = "旧草稿主机未知，照片保留。点“重试识别”重新提交。" }
            else if pending.host != hostTrimmed { status = "已切换学习主机，照片保留。点“重试识别”重新提交。" }
            else { status = "已切换课程单元，照片保留。点“重试识别”按新课程重新提交。" }
            persist()
            return
        }
        do {
            // 复用持久化的中间状态；回执丢失后重试不建新 session
            if pendingPhotoRecognition == nil {
                status = "正在连接学习主机…"
                let initial: WorkspaceRecord = try await request(host, path: "/workspace/sessions", body: [:])
                pendingPhotoRecognition = PendingPhotoRecognition(
                    host: hostTrimmed,
                    sessionId: initial.sessionId, photoEventId: UUID().uuidString,
                    photoId: nil, previewEventId: UUID().uuidString,
                    previewId: nil, recognizeEventId: UUID().uuidString,
                    expectedRevision: initial.revision, unit: unit)
                guard persist() else { return }
            }
            guard var pending = pendingPhotoRecognition else { throw WorkspaceError.invalidRecord }
            // 上传原图（幂等：已有 photoId 则跳过）
            if pending.photoId == nil {
                status = "正在上传题目照片…"
                struct Media: Decodable { let mediaId: String }
                let media: Media = try await request(host, path: "/workspace/\(pending.sessionId)/media", body: [
                    "eventId": pending.photoEventId, "kind": "problemPhoto", "base64": data.base64EncodedString(),
                ])
                pending.photoId = media.mediaId; pendingPhotoRecognition = pending
                guard persist() else { return }
            }
            // 上传预览（幂等：已有 previewId 则跳过）
            if pending.previewId == nil {
                status = "正在准备识别用的预览…"
                guard let image = UIImage(data: data), let preview = TutorSnapshot.encode(image) else { throw WorkspaceError.invalidRecord }
                struct Media: Decodable { let mediaId: String }
                let media: Media = try await request(host, path: "/workspace/\(pending.sessionId)/media", body: [
                    "eventId": pending.previewEventId, "kind": "preview", "base64": preview.base64EncodedString(),
                ])
                pending.previewId = media.mediaId; pendingPhotoRecognition = pending
                guard persist() else { return }
            }
            guard let photoId = pending.photoId, let previewId = pending.previewId else { throw WorkspaceError.invalidRecord }
            status = "正在识别题目，请稍等；还没有开始讲题。"
            // 识别（幂等：同一 eventId + expectedRevision 返回同一记录）
            let result: PhotoRecognitionResponse = try await request(host, path: "/workspace/\(pending.sessionId)/recognize", body: [
                "eventId": pending.recognizeEventId, "expectedRevision": pending.expectedRevision,
                "photoId": photoId, "previewId": previewId,
                "curriculum": ["edition": "人教版", "grade": 5, "term": "上", "currentUnit": pending.unit],
            ])
            guard generation == id else { return }
            if result.status == "multiple" {
                pending.candidates = result.candidates; pendingPhotoRecognition = pending
                status = "照片里有多道题，请选择一道，再核对题意。"; persist(); return
            }
            if result.status == "unreadable" {
                status = "题目还没看清，照片已保留。可以重拍，或手动写下问题。"; persist(); return
            }
            guard let recognized = result.record else { throw WorkspaceError.invalidRecord }
            let valid = try recognized.validated()
            guard !PhotoRecognitionResponse.isNotice(valid.problem?.statement.text ?? "") else {
                status = "识别返回的是重拍说明，不是题干。照片已保留，请重拍或手动写下问题。"; return
            }
            // 回执校验：sessionId、source、photoId、课程、未确认必须匹配 pending
            guard valid.sessionId == pending.sessionId,
                  valid.problem?.source == "camera",
                  valid.problem?.photoId == pending.photoId,
                  valid.problem?.curriculum.currentUnit == pending.unit,
                  valid.problem?.statement.confirmed == false else {
                throw WorkspaceError.invalidRecord
            }
            guard generation == id else { return }
            processTracker.reset(); record = valid; pendingPhotoRecognition = nil
            UserDefaults.standard.set(host, forKey: "workspaceHost")
            rememberUnit(unit)
            status = "这是候选题意，请对照照片核对；不一致就重拍。"
            persist()
        } catch WorkspaceError.server(503, let reason) {
            guard generation == id else { return }
            status = Self.chineseFeedback(for: 503, reason: reason, fallback: "识别服务暂不可用，照片已保留。请稍后重试。")
        } catch WorkspaceError.server(let code, let reason) {
            guard generation == id else { return }
            status = Self.chineseFeedback(for: code, reason: reason, fallback: "题意核对未完成，照片和原稿仍保留。请检查 Mac 连接后重试。")
        } catch WorkspaceError.invalidHost {
            guard generation == id else { return }
            needsConfig = true
            status = "主机地址无效。请家长在“家长设置”里检查地址。"
        } catch {
            guard generation == id else { return }
            status = "题意核对未完成，照片和原稿仍保留。请检查 Mac 连接后重试。"
        }
    }
    func selectPhotoCandidate(_ index: Int) async {
        guard !busy, record == nil, var pending = pendingPhotoRecognition, let candidates = pending.candidates,
              candidates.indices.contains(index), pending.host == host.trimmingCharacters(in: .whitespacesAndNewlines),
              pending.unit == effectiveUnit, let photoId = pending.photoId else { return }
        let text = candidates[index]
        if let selected = pending.selectedText, selected != text {
            status = "上一项选择尚未确认保存，请先重试原来的选择。"; return
        }
        pending.selectedText = text; pendingPhotoRecognition = pending
        guard persist() else { return }
        busy = true; defer { busy = false }
        let id = generation
        status = "正在保存选择；还没有确认题意或开始讲题。"
        do {
            let result: WorkspaceRecord = try await request(host, path: "/workspace/\(pending.sessionId)/question", body: [
                "eventId": pending.recognizeEventId, "expectedRevision": pending.expectedRevision, "photoId": photoId, "text": text,
                "curriculum": ["edition": "人教版", "grade": 5, "term": "上", "currentUnit": pending.unit],
            ])
            let valid = try result.validated()
            guard generation == id else { return }
            guard valid.sessionId == pending.sessionId, valid.problem?.source == "camera", valid.problem?.photoId == photoId,
                  valid.problem?.statement.text == text, valid.problem?.statement.confirmed == false,
                  valid.problem?.curriculum.currentUnit == pending.unit else { throw WorkspaceError.invalidRecord }
            processTracker.reset(); record = valid; pendingPhotoRecognition = nil
            guard persist() else { return }
            status = "已选好这道题，请对照原照核对数字、单位和问题；可以修改后再确认。"
        } catch { if generation == id { status = "选择尚未确认保存，照片仍在。请重试刚才选择的题，不需要重新识别。" } }
    }
    /// 白名单 reason 映射中文下一步；不暴露远端任意字符串。
    private static func chineseFeedback(for code: Int, reason: String?, fallback: String) -> String {
        switch reason {
        case "recognitionUnavailable": return "识别服务暂未就绪，照片已保留。请稍后重试。"
        case "recognitionPending": return "正在识别中，请稍等。"
        case "recognitionFailed", "invalidRecognition": return "识别未成功，照片已保留。可以重试或重新拍照。"
        case "staleRevision": return "主机记录已更新，请重新拍照。"
        case "missingPhoto": return "照片未找到，请重新拍照。"
        case "modelPhotoTooLarge": return "照片太大，请靠近题目重拍。"
        case "missing": return "学习记录未找到，请重新拍照。"
        case "recognitionTimeout": return "识别超时，照片已保留。可以重试。"
        default: return fallback
        }
    }
    func updateQuestionDraft(_ text: String) {
        guard !busy, pendingOwnQuestion == nil else { return }
        questionDraft = text; persist()
    }
    func useOwnQuestion() async -> Bool {
        guard !busy, record == nil, let photoData else { return false }
        let text = questionDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        let unit = effectiveUnit
        guard !text.isEmpty, text.utf16.count <= 8000, unit.count <= 80 else {
            status = "先写下你想探索的问题。"; return false
        }
        busy = true; defer { busy = false }
        do {
            if pendingOwnQuestion == nil {
                let initial: WorkspaceRecord = try await request(host, path: "/workspace/sessions", body: [:])
                pendingOwnQuestion = .init(sessionId: initial.sessionId, photoEventId: UUID().uuidString,
                    eventId: UUID().uuidString, text: text, unit: unit)
                guard persist() else { return false }
            }
            guard var pending = pendingOwnQuestion else { throw WorkspaceError.invalidRecord }
            if pending.photoId == nil {
                struct Media: Decodable { let mediaId: String }
                let media: Media = try await request(host, path: "/workspace/\(pending.sessionId)/media", body: [
                    "eventId": pending.photoEventId, "kind": "problemPhoto", "base64": photoData.base64EncodedString(),
                ])
                pending.photoId = media.mediaId; pendingOwnQuestion = pending
                guard persist() else { return false }
            }
            guard let photoId = pending.photoId else { throw WorkspaceError.invalidRecord }
            let result: WorkspaceRecord = try await request(host, path: "/workspace/\(pending.sessionId)/question", body: [
                "eventId": pending.eventId, "expectedRevision": 0, "photoId": photoId, "text": pending.text,
                "curriculum": ["edition": "人教版", "grade": 5, "term": "上", "currentUnit": pending.unit],
            ])
            let valid = try result.validated()
            guard valid.sessionId == pending.sessionId, valid.problem?.photoId == photoId,
                  valid.problem?.statement.text == pending.text else { throw WorkspaceError.invalidRecord }
            processTracker.reset(); record = valid; pendingOwnQuestion = nil
            UserDefaults.standard.set(host, forKey: "workspaceHost")
            rememberUnit(pending.unit)
            guard persist() else { return false }
            status = "你的问题已存在学习主机。先确认要探索什么，没有调用老师。"
            return true
        } catch { status = "问题尚未确认保存，照片和文字仍保留。重试会接着提交这份问题。"; return false }
    }
    func confirm() async {
        guard !requiresStatementRepair else { status = "识别说明不能作为题干，请先修改题意。"; return }
        guard !busy, let record, let problem = record.problem, !problem.statement.confirmed else { return }
        busy = true; defer { busy = false }
        do {
            let response: WorkspaceRecord = try await request(host, path: "/workspace/\(record.sessionId)/confirm", body: [
                "eventId": UUID().uuidString, "expectedRevision": record.revision,
                "problemId": problem.problemId, "statementRevision": problem.statement.revision,
            ])
            self.record = try response.validated()
            status = "题意已确认。先写画你的想法，需要时点“一起聊聊”。"
            persist()
        } catch { status = "确认未保存成功，请检查连接后重试。" }
    }
    private func request<T: Decodable>(_ host: String, path: String, body: [String: Any]?, method: String? = nil) async throws -> T {
        try await Self.request(host, path: path, body: body, method: method, transport: transport)
    }
    static func request<T: Decodable>(_ host: String, path: String, body: [String: Any]?, method: String? = nil) async throws -> T {
        try await request(host, path: path, body: body, method: method, transport: { req in try await URLSession.shared.data(for: req) })
    }
    static func request<T: Decodable>(_ host: String, path: String, body: [String: Any]?, method: String? = nil, transport: Transport) async throws -> T {
        let host = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty, !host.contains("/"), !host.contains("@"),
              let url = URL(string: "http://\(host):8791\(path)"), url.host != nil else { throw WorkspaceError.invalidHost }
        var request = URLRequest(url: url, timeoutInterval: 40)
        request.httpMethod = method ?? (body == nil ? "GET" : "POST")
        if let body { request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await transport(request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let reason: String? = {
                guard code >= 400,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
                return json["reason"] as? String
            }()
            throw WorkspaceError.server(code, reason)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    private static func saveRecord(_ record: WorkspaceRecord, expected: Int, host: String, transport: Transport) async throws -> Int {
        struct Receipt: Decodable { let ok: Bool; let savedRevision: Int }
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(record))
        let receipt: Receipt = try await request(host, path: "/workspace/\(record.sessionId)",
            body: ["expectedRevision": expected, "record": object], method: "PUT", transport: transport)
        guard receipt.ok else { throw WorkspaceError.invalidRecord }
        return receipt.savedRevision
    }
}
