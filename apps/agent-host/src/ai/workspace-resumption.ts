import type { WorkspaceRecord } from "@ai-scholar/session-contracts";

/** 历史原话只作可核对材料；不复制老师的判断，也不继承教学授权。 */
export function previousChildWork(record: WorkspaceRecord, excludeSubmissionId?: string) {
  const problem = record.problem;
  if (!problem?.statement.confirmed) return [];
  return record.submissions
    .filter(s => s.problemId === problem.problemId && s.problemRevision === problem.statement.revision && s.submissionId !== excludeSubmissionId)
    .map(s => ({ submissionId: s.submissionId,
      explanation: s.explanation.split("\n近期原话转写（可能有误，非学习结论）：")[0]!.trim().slice(0, 1000),
      source: "previous-submission" as const }))
    .filter(s => s.explanation.length > 0).slice(-2);
}

export const resumptionGuidance = "previousWork 是同题同版本的历史孩子表达，不代表本轮新表达，不证明掌握或独立迁移，也不构成讲解授权。需要引用时说‘上次你说’，允许孩子修正；本轮表达优先，不强迫沿用旧方法。不推断距离上次过了多久。";
