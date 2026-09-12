import Foundation
import Observation
import PencilKit
import CryptoKit

/// 独立于 Agent 的原笔迹队列。一个待传快照、一个在途请求；重试保持原 revision。
@MainActor @Observable
final class DrawingArchive {
    struct Snapshot: Codable {
        var revision: String
        var drawing: Data
        var preview: Data
    }
    struct Cache: Codable { var snapshot: Snapshot; var dirty: Bool }
    private(set) var restored: Data?
    private(set) var restoreToken = 0
    private(set) var status = ""
    private(set) var isDeleted = false
    private var deletionKey = ""
    private var cache: Cache?
    private var endpoint: URL?
    private var cacheURL: URL?
    private var generation = UUID()
    private var debounce: Task<Void, Never>?
    private var uploading = false
    private let transport: @MainActor (URLRequest) async throws -> (Data, URLResponse)

    init(transport: @escaping @MainActor (URLRequest) async throws -> (Data, URLResponse) = { try await URLSession.shared.data(for: $0) }) {
        self.transport = transport
    }

    static func snapshot(_ drawing: PKDrawing) throws -> Snapshot {
        let bounds = drawing.bounds.isEmpty ? CGRect(x: 0, y: 0, width: 1, height: 1) : drawing.bounds.insetBy(dx: -12, dy: -12)
        let scale = min(1, 1536 / max(bounds.width, bounds.height))
        guard let preview = drawing.image(from: bounds, scale: scale).pngData() else { throw URLError(.cannotDecodeContentData) }
        let bytes = drawing.dataRepresentation()
        guard bytes.count <= 4_000_000, preview.count <= 2_000_000 else { throw URLError(.dataLengthExceedsMaximum) }
        return Snapshot(revision: UUID().uuidString, drawing: bytes, preview: preview)
    }

    func configure(host: String, sessionId: String) {
        let url = URL(string: "http://\(host):8788/child/sessions/\(sessionId)/drawing")
        guard endpoint != url else { return }
        generation = UUID(); debounce?.cancel(); endpoint = url; uploading = false; cache = nil
        let key = SHA256.hash(data: Data("\(host)/\(sessionId)".utf8)).map { String(format: "%02x", $0) }.joined()
        deletionKey = "drawing-deleted-" + key
        isDeleted = UserDefaults.standard.bool(forKey: deletionKey)
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Drawings")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var localDirectory = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? localDirectory.setResourceValues(values)
        cacheURL = directory.appendingPathComponent(key + ".json")
        if !isDeleted, let cacheURL, let bytes = try? Data(contentsOf: cacheURL), let saved = try? JSONDecoder().decode(Cache.self, from: bytes), (try? PKDrawing(data: saved.snapshot.drawing)) != nil { cache = saved }
        restored = cache?.snapshot.drawing ?? PKDrawing().dataRepresentation(); restoreToken += 1
        status = isDeleted ? "这幅作品已删除，请开始新一题" : ""
    }

    func changed(_ drawing: PKDrawing) {
        guard !isDeleted else { return }
        let bytes = drawing.dataRepresentation()
        guard bytes.count <= 4_000_000 else { status = "这幅画暂时无法保存，请保留当前画面"; return }
        // PencilKit 可能每个采样点都通知；热路径只保原墨迹，PNG 等停笔后生成。
        cache = Cache(snapshot: Snapshot(revision: UUID().uuidString, drawing: bytes, preview: Data()), dirty: true)
        persist(); schedule()
    }

    private func persist() {
        do { if let cacheURL, let cache { try JSONEncoder().encode(cache).write(to: cacheURL, options: .atomic) } }
        catch { status = "本机保存失败，请保持画面打开" }
    }

    func reconnect() {
        guard !isDeleted else { return }
        if cache?.dirty == true { schedule(); return }
        guard let endpoint else { return }
        let current = generation, revision = cache?.snapshot.revision
        Task {
            do {
                let (data, response) = try await transport(URLRequest(url: endpoint))
                guard generation == current, !isDeleted else { return }
                if (response as? HTTPURLResponse)?.statusCode == 410 { deleteLocalCopy(); return }
                guard cache?.dirty != true, cache?.snapshot.revision == revision else { return }
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
                guard data.count <= 9_100_000 else { throw URLError(.dataLengthExceedsMaximum) }
                let snapshot = try JSONDecoder().decode(Snapshot.self, from: data)
                _ = try PKDrawing(data: snapshot.drawing)
                cache = Cache(snapshot: snapshot, dirty: false); persist()
                restored = snapshot.drawing; restoreToken += 1; status = ""
            } catch { if generation == current { status = "暂未取回笔迹，当前画面会保留" } }
        }
    }

    private func schedule() {
        debounce?.cancel()
        debounce = Task { try? await Task.sleep(for: .milliseconds(700)); guard !Task.isCancelled else { return }; await upload() }
    }

    private func upload() async {
        guard !isDeleted, !uploading, var pending = cache, pending.dirty, let endpoint else { return }
        if pending.snapshot.preview.isEmpty {
            do { pending.snapshot.preview = try Self.snapshot(PKDrawing(data: pending.snapshot.drawing)).preview; cache = pending; persist() }
            catch { status = "这幅画暂时无法保存，请保留当前画面"; return }
        }
        uploading = true
        let current = generation
        defer {
            if generation == current {
                uploading = false
                if !isDeleted, cache?.dirty == true, cache?.snapshot.revision != pending.snapshot.revision { schedule() }
            }
        }
        do {
            var request = URLRequest(url: endpoint); request.httpMethod = "PUT"; request.timeoutInterval = 15
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(pending.snapshot)
            let (_, response) = try await transport(request)
            guard generation == current else { return }
            if (response as? HTTPURLResponse)?.statusCode == 410 { deleteLocalCopy(); return }
            guard let code = (response as? HTTPURLResponse)?.statusCode, code == 200 else {
                status = "笔迹尚未同步，已保留在这台 iPad 上"; return
            }
            if cache?.snapshot.revision == pending.snapshot.revision { cache?.dirty = false; persist(); status = "" }
        } catch { if generation == current { status = "笔迹尚未同步，已保留在这台 iPad 上" } }
    }

    private func deleteLocalCopy() {
        generation = UUID(); uploading = false
        isDeleted = true; UserDefaults.standard.set(true, forKey: deletionKey)
        debounce?.cancel(); cache = nil
        if let cacheURL { try? FileManager.default.removeItem(at: cacheURL) }
        restored = PKDrawing().dataRepresentation(); restoreToken += 1
        status = "这幅作品已删除，请开始新一题"
    }
}
