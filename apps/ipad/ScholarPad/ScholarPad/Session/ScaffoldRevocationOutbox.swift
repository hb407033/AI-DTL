import Foundation

/// Acknowledgements remove pending sends, never the local anti-resurrection tombstone.
@MainActor
final class ScaffoldRevocationOutbox {
    struct Item: Codable, Equatable {
        var eventId: String
        var sessionId: String
        var offerId: String
        var action: String
        var host: String
        var hostId: String?
    }
    private struct Disk: Codable {
        var version = 1
        var dismissed: Set<String> = []
        var pending: [Item] = []
    }
    private var disk = Disk()
    private let url: URL?
    private var readable = true
    private var flushing = false
    var pending: [Item] { disk.pending }
    var dismissed: Set<String> { disk.dismissed }
    var loadFailed: Bool { !readable }

    init(url: URL?) {
        self.url = url
        guard let url, FileManager.default.fileExists(atPath: url.path) else { return }
        do {
            let data = try Data(contentsOf: url)
            if let legacy = try? JSONDecoder().decode(Set<String>.self, from: data) { disk.dismissed = legacy }
            else {
                disk = try JSONDecoder().decode(Disk.self, from: data)
                guard disk.version == 1 else { throw WorkspaceError.invalidRecord }
            }
        } catch { readable = false }
    }
    private func persist() throws {
        guard readable else { throw WorkspaceError.invalidRecord }
        guard let url else { return }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(disk).write(to: url, options: .atomic)
    }
    func dismiss(_ offerId: String) throws {
        disk.dismissed.insert(offerId)
        try persist()
    }
    func enqueue(sessionId: String, offerId: String, action: String, host: String, hostId: String?) throws {
        guard ["hide", "invalidate"].contains(action) else { throw WorkspaceError.invalidRecord }
        disk.dismissed.insert(offerId)
        if !disk.pending.contains(where: { $0.sessionId == sessionId && $0.offerId == offerId && $0.action == action }) {
            disk.pending.append(.init(eventId: UUID().uuidString, sessionId: sessionId, offerId: offerId,
                                      action: action, host: host.trimmingCharacters(in: .whitespacesAndNewlines), hostId: hostId))
        }
        try persist()
    }
    func flush(host: String, hostId: String?, send: (Item) async throws -> Void) async {
        guard !flushing, readable else { return }
        flushing = true
        defer { flushing = false }
        for item in disk.pending {
            let matches = item.hostId.map { $0 == hostId } ?? (item.host == host.trimmingCharacters(in: .whitespacesAndNewlines))
            guard matches else { continue }
            do {
                // Retry local writes before making any remote change.
                try persist()
                try await send(item)
                disk.pending.removeAll { $0.eventId == item.eventId }
                do { try persist() }
                catch { disk.pending.append(item); break }
            } catch { break }
        }
    }
}
