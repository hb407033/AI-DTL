import SwiftUI

private struct PortfolioPage: Decodable {
    struct Item: Decodable, Identifiable {
        let sessionId: String
        let title: String
        let revision: Int
        let inquiryCount: Int
        var id: String { sessionId }
    }
    let items: [Item]
    let nextCursor: String?
    let unavailableCount: Int
}

struct WorkspacePortfolioView: View {
    @ObservedObject var model: ProblemCaptureModel
    @Environment(\.dismiss) private var dismiss
    @State private var local: [WorkspaceArchive] = []
    @State private var items: [PortfolioPage.Item] = []
    @State private var next: String?
    @State private var loading = false
    @State private var message = ""
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("打开旧作品前，当前照片和笔迹会先留在本机。不会自动连接老师。")
                    if !message.isEmpty { Text(message).accessibilityIdentifier("portfolioStatus") }
                    Text(model.status).font(.footnote)
                }
                if !local.isEmpty {
                    Section("本机保留稿 · 离线也能打开") {
                        ForEach(local) { work in
                            Button { open(work.id, local: true) } label: {
                                VStack(alignment: .leading) {
                                    Text(work.title).lineLimit(3)
                                    Text(String(work.id.prefix(8))).font(.caption).foregroundStyle(.secondary)
                                }
                            }.accessibilityIdentifier("portfolioLocal-\(work.id)")
                        }
                    }
                }
                Section("学习主机上的作品") {
                    ForEach(items.filter { item in !local.contains(where: { $0.id == item.id }) }) { item in
                        Button { open(item.id, local: false) } label: {
                            VStack(alignment: .leading) {
                                Text(item.title).lineLimit(3)
                                Text("\(item.inquiryCount) 条想法记录 · \(item.id.prefix(8))").font(.caption).foregroundStyle(.secondary)
                            }
                        }.accessibilityIdentifier("portfolioRemote-\(item.id)")
                    }
                    if next != nil { Button("加载更多作品") { Task { await load(more: true) } } }
                    Button("刷新主机列表") { Task { await load(more: false) } }.accessibilityIdentifier("portfolioRefresh")
                }
            }.disabled(loading || model.busy)
                .overlay { if loading { ProgressView("读取作品…") } }
                .navigationTitle("我的作品")
                .toolbar { Button("返回当前作品") { dismiss() } }
                .task { await load(more: false) }
        }
    }
    private func open(_ id: String, local: Bool) {
        Task { if await model.openWork(id, local: local) { dismiss() } }
    }
    private func load(more: Bool) async {
        guard !loading else { return }
        loading = true; defer { loading = false }
        var localWarning = ""
        do { local = try model.localWorks() }
        catch { localWarning = "本机部分草稿读取失败，原文件仍保留。" }
        do {
            if more, let next, !LearningSessionCache.isValidSessionId(next) { throw WorkspaceError.invalidRecord }
            let query = more ? next.map { "?after=\($0)" } ?? "" : ""
            let page: PortfolioPage = try await ProblemCaptureModel.request(model.host, path: "/workspace/sessions\(query)", body: nil)
            if more { items += page.items.filter { item in !items.contains(where: { $0.id == item.id }) } }
            else { items = page.items }
            next = page.nextCursor
            message = localWarning + (page.unavailableCount > 0 ? "有 \(page.unavailableCount) 份主机文件暂时无法读取，未删除它们。" : "按作品编号分页显示；条目数量不表示掌握程度。")
        } catch { message = localWarning + "暂时连不上主机；仍可打开上面的本机保留稿。" }
    }
}
