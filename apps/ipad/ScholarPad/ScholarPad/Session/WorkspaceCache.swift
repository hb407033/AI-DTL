import Foundation
import PencilKit

struct OwnQuestionRequest: Codable {
    let sessionId: String
    let photoEventId: String
    var photoId: String?
    let eventId: String
    let text: String
    let unit: String
}

struct WorkspaceLocalDraft: Codable {
    var photo: Data
    var drawing: Data
    var record: WorkspaceRecord?
    var boardRevision: Int? = nil
    var pendingSave: WorkspaceRecord? = nil
    var pendingEvidence: WorkspaceEvidenceSave? = nil
    var questionDraft: String? = nil
    var pendingOwnQuestion: OwnQuestionRequest? = nil
    var pendingPhotoRecognition: PendingPhotoRecognition? = nil
}
struct WorkspaceArchive: Identifiable {
    let id: String
    let title: String
}
final class WorkspaceCache {
    private let directory: URL
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ai-dtl/workspace-camera-v2", isDirectory: true)
    }
    func save(_ draft: WorkspaceLocalDraft) throws {
        _ = try PKDrawing(data: draft.drawing)
        if let record = draft.record { _ = try record.validated() }
        if let pending = draft.pendingSave { _ = try pending.validated() }
        guard draft.photo.count <= 2 * 1024 * 1024 else { throw WorkspaceError.invalidRecord }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var directoryURL = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directoryURL.setResourceValues(values)
        let data = try JSONEncoder().encode(draft)
        if let id = draft.record?.sessionId { try archive(data, id: id) }
        try data.write(to: directory.appendingPathComponent("current.json"), options: .atomic)
    }
    func load() throws -> WorkspaceLocalDraft? {
        let url = directory.appendingPathComponent("current.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let draft = try JSONDecoder().decode(WorkspaceLocalDraft.self, from: Data(contentsOf: url))
        _ = try PKDrawing(data: draft.drawing)
        if let record = draft.record { _ = try record.validated() }
        if let pending = draft.pendingSave { _ = try pending.validated() }
        return draft
    }
    func archiveConflict(local: WorkspaceLocalDraft, remote: WorkspaceRecord) throws {
        struct Copies: Codable { var local: WorkspaceLocalDraft; var remote: WorkspaceRecord }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(Copies(local: local, remote: remote)).write(
            to: directory.appendingPathComponent("conflict-\(UUID().uuidString).json"), options: .atomic)
    }
    private func archive(_ data: Data, id: String) throws {
        guard LearningSessionCache.isValidSessionId(id) else { throw WorkspaceError.invalidRecord }
        let folder = directory.appendingPathComponent("works", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: folder.appendingPathComponent("\(id).json"), options: .atomic)
    }
    func preserveCurrent() throws {
        guard let draft = try load() else { return }
        try archive(JSONEncoder().encode(draft), id: draft.record?.sessionId ?? UUID().uuidString)
    }
    func loadArchive(_ id: String) throws -> WorkspaceLocalDraft {
        guard LearningSessionCache.isValidSessionId(id) else { throw WorkspaceError.invalidRecord }
        let data = try Data(contentsOf: directory.appendingPathComponent("works/\(id).json"))
        let draft = try JSONDecoder().decode(WorkspaceLocalDraft.self, from: data)
        _ = try PKDrawing(data: draft.drawing)
        if let record = draft.record { _ = try record.validated() }
        if let pending = draft.pendingSave { _ = try pending.validated() }
        guard draft.photo.count <= 2 * 1024 * 1024 else { throw WorkspaceError.invalidRecord }
        return draft
    }
    func archives() throws -> [WorkspaceArchive] {
        let folder = directory.appendingPathComponent("works", isDirectory: true)
        guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }.map { file in
                let id = file.deletingPathExtension().lastPathComponent
                let draft = try loadArchive(id)
                return WorkspaceArchive(id: id, title: draft.record?.problem?.statement.text ?? "尚未提交的照片草稿")
            }
    }
}
