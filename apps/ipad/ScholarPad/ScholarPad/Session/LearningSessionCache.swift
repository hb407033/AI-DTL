import Foundation

/// 分数学习闭环的 iPad 本地草稿缓存（2026-09-17 批准设计，工作包 D）。
/// 只用于断网恢复「上次停在这里」：Mac 才是权威记录，草稿不开启云同步（目录标记排除备份）。
/// 字段名与 packages/session-contracts/fixtures/fraction-learning-v1.json 的形状保持一致，
/// 与宿主 learning-session-store.ts 记录同一 schemaVersion；synced 是 iPad 本地的未同步标记。
/// 重连先比较 revision：本地有未同步修改且远端较新时返回 conflict，双方都要保留，由界面要求明确选择，绝不静默覆盖。
/// 加载到损坏文件时保留原文件并报错；保存失败抛错，调用方不得显示「已保存」。

enum LearningCacheError: Error, Equatable {
    case invalidSessionId
    case invalidDraft
    case corruptedDraft
}

enum LearningOwner: String, Codable, Equatable {
    case child
    case agent
}

enum LearningPhase: String, Codable, Equatable {
    case exploring
    case reviewing
    case clarifying
    case transfer
    case paused
    case finished
}

struct LearningRectangle: Codable, Equatable {
    var id: String
    var wholeGroupId: String
    var rows: Int
    var columns: Int
    var shadedCells: [Int]
    var owner: LearningOwner
}

struct LearningBoard: Codable, Equatable {
    var revision: Int
    var rectangles: [LearningRectangle]
}

struct LearningSubmission: Codable, Equatable {
    var submissionId: String
    var challengeId: String
    var boardRevision: Int
    var hintUsed: Bool
}

/// AI 可见反馈与异议事实：只保存呈现给孩子的内容与是否被异议，不保存模型隐藏推理。
struct LearningFeedback: Codable, Equatable {
    var feedbackId: String
    var submissionId: String
    var summary: String
    var contested: Bool
}

struct LearningSessionDraft: Codable, Equatable {
    static let schemaVersion = 1
    static let maxCells = 60
    static let maxRectanglesPerOwner = 4
    static let maxInkBase64Length = 6_000_000

    var schemaVersion: Int
    var sessionId: String
    var packVersion: String
    var challengeId: String
    var phase: LearningPhase
    var revision: Int
    /// PencilKit 笔迹的不透明 base64：缓存不解析内容，只校验是合法 base64 且在传输上限内。
    var childInkBase64: String
    var board: LearningBoard
    var hintsVisible: Bool
    var hintUsed: Bool
    var submissions: [LearningSubmission]
    var feedback: [LearningFeedback]
    /// iPad 本地标记：false 表示有尚未上行到 Mac 的修改。
    var synced: Bool

    /// 结构校验镜像公共契约：不因「本地缓存」跳过校验，损坏即抛错而不是写回。
    func validated() throws -> LearningSessionDraft {
        guard schemaVersion == Self.schemaVersion, revision >= 0 else { throw LearningCacheError.invalidDraft }
        guard LearningSessionCache.isValidSessionId(sessionId) else { throw LearningCacheError.invalidDraft }
        guard !packVersion.isEmpty, !challengeId.isEmpty else { throw LearningCacheError.invalidDraft }
        guard childInkBase64.count <= Self.maxInkBase64Length,
              childInkBase64.isEmpty || Data(base64Encoded: childInkBase64) != nil else { throw LearningCacheError.invalidDraft }
        var ids = Set<String>()
        var childCount = 0
        var agentCount = 0
        for rect in board.rectangles {
            guard !rect.id.isEmpty, !rect.wholeGroupId.isEmpty, ids.insert(rect.id).inserted else { throw LearningCacheError.invalidDraft }
            guard rect.rows >= 1, rect.columns >= 1, rect.rows * rect.columns <= Self.maxCells else { throw LearningCacheError.invalidDraft }
            let cellCount = rect.rows * rect.columns
            var seen = Set<Int>()
            for cell in rect.shadedCells {
                guard cell >= 0, cell < cellCount, seen.insert(cell).inserted else { throw LearningCacheError.invalidDraft }
            }
            switch rect.owner {
            case .child: childCount += 1
            case .agent: agentCount += 1
            }
        }
        guard childCount <= Self.maxRectanglesPerOwner, agentCount <= Self.maxRectanglesPerOwner else { throw LearningCacheError.invalidDraft }
        return self
    }

    /// 内容相等性（忽略本地 synced 标记），用于判断同 revision 的本地草稿与远端记录是否其实一致。
    func contentEquals(_ other: LearningSessionDraft) -> Bool {
        schemaVersion == other.schemaVersion && sessionId == other.sessionId && packVersion == other.packVersion
            && challengeId == other.challengeId && phase == other.phase && revision == other.revision
            && childInkBase64 == other.childInkBase64 && board == other.board
            && hintsVisible == other.hintsVisible && hintUsed == other.hintUsed
            && submissions == other.submissions && feedback == other.feedback
    }
}

final class LearningSessionCache {
    enum ReconcileResult: Equatable {
        /// 远端较新或本地无草稿，已采用远端（写入本地且标记 synced）。
        case appliedRemote
        /// 本地较新或与远端一致，保留本地（未同步修改待上行）。
        case keptLocal
        /// 本地有未同步修改且远端也更了：双方都保留（远端存入冲突副本），要求明确选择，不静默覆盖。
        case conflict(localRevision: Int, remoteRevision: Int)
    }

    private let directory: URL
    private let fileManager: FileManager

    init(directory: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager
        if let directory {
            self.directory = directory
        } else {
            let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            self.directory = base.appendingPathComponent("ai-dtl/learning-drafts", isDirectory: true)
        }
    }

    static func isValidSessionId(_ sessionId: String) -> Bool {
        sessionId.range(of: #"^[A-Za-z0-9-]{1,80}$"#, options: .regularExpression) != nil
    }

    func draftURL(for sessionId: String) -> URL {
        directory.appendingPathComponent("\(sessionId).json")
    }

    private func conflictURL(for sessionId: String) -> URL {
        directory.appendingPathComponent("\(sessionId).conflict.json")
    }

    private func ensureDirectory() throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        // 草稿不进入 iCloud/Time Machine 备份：学习记录的权威副本在 Mac 上
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var target = directory
        try? target.setResourceValues(values)
    }

    /// 原子写入（Data.write .atomic 为同目录临时文件 + rename）。写失败抛错，调用方不得显示「已保存」。
    func saveDraft(_ draft: LearningSessionDraft) throws {
        let valid = try draft.validated()
        try ensureDirectory()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(valid).write(to: draftURL(for: valid.sessionId), options: .atomic)
    }

    /// 返回 nil 表示没有草稿；文件存在但损坏时保留原文件并抛 corruptedDraft。
    func loadDraft(sessionId: String) throws -> LearningSessionDraft? {
        guard Self.isValidSessionId(sessionId) else { throw LearningCacheError.invalidSessionId }
        let url = draftURL(for: sessionId)
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        guard let draft = try? JSONDecoder().decode(LearningSessionDraft.self, from: data),
              let valid = try? draft.validated() else {
            throw LearningCacheError.corruptedDraft
        }
        return valid
    }

    /// 冲突时保留的远端副本；返回 nil 表示没有待决冲突。
    func loadConflictDraft(sessionId: String) throws -> LearningSessionDraft? {
        guard Self.isValidSessionId(sessionId) else { throw LearningCacheError.invalidSessionId }
        let url = conflictURL(for: sessionId)
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        guard let draft = try? JSONDecoder().decode(LearningSessionDraft.self, from: data),
              let valid = try? draft.validated() else {
            throw LearningCacheError.corruptedDraft
        }
        return valid
    }

    /// 重新连接后的对账：先比较 revision，冲突保留双方并返回 conflict。
    func reconcile(sessionId: String, remote: LearningSessionDraft) throws -> ReconcileResult {
        let remoteValid = try remote.validated()
        let local = try loadDraft(sessionId: sessionId)
        guard let local else {
            var adopted = remoteValid
            adopted.synced = true
            try saveDraft(adopted)
            return .appliedRemote
        }
        if local.synced {
            // 本地没有未同步修改，远端较新才采用；否则保持本地
            guard remoteValid.revision > local.revision else { return .keptLocal }
            var adopted = remoteValid
            adopted.synced = true
            try saveDraft(adopted)
            return .appliedRemote
        }
        if remoteValid.revision > local.revision {
            try keepConflictCopy(remoteValid)
            return .conflict(localRevision: local.revision, remoteRevision: remoteValid.revision)
        }
        if remoteValid.revision == local.revision {
            if local.contentEquals(remoteValid) {
                var marked = local
                marked.synced = true
                try saveDraft(marked)
                return .appliedRemote
            }
            try keepConflictCopy(remoteValid)
            return .conflict(localRevision: local.revision, remoteRevision: remoteValid.revision)
        }
        // 本地较新：保留本地，等待上行到 Mac
        return .keptLocal
    }

    private func keepConflictCopy(_ remote: LearningSessionDraft) throws {
        try ensureDirectory()
        var copy = remote
        copy.synced = true
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(copy).write(to: conflictURL(for: remote.sessionId), options: .atomic)
    }

    /// 删除本次草稿（含待决冲突副本）。与 Mac 侧删除分开：Mac 的墓碑由宿主存储负责。
    func removeDraft(sessionId: String) throws {
        guard Self.isValidSessionId(sessionId) else { throw LearningCacheError.invalidSessionId }
        try? fileManager.removeItem(at: draftURL(for: sessionId))
        try? fileManager.removeItem(at: conflictURL(for: sessionId))
    }
}
