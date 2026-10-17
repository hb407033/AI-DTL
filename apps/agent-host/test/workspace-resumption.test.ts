import { expect, test } from "vitest";
import { previousChildWork, resumptionGuidance } from "../src/ai/workspace-resumption.js";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";

test("跨次只取同题同版本的历史孩子原话，不复制模型判断或内部转写尾注", () => {
  const record = { problem: { problemId: "p", statement: { confirmed: true, revision: 2 } }, submissions: [
    { submissionId: "old", problemId: "p", problemRevision: 1, explanation: "旧题意" },
    { submissionId: "other", problemId: "q", problemRevision: 2, explanation: "别的题" },
    { submissionId: "one", problemId: "p", problemRevision: 2, explanation: "我把一升分两份\n近期原话转写（可能有误，非学习结论）：\n帮我一下" },
  ], feedback: [{ summary: "已经掌握", contested: true }] } as unknown as WorkspaceRecord;
  expect(previousChildWork(record)).toEqual([{ submissionId: "one", explanation: "我把一升分两份", source: "previous-submission" }]);
  record.problem!.statement.confirmed = false;
  expect(previousChildWork(record)).toEqual([]);
  expect(resumptionGuidance).toContain("不代表本轮新表达");
});

test("历史上下文只保留两份、单份最多1000字符，空白不占位", () => {
  const record = { problem: { problemId: "p", statement: { confirmed: true, revision: 0 } }, submissions:
    Array.from({ length: 5 }, (_, n) => ({ submissionId: String(n), problemId: "p", problemRevision: 0, explanation: "字".repeat(1200) })) } as unknown as WorkspaceRecord;
  expect(previousChildWork(record).map(x => x.submissionId)).toEqual(["3", "4"]);
  expect(previousChildWork(record)[0]?.explanation.length).toBe(1000);
  record.submissions.push({ submissionId: "blank", problemId: "p", problemRevision: 0,
    boardRevision: 0, previewId: "v", explanation: " \n " });
  expect(previousChildWork(record, "4").map(x => x.submissionId)).toEqual(["2", "3"]);
});
