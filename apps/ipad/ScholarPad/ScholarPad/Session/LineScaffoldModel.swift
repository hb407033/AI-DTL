import SwiftUI

struct LineScaffoldJournal: Codable, Equatable {
    var revision: Int
    var items: [LineScaffoldOffer]
}
struct LineScaffoldOffer: Codable, Equatable, Identifiable {
    struct Basis: Codable, Equatable {
        var problemId: String
        var problemRevision: Int
        var submissionId: String
        var responseId: String
    }
    struct Anchor: Codable, Equatable {
        var whole: String
        var unit: String
        var sourceQuote: String
    }
    var id: String { offerId }
    var offerId: String
    var basis: Basis
    var meaning: String
    var anchor: Anchor
    var status: String
    var selectedParts: [Int]
    var line: LineScaffoldGeometry?
}
struct LineScaffoldGeometry: Codable, Equatable {
    var kind: String
    var whole: String
    var unit: String
    var partitions: Int
    var meaning: String
    var sourceQuote: String

    func quantityLabel(selected: Int) -> String? {
        guard kind == "line", (2...20).contains(partitions), (0...partitions).contains(selected),
              whole.range(of: #"^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$"#, options: .regularExpression) != nil else { return nil }
        let parts = whole.split(separator: ".")
        let scale = Int64(pow(10.0, Double(parts.count == 2 ? parts[1].count : 0)))
        guard let decimal = Int64(parts.joined()), decimal > 0 else { return nil }
        let numerator = decimal * Int64(selected), denominator = scale * Int64(partitions)
        var a = numerator, b = denominator
        while b != 0 { (a, b) = (b, a % b) }
        let n = numerator / a, d = denominator / a
        return (d == 1 ? "\(n)" : "\(n)/\(d)") + " " + unit
    }
}

/// 提示单独保存，永不写入孩子的 PKDrawing。撤下标记优先于迟到的服务器响应。
@MainActor
final class LineScaffoldModel: ObservableObject {
    @Published private(set) var journal = LineScaffoldJournal(revision: 0, items: [])
    @Published private(set) var busy = false
    @Published private(set) var message = ""
    private var sessionId: String?
    private var dismissed: Set<String> { outbox.dismissed }
    private let outbox: ScaffoldRevocationOutbox
    @Published private(set) var pendingRevocations = 0
    @Published private(set) var syncMessage = ""
    var verifiedHostId: String?
    private var syncing = false
    private var epoch = UUID()
    private var consentEvents: [String: String] = [:]
    var record: (() -> WorkspaceRecord?)?
    init(revocationsURL: URL? = nil) {
        outbox = ScaffoldRevocationOutbox(url: revocationsURL)
        pendingRevocations = outbox.pending.count
        if outbox.loadFailed { syncMessage = "撤销记录读取失败，已保留原文件；请家长检查。" }
    }
    var current: LineScaffoldOffer? {
        guard !outbox.loadFailed else { return nil }
        return journal.items.last { !dismissed.contains($0.offerId) && ["offered", "consented", "visible"].contains($0.status) && isCurrent($0) }
    }
    var evidenceSummary: String? {
        guard !outbox.loadFailed else { return "本机撤销记录读取失败，提示不可用，不能以此判断独立掌握。" }
        guard let offer = journal.items.last else { return nil }
        let status = dismissed.contains(offer.offerId) ? "本机已撤下，不能继续使用" : offer.status
        let line = offer.line.map { "；整体\($0.whole)\($0.unit)，等分\($0.partitions)段，孩子在提示上选择\(offer.selectedParts.count)段" } ?? "；尚未显示图形"
        return "状态：\(status)；含义：\(offer.meaning)\(line)。此记录不代表独立掌握。"
    }
    private func isCurrent(_ offer: LineScaffoldOffer) -> Bool {
        guard let record else { return true } // Pure model tests can supply journals directly.
        guard let r = record(), r.sessionId == sessionId, let p = r.problem,
              p.statement.confirmed, p.problemId == offer.basis.problemId,
              p.statement.revision == offer.basis.problemRevision else { return false }
        return r.submissions.contains { $0.submissionId == offer.basis.submissionId && $0.problemId == p.problemId && $0.problemRevision == p.statement.revision }
            && r.feedback.contains { $0.responseId == offer.basis.responseId && !$0.contested }
    }
    func bind(sessionId: String?) {
        guard self.sessionId != sessionId else { return }
        self.sessionId = sessionId; epoch = UUID()
        journal = .init(revision: 0, items: []); busy = false; message = ""
        // IDs are globally unique; keep local revocations across work switches.
    }
    func accept(_ incoming: LineScaffoldJournal, sessionId: String) {
        guard self.sessionId == sessionId, incoming.revision >= journal.revision else { return }
        journal = incoming
    }
    func dismissLocally() {
        if let offer = current {
            do { try outbox.dismiss(offer.offerId) }
            catch { syncMessage = "提示已撤下，但本机撤销记录尚未保存。" }
        }
        epoch = UUID(); busy = false
        objectWillChange.send()
    }
    func syncRevocations(host: String) async {
        guard !syncing, !outbox.loadFailed, !outbox.pending.isEmpty else { return }
        syncing = true
        defer { syncing = false }
        let hostID = await LearningHostHealth.probe(host)
        await outbox.flush(host: host, hostId: hostID) { item in
            for attempt in 0..<3 {
                let path = "/workspace/\(item.sessionId)/scaffold"
                let latest: LineScaffoldJournal = try await ProblemCaptureModel.request(host, path: path, body: nil)
                guard let offer = latest.items.first(where: { $0.offerId == item.offerId }) else { throw WorkspaceError.invalidRecord }
                if offer.status == "invalidated" || (item.action == "hide" && offer.status == "hidden") {
                    self.accept(latest, sessionId: item.sessionId); return
                }
                do {
                    let incoming: LineScaffoldJournal = try await ProblemCaptureModel.request(host, path: path,
                        body: ["eventId": item.eventId, "expectedRevision": latest.revision,
                               "action": ["type": item.action, "offerId": item.offerId]])
                    guard let acknowledged = incoming.items.first(where: { $0.offerId == item.offerId }),
                          acknowledged.status == "invalidated" || (item.action == "hide" && acknowledged.status == "hidden")
                    else { throw WorkspaceError.invalidRecord }
                    self.accept(incoming, sessionId: item.sessionId)
                    return
                } catch WorkspaceError.server(409, _) where attempt < 2 { continue }
            }
        }
        pendingRevocations = outbox.pending.count
        syncMessage = pendingRevocations == 0 ? "" : "提示已在本机撤下，\(pendingRevocations)项等待原主机同步。"
    }
    func refresh(host: String) async {
        guard let id = sessionId else { return }
        do {
            let incoming: LineScaffoldJournal = try await ProblemCaptureModel.request(host, path: "/workspace/\(id)/scaffold", body: nil)
            accept(incoming, sessionId: id)
        } catch { /* Optional hints never block the child's independent canvas. */ }
    }
    func act(_ type: String, host: String, selectedParts: [Int]? = nil) async {
        guard let id = sessionId, let offer = current else { return }
        let withdrawing = type == "hide" || type == "invalidate"
        guard !busy || withdrawing else { return }
        if withdrawing {
            do { try outbox.enqueue(sessionId: id, offerId: offer.offerId, action: type, host: host, hostId: verifiedHostId) }
            catch { syncMessage = "提示已撤下，但撤销记录未能保存，请保持 App 打开。" }
            epoch = UUID(); busy = false
            pendingRevocations = outbox.pending.count
            objectWillChange.send()
            await syncRevocations(host: host)
            return
        }
        let captured = epoch
        busy = true; message = type == "consent" ? "正在准备辅助图，你可以继续写画。" : ""
        let eventId = type == "consent" ? (consentEvents[offer.offerId] ?? UUID().uuidString) : UUID().uuidString
        if type == "consent" { consentEvents[offer.offerId] = eventId }
        var action: [String: Any] = ["type": type, "offerId": offer.offerId]
        if let selectedParts { action["selectedParts"] = selectedParts }
        do {
            let incoming: LineScaffoldJournal = try await ProblemCaptureModel.request(host, path: "/workspace/\(id)/scaffold",
                body: ["eventId": eventId, "expectedRevision": journal.revision, "action": action])
            guard captured == epoch, sessionId == id else { return }
            accept(incoming, sessionId: id); message = ""
        } catch {
            guard captured == epoch, sessionId == id else { return }
            message = "辅助图暂未完成，可重试；原稿不受影响。"
            await refresh(host: host)
        }
        if captured == epoch { busy = false }
    }
}
