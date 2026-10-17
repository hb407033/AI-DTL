import SwiftUI

struct InquiryJournalView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: InquiryJournalModel
    @FocusState private var focusedField: String?
    private let evidence: [WorkspaceEvidence]
    private let host: String
    private let sessionId: String
    init(sessionId: String, host: String, evidence: [WorkspaceEvidence] = []) {
        self.sessionId = sessionId; self.host = host; self.evidence = evidence
        _model = StateObject(wrappedValue: InquiryJournalModel(sessionId: sessionId, host: host))
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("留下自己的想法") {
                    Text("这是你的作品历程，不是老师给你的评价。可以只记一点，之后回来改。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Picker("这次想记", selection: $model.draft.kind) {
                        ForEach(InquiryKind.allCases) { kind in Text(kind.title).tag(kind) }
                    }.disabled(model.draft.revises != nil)
                        .accessibilityIdentifier("inquiryKind")
                    if model.draft.revises != nil { Text("正在修订旧稿，原稿不会被覆盖。").font(.footnote) }
                    TextEditor(text: $model.draft.text).frame(minHeight: 120)
                        .focused($focusedField, equals: "text")
                        .accessibilityLabel("我的想法").accessibilityIdentifier("inquiryText")
                    if model.draft.kind == .transfer {
                        TextField("新的情境是什么？", text: $model.draft.transfer.context, axis: .vertical)
                            .focused($focusedField, equals: "context")
                        TextField("用了原来的什么方法？", text: $model.draft.transfer.method, axis: .vertical)
                            .focused($focusedField, equals: "method")
                        TextField("怎样检查？", text: $model.draft.transfer.check, axis: .vertical)
                            .focused($focusedField, equals: "check")
                        TextField("实际结果怎样？还不明白也可以写", text: $model.draft.transfer.outcome, axis: .vertical)
                            .focused($focusedField, equals: "outcome")
                    }
                }.disabled(model.busy || model.pending != nil)
                if !evidence.isEmpty {
                Section("这条想法的证据 · 自己选择") {
                    ForEach(evidence, id: \.submissionId) { item in
                        Toggle(isOn: Binding(get: { (model.draft.evidenceIds ?? []).contains(item.submissionId) }, set: { selected in
                            var ids = model.draft.evidenceIds ?? []
                            ids.removeAll { $0 == item.submissionId }
                            if selected { ids.append(item.submissionId) }
                            model.draft.evidenceIds = ids
                        })) { Text(item.explanation.isEmpty ? "第 \(item.boardRevision) 版笔迹" : item.explanation).lineLimit(3) }
                            .accessibilityIdentifier("inquiryEvidence-\(item.submissionId)")
                        evidencePreview(item)
                    }
                }.disabled(model.busy || model.pending != nil)
                }
                Section {
                    Text(model.status).accessibilityIdentifier("inquiryStatus")
                    if model.conflict {
                        Button("已看过主机记录，重试保存") { Task { await model.retryAfterReview() } }
                        Button("返回修改草稿") { model.returnToDraft() }
                    } else {
                        Button(model.pending == nil ? "保存这条想法" : "重试保存") { Task { await model.save() } }
                            .accessibilityIdentifier("inquirySave")
                    }
                }.disabled(model.busy)
                Section("已经留下的记录") {
                    if model.journal.entries.isEmpty { Text("还没有已保存的记录。想到什么，就从那里开始。") }
                    ForEach(model.journal.entries.reversed()) { entry in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(entry.kind.title).font(.headline)
                            Text(entry.text).textSelection(.enabled)
                            ForEach(entry.evidenceIds, id: \.self) { id in
                                if let item = evidence.first(where: { $0.submissionId == id }) { evidencePreview(item) }
                                else { Text("关联的证据暂时不可用，记录仍保留。").font(.footnote) }
                            }
                            if entry.author == "parent" { Text("家长记录").font(.caption) }
                            if entry.revises != nil { Text("修订稿 · 原稿保留在下方").font(.caption).foregroundStyle(.secondary) }
                            if let transfer = entry.transfer {
                                Text("新情境：\(transfer.context)\n方法：\(transfer.method)\n检查：\(transfer.check)\n实际结果：\(transfer.outcome)")
                            }
                            if model.journal.entries.contains(where: { $0.revises == entry.entryId }) {
                                Text("已有修订，仍保留这次思考。").font(.caption)
                            } else {
                                Button("修订这条") { model.revise(entry) }
                                    .disabled(model.busy || model.pending != nil || !model.draft.text.isEmpty)
                            }
                        }.padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle("我的作品历程")
            .toolbar { Button("返回画布") { dismiss() }.accessibilityIdentifier("inquiryClose") }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if focusedField != nil { Button("完成输入") { focusedField = nil }.accessibilityIdentifier("inquiryFinishEditing") }
                }
            }
            .task { await model.load() }
        }
    }
    private func evidencePreview(_ item: WorkspaceEvidence) -> some View {
        DisclosureGroup("查看当时的笔迹 · 第 \(item.boardRevision) 版") {
            Text("这是保存时的快照，不会随当前画布改变。").font(.footnote)
            AsyncImage(url: URL(string: "http://\(host):8791/workspace/\(sessionId)/media/\(item.previewId)")) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFit().frame(maxHeight: 320)
                        .accessibilityLabel("保存时的笔迹快照").accessibilityIdentifier("inquirySnapshot-\(item.submissionId)")
                case .failure: Text("暂时无法读取快照，请检查主机连接；关联关系不会被删除。")
                // 折叠内容也可能被 Form 预建；加载提示不需要持续动画。
                default: Text("读取笔迹快照…").foregroundStyle(.secondary)
                }
            }
        }
    }
}
