import SwiftUI

struct ChildUnderstandingView: View {
    let client: ChildLedgerClient
    @Environment(\.dismiss) private var dismiss
    @State private var understanding: ChildUnderstanding?
    @State private var errorText: String?
    @State private var feedback: String?
    @State private var busy = false
    @State private var deletionSubject: ChildDeletionSubject?
    @State private var deletionPreview: ChildDeletionPreview?

    var body: some View {
        NavigationStack {
            List {
                if let errorText { Text(errorText).accessibilityIdentifier("childLedgerError") }
                if let feedback { Text(feedback).accessibilityIdentifier("childLedgerFeedback") }
                if let data = understanding {
                    Section("系统怎么理解我") {
                        Text(data.scaffoldLine)
                        ForEach(Array(data.activeGuesses.enumerated()), id: \.offset) { _, guess in
                            VStack(alignment: .leading) {
                                Text(guess.text)
                                Button("不是这样") { contest(guess.contestTarget) }.disabled(busy)
                            }
                        }
                    }
                    Section("我问过的问题") {
                        ForEach(Array(data.myQuestions.enumerated()), id: \.offset) { _, item in dated(item.text, at: item.at) }
                    }
                    Section("我尝试过的办法") {
                        ForEach(Array(data.myExplorations.enumerated()), id: \.offset) { _, item in dated(item.label, at: item.at) }
                    }
                    Section("我的作品") {
                        ForEach(Array(data.myArtifacts.enumerated()), id: \.offset) { _, item in
                            VStack(alignment: .leading) {
                                dated("作品 · 第 \(item.versionNo) 版", at: item.at)
                                Button("请删掉") { previewDeletion(.init(subjectKind: .artifact, subjectId: item.artifactId)) }.disabled(busy)
                            }
                        }
                    }
                    Section("我纠正过的理解") {
                        ForEach(Array(data.myCorrectedGuesses.enumerated()), id: \.offset) { _, item in dated(item.text, at: item.at) }
                    }
                    Section("我的新方法") {
                        ForEach(Array(data.myNewMethods.enumerated()), id: \.offset) { _, item in Text(item.text) }
                    }
                    Section("记下来的内容") {
                        ForEach(data.records, id: \.recordId) { record in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(record.text)
                                HStack {
                                    Button("不是这样") { contest(record.contestTarget) }
                                    if record.canRequestDeletion {
                                        Button("请删掉") { previewDeletion(.init(subjectKind: .growthRecord, subjectId: record.recordId)) }
                                    }
                                }.buttonStyle(.bordered).disabled(busy)
                            }
                        }
                    }
                    Section("删除请求") {
                        ForEach(data.deletionRequests, id: \.requestId) { request in
                            Text(request.outcomeText ?? Self.statusTitle(request.status))
                        }
                    }
                } else if busy { ProgressView("正在读取…") }
            }
            .navigationTitle("系统怎么理解我")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("返回画布") { dismiss() } }
                ToolbarItem(placement: .primaryAction) { Button("刷新") { Task { await reload() } }.disabled(busy) }
            }
            .task { await reload() }
            .sheet(isPresented: Binding(get: { deletionPreview != nil }, set: { if !$0 { deletionPreview = nil; deletionSubject = nil } })) {
                VStack(alignment: .leading, spacing: 20) {
                    Text("先看看会影响什么").font(.title2)
                    if let preview = deletionPreview { Text(preview.text).accessibilityIdentifier("deletionPreviewText") }
                    Text("这是请家长一起决定的请求，还没有删除。")
                    if let errorText { Text(errorText) }
                    HStack {
                        Button("先不申请") { deletionPreview = nil; deletionSubject = nil }
                        Button("请家长一起决定") { submitDeletion() }.disabled(busy)
                    }.buttonStyle(.bordered)
                }.padding(24)
            }
        }
    }

    private func dated(_ text: String, at: Double) -> some View {
        VStack(alignment: .leading) {
            Text(text)
            Text(Date(timeIntervalSince1970: at / 1000), style: .date).font(.caption).foregroundStyle(.secondary)
        }
    }

    @MainActor private func reload() async {
        busy = true
        defer { busy = false }
        do { understanding = try await client.understanding(); errorText = nil }
        catch { errorText = "没有读取成功：\(error.localizedDescription)" }
    }

    private func contest(_ target: ContestTarget) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await client.contest(target)
                feedback = "我收到了：这条理解需要重新看。"
                errorText = nil
                await reload()
            } catch { errorText = "这次没有提交成功：\(error.localizedDescription)" }
        }
    }

    private func previewDeletion(_ subject: ChildDeletionSubject) {
        busy = true
        Task {
            defer { busy = false }
            do {
                let preview = try await client.deletionPreview(subject)
                deletionSubject = subject
                deletionPreview = preview
                errorText = nil
            } catch { errorText = "没有读取影响范围：\(error.localizedDescription)" }
        }
    }

    private func submitDeletion() {
        guard let subject = deletionSubject else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                _ = try await client.requestDeletion(subject)
                feedback = "请求已送到家长那里，还没有删除。"
                deletionPreview = nil
                deletionSubject = nil
                errorText = nil
                await reload()
            } catch { errorText = "请求没有提交成功：\(error.localizedDescription)" }
        }
    }

    private static func statusTitle(_ status: String) -> String {
        switch status {
        case "pending": "等家长一起决定"
        case "approved": "家长已同意，正在处理"
        case "rejected": "这次没有删除"
        case "completed", "deleted": "已处理"
        default: "请求正在处理"
        }
    }
}
