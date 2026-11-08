import Foundation

struct SyncTurn: Codable, Equatable {
    var turnId: String
    var transcript: String?
    var kind: String?
    var utterance: String?
    var played: Bool?
    var path: String?
    var gateReason: String?
    var latencyMs: Int?
}

struct SyncUsage: Codable, Equatable {
    var sessionId: String
    var turnId: String
    var callId: String
    var responseId: String?
    var purpose: String
    var model: String
    var status: String
    var usage: [String: Int]?
    var estimatedCostCny: Double?
    var latencyMs: Int?
    var path: String?
}

struct SyncBatch: Codable, Equatable {
    var batchId: String
    var sessionId: String
    var seq: Int
    var expectedRevision: Int
    var record: WorkspaceRecord
    var decisions: [TeachingDecisionRecord]
    var turns: [SyncTurn]
    var usage: [SyncUsage]
}

/// 离线批次按文件名顺序补发。200 或重复回执才删文件；409 停住这一课，其它失败留着下次再发。
@MainActor
final class SyncOutbox {
    let directory: URL
    private let request: (String, String, Data) async throws -> (Int, Data)
    private(set) var conflictedSessions: Set<String> = []

    init(directory: URL, request: @escaping (String, String, Data) async throws -> (Int, Data)) {
        self.directory = directory
        self.request = request
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func enqueue(_ batch: SyncBatch) {
        let folder = directory.appendingPathComponent(batch.sessionId, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = String(format: "%06d-%@.json", batch.seq, batch.batchId)
        guard let data = try? JSONEncoder().encode(batch) else { return }
        try? data.write(to: folder.appendingPathComponent(name), options: .atomic)
    }

    var pendingCount: Int { files().count }

    func flush(host: String) async {
        var blocked: Set<String> = conflictedSessions
        for url in files() {
            let sessionId = url.deletingLastPathComponent().lastPathComponent
            if blocked.contains(sessionId) { continue }
            guard let data = try? Data(contentsOf: url) else { continue }
            let path = "/workspace/\(sessionId)/sync"
            do {
                let (status, body) = try await request(host, path, data)
                if status == 200 {
                    try? FileManager.default.removeItem(at: url)
                } else if status == 409 {
                    blocked.insert(sessionId)
                    conflictedSessions.insert(sessionId)
                } else if duplicate(body) {
                    try? FileManager.default.removeItem(at: url)
                }
            } catch {
                // 网络失败留在磁盘，下一轮 flush 仍从这份文件开始。
            }
        }
    }

    private func files() -> [URL] {
        guard let sessions = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return [] }
        return sessions.flatMap { folder -> [URL] in
            (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        }.filter { $0.pathExtension == "json" }.sorted { lhs, rhs in
            let left = lhs.deletingLastPathComponent().lastPathComponent
            let right = rhs.deletingLastPathComponent().lastPathComponent
            if left != right { return left < right }
            return lhs.lastPathComponent < rhs.lastPathComponent
        }
    }

    private func duplicate(_ body: Data) -> Bool {
        guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return false }
        return json["duplicate"] as? Bool == true
    }
}
