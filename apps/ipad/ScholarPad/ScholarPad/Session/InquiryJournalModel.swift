import Foundation
import Combine

enum InquiryKind: String, Codable, CaseIterable, Identifiable {
    case observation, question, conjecture, representation, strategy, verification, transfer, reflection
    var id: String { rawValue }
    var title: String {
        switch self {
        case .observation: "我注意到"
        case .question: "我想问"
        case .conjecture: "我猜想"
        case .representation: "我的表示或解释"
        case .strategy: "我的方法和依据"
        case .verification: "我怎样检查和修正"
        case .transfer: "换个情境试试"
        case .reflection: "回头看看"
        }
    }
}

struct InquiryTransfer: Codable, Equatable {
    var context = ""
    var method = ""
    var check = ""
    var outcome = ""
}
struct InquiryEntry: Codable, Equatable, Identifiable {
    let entryId: String
    let kind: InquiryKind
    let author: String
    let text: String
    let evidenceIds: [String]
    let revises: String?
    let transfer: InquiryTransfer?
    var id: String { entryId }
}
struct InquiryJournal: Codable, Equatable {
    var revision: Int
    var entries: [InquiryEntry]
}
struct InquiryDraft: Codable, Equatable {
    var kind: InquiryKind = .question
    var text = ""
    var revises: String?
    var transfer = InquiryTransfer()
    // Optional keeps existing on-device drafts decodable.
    var evidenceIds: [String]?
}
struct InquiryPending: Codable {
    var entry: InquiryEntry
    var expectedRevision: Int
}

/// 独立于画布的追加式作品记录；网络重试沿用同一条记录的身份。
@MainActor
final class InquiryJournalModel: ObservableObject {
    typealias Fetch = @MainActor () async throws -> InquiryJournal
    typealias Append = @MainActor (InquiryEntry, Int) async throws -> InquiryJournal
    @Published var draft = InquiryDraft() { didSet { _ = persist() } }
    @Published private(set) var journal = InquiryJournal(revision: 0, entries: [])
    @Published private(set) var pending: InquiryPending?
    @Published private(set) var busy = false
    @Published private(set) var conflict = false
    @Published private(set) var status = "可以随时记下想法，不必按顺序，也不必每项都填。"
    private let cacheURL: URL
    private let fetch: Fetch
    private let append: Append
    private struct Cached: Codable {
        let journal: InquiryJournal
        let draft: InquiryDraft
        let pending: InquiryPending?
    }

    init(sessionId: String, host: String, cacheURL: URL? = nil, fetch: Fetch? = nil, append: Append? = nil) {
        let valid = sessionId.range(of: "^[A-Za-z0-9-]{1,80}$", options: .regularExpression) != nil
        self.cacheURL = cacheURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ai-dtl/inquiry-drafts")
            .appendingPathComponent(valid ? "\(sessionId).json" : "invalid-session.json")
        self.fetch = fetch ?? {
            guard valid else { throw WorkspaceError.invalidRecord }
            return try await ProblemCaptureModel.request(host, path: "/workspace/\(sessionId)/inquiry", body: nil)
        }
        self.append = append ?? { entry, expected in
            guard valid else { throw WorkspaceError.invalidRecord }
            let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(entry))
            return try await ProblemCaptureModel.request(host, path: "/workspace/\(sessionId)/inquiry",
                body: ["expectedRevision": expected, "entry": object])
        }
        if let data = try? Data(contentsOf: self.cacheURL), let saved = try? JSONDecoder().decode(Cached.self, from: data) {
            journal = saved.journal; draft = saved.draft; pending = saved.pending
        }
    }

    func load() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do { journal = try await fetch(); _ = persist() }
        catch { status = "暂时连不上学习主机。这里显示本机记录，草稿仍可编辑。" }
    }

    func revise(_ entry: InquiryEntry) {
        guard !busy, pending == nil, !journal.entries.contains(where: { $0.revises == entry.entryId }) else { return }
        draft = .init(kind: entry.kind, text: entry.text, revises: entry.entryId, transfer: entry.transfer ?? .init(), evidenceIds: entry.evidenceIds)
        status = "修改的是新版本，原来的想法会保留。"
    }

    func save() async {
        guard !busy, !conflict else { return }
        if pending == nil {
            guard (draft.evidenceIds?.count ?? 0) <= 20 else { status = "一条想法最多关联20份证据。"; return }
            let text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
            let fields = [draft.transfer.context, draft.transfer.method, draft.transfer.check, draft.transfer.outcome]
            guard !text.isEmpty, text.utf16.count <= 4000,
                  draft.kind != .transfer || fields.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= 4000 }) else {
                status = draft.kind == .transfer ? "请留下新情境、使用的方法、怎样检查和实际结果；没成功也可以记录。每项最多4000字。" : "请先写下想法，最多4000字。"; return
            }
            let normalized = fields.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            pending = .init(entry: .init(entryId: UUID().uuidString, kind: draft.kind, author: "child",
                text: text, evidenceIds: draft.evidenceIds ?? [], revises: draft.revises, transfer: draft.kind == .transfer
                    ? .init(context: normalized[0], method: normalized[1], check: normalized[2], outcome: normalized[3]) : nil),
                expectedRevision: journal.revision)
        }
        // 先持久化发送身份，避免已到主机但收据丢失后重复创建。
        guard persist(), let request = pending else { return }
        busy = true; defer { busy = false }
        do {
            let receipt = try await append(request.entry, request.expectedRevision)
            guard receipt.entries.contains(request.entry) else { throw WorkspaceError.invalidRecord }
            journal = receipt
            pending = nil; draft = .init(); status = "已保存到学习主机。旧版本也保留着。"
            _ = persist()
        } catch WorkspaceError.server(409, _) {
            conflict = true
            if let remote = try? await fetch() { journal = remote }
            status = "主机记录已变化，或修订对象已更新。你的草稿没有丢，请看过记录后再处理。"
            _ = persist()
        } catch { status = "尚未确认保存。草稿已留在本机，重试不会重复记一条。" }
    }

    func retryAfterReview() async {
        guard conflict, !busy else { return }
        pending?.expectedRevision = journal.revision
        conflict = false
        await save()
    }

    func returnToDraft() {
        guard conflict, !busy else { return }
        pending = nil; conflict = false
        // 已有新版本时不能再分叉修订旧稿；保留文字，让孩子选择最新记录。
        if journal.entries.contains(where: { $0.revises == draft.revises && draft.revises != nil }) { draft.revises = nil }
        status = "文字保留为草稿。你可以修改，或在最新记录上继续修订。"
        _ = persist()
    }

    @discardableResult private func persist() -> Bool {
        do {
            let directory = cacheURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var excluded = directory
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try excluded.setResourceValues(values)
            try JSONEncoder().encode(Cached(journal: journal, draft: draft, pending: pending)).write(to: cacheURL, options: .atomic)
            return true
        } catch { status = "本机草稿保存失败，请暂时不要关闭，检查存储空间后重试。"; return false }
    }
}
