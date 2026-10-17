import Foundation

/// 从既有证据投影，不生成能力结论或猜测尚未解决的问题。
struct WorkspaceResumeSummary {
    let childExpression: String?
    let submissionId: String?

    static func make(_ record: WorkspaceRecord) -> Self? {
        guard let problem = record.problem, problem.statement.confirmed else { return nil }
        for evidence in record.submissions.reversed() where evidence.problemId == problem.problemId
            && evidence.problemRevision == problem.statement.revision {
            let text = evidence.explanation.components(separatedBy: "\n近期原话转写（可能有误，非学习结论）：")[0]
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { return .init(childExpression: String(text.prefix(1000)), submissionId: evidence.submissionId) }
        }
        return .init(childExpression: nil, submissionId: nil)
    }
}
