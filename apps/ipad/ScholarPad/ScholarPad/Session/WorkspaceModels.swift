import Foundation

struct WorkspaceCurriculum: Codable, Equatable {
    var edition = "人教版"
    var grade = 5
    var term = "上"
    var currentUnit: String
}
struct WorkspaceProblem: Codable, Equatable {
    struct Statement: Codable, Equatable {
        var text: String
        var revision: Int
        var confirmed: Bool
    }
    var problemId: String
    var source: String
    var photoId: String?
    var challengeId: String?
    var packVersion: String?
    var curriculum: WorkspaceCurriculum
    var statement: Statement
}
struct WorkspaceEvidence: Codable, Equatable {
    var submissionId: String
    var problemId: String
    var problemRevision: Int
    var boardRevision: Int
    var previewId: String
    var explanation: String
    var processSignal: WorkspaceProcessSignal? = nil
}
struct WorkspaceEvidenceSave: Codable {
    let eventId: String
    var expectedRevision: Int
    let evidence: WorkspaceEvidence
}
struct WorkspaceFeedback: Codable, Equatable {
    var responseId: String
    var turnId: String
    var summary: String
    var contested: Bool
}
struct WorkspaceRecord: Codable, Equatable {
    var schemaVersion: Int
    var sessionId: String
    var eventId: String
    var revision: Int
    var problem: WorkspaceProblem?
    var phase: String
    var childInkBase64: String
    var board: LearningBoard
    var submissions: [WorkspaceEvidence]
    var feedback: [WorkspaceFeedback]
    var openQuestions: [String]

    func validated() throws -> Self {
        guard schemaVersion == 2, revision >= 0,
              LearningSessionCache.isValidSessionId(sessionId),
              LearningSessionCache.isValidSessionId(eventId),
              ["confirming", "exploring", "paused", "finished"].contains(phase),
              childInkBase64.count <= 6_000_000,
              childInkBase64.isEmpty || Data(base64Encoded: childInkBase64) != nil else { throw WorkspaceError.invalidRecord }
        if let p = problem {
            guard LearningSessionCache.isValidSessionId(p.problemId), !p.statement.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  p.statement.text.count <= 8000, p.statement.revision >= 0,
                  p.curriculum.edition == "人教版", p.curriculum.grade == 5, p.curriculum.term == "上",
                  !p.curriculum.currentUnit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  p.curriculum.currentUnit.count <= 80 else { throw WorkspaceError.invalidRecord }
            switch p.source {
            case "camera": guard let id = p.photoId, LearningSessionCache.isValidSessionId(id), p.challengeId == nil, p.packVersion == nil else { throw WorkspaceError.invalidRecord }
            case "curated": guard let id = p.challengeId, LearningSessionCache.isValidSessionId(id), p.packVersion?.isEmpty == false, p.photoId == nil else { throw WorkspaceError.invalidRecord }
            default: throw WorkspaceError.invalidRecord
            }
        }
        guard phase != "exploring" || problem?.statement.confirmed == true else { throw WorkspaceError.invalidRecord }
        guard submissions.allSatisfy({ $0.processSignal?.isValid != false }) else { throw WorkspaceError.invalidRecord }
        return self
    }
}
enum WorkspaceError: Error { case invalidRecord, invalidHost, unavailable, server(Int, String?), noProblem
    /// 向后兼容：.server(409) 等价于 .server(409, nil)
    static func server(_ code: Int) -> WorkspaceError { .server(code, nil) }
}
/// 照片识别的持久化中间状态：回执丢失后重试复用同一 session/photoId/previewId/eventId。
/// host 绑定创建时的主机；换主机后不能把旧 session/photoId 发给新主机。
struct PendingPhotoRecognition: Codable, Equatable {
    var host: String?
    var sessionId: String
    var photoEventId: String
    var photoId: String?
    var previewEventId: String
    var previewId: String?
    var recognizeEventId: String
    var expectedRevision: Int
    var unit: String
    var candidates: [String]? = nil
    var selectedText: String? = nil
}

struct PhotoRecognitionResponse: Decodable {
    let record: WorkspaceRecord?
    let status: String?
    let candidates: [String]
    init(from decoder: Decoder) throws {
        enum Keys: String, CodingKey { case schemaVersion, status, candidates }
        let container = try decoder.container(keyedBy: Keys.self)
        if container.contains(.schemaVersion) {
            record = try WorkspaceRecord(from: decoder); status = nil; candidates = []
        } else {
            record = nil; status = try container.decode(String.self, forKey: .status)
            candidates = try container.decode([String].self, forKey: .candidates)
            guard (status == "multiple" && (2...12).contains(candidates.count) && candidates.allSatisfy({ !$0.isEmpty && $0.count <= 8000 && !Self.isNotice($0) }))
                || (status == "unreadable" && candidates.isEmpty) else { throw WorkspaceError.invalidRecord }
        }
    }
    static func isNotice(_ text: String) -> Bool {
        text.range(of: "(?:请|建议|需要|无法|不能|看不清|识别不到|识别到).{0,100}(?:重新拍|重拍|只拍一道|只包含这道|包含多道|无法识别|看不清)|^(?:请重新拍照|无法识别|看不清|图片模糊|照片模糊)", options: .regularExpression) != nil
    }
}
