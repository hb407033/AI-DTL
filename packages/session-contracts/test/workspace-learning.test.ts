import { expect, test } from "vitest";
import { evidenceSchema, problemSchema, workspaceRecordSchema, workspaceCommandSchema } from "../src/workspace-learning.js";

const problem = { problemId: "p-1", source: "camera", photoId: "photo-1",
  curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
  statement: { text: "2.4 米的 0.3 是多少？", revision: 0, confirmed: false } };
test("照片题不伪造分数题 ID", () => expect(problemSchema.parse(problem)).toEqual(problem));
test.each([
  { ...problem, photoId: undefined }, { ...problem, photoId: "../file" },
  { ...problem, statement: { text: " ", revision: 0, confirmed: true } },
  { ...problem, statement: { text: "题目", revision: 0.5, confirmed: true } },
  { ...problem, ability: "已掌握" },
  { ...problem, source: "curated", photoId: undefined, challengeId: "q-1" },
])("无效题目拒绝 %j", raw => expect(problemSchema.safeParse(raw).success).toBe(false));
const envelope = { schemaVersion: 2, eventId: "e-1", sessionId: "s-1", expectedRevision: 0 };
test("不能通过 setProblem 跳过照片题确认", () => {
  expect(workspaceCommandSchema.safeParse({ ...envelope, type: "setProblem", problem }).success).toBe(true);
  expect(workspaceCommandSchema.safeParse({ ...envelope, type: "setProblem", problem: { ...problem,
    statement: { ...problem.statement, confirmed: true } } }).success).toBe(false);
});
test("求助需要证据而题意澄清不需要", () => {
  expect(workspaceCommandSchema.safeParse({ ...envelope, type: "authorize", turnId: "t-1", action: "help" }).success).toBe(false);
  expect(workspaceCommandSchema.safeParse({ ...envelope, type: "authorize", turnId: "t-1", action: "clarify" }).success).toBe(true);
});
test("没有问题不能进入探索，照片与笔迹不能共用字段", () => {
  const record = { schemaVersion: 2, sessionId: "s-1", eventId: "e-1", revision: 0,
    problem: null, phase: "confirming", childInkBase64: "", board: { revision: 0, rectangles: [] },
    submissions: [], feedback: [], openQuestions: [] };
  expect(workspaceRecordSchema.safeParse(record).success).toBe(true);
  expect(workspaceRecordSchema.safeParse({ ...record, phase: "exploring" }).success).toBe(false);
  expect(workspaceRecordSchema.safeParse({ ...record, audio: "secret" }).success).toBe(false);
});

test("hello 默认独立模式，未知对话模式被拒绝", () => {
  expect(workspaceCommandSchema.parse({ schemaVersion: 2, type: "hello", sessionId: "s" })).not.toHaveProperty("conversationMode");
  expect(workspaceCommandSchema.parse({ schemaVersion: 2, type: "hello", sessionId: "s", conversationMode: "dialogue" })).toMatchObject({ conversationMode: "dialogue" });
  expect(workspaceCommandSchema.safeParse({ schemaVersion: 2, type: "hello", sessionId: "s", conversationMode: "auto-answer" }).success).toBe(false);
});

const evidence = { submissionId: "sub-1", problemId: "p-1", problemRevision: 0,
  boardRevision: 1, previewId: "preview-1", explanation: "我重写了一笔" };
const processSignal = { eraseCount: 1, longestPauseMs: 2400, strokeOrder: ["stroke:st-a", "erase:st-a", "stroke:st-b"] };
test("旧证据无过程信号可读，事实摘要通过提交契约完整保留", () => {
  expect(evidenceSchema.parse(evidence)).toEqual(evidence);
  const command = workspaceCommandSchema.parse({ ...envelope, type: "authorize", action: "review", turnId: "t-1",
    evidence: { ...evidence, processSignal } });
  expect(command.type).toBe("authorize");
  if (command.type === "authorize") expect(command.evidence?.processSignal).toEqual(processSignal);
  expect(evidenceSchema.parse({ ...evidence, processSignal: { eraseCount: 10000, longestPauseMs: 3600000,
    strokeOrder: Array(256).fill("stroke:st-a") } }).processSignal?.strokeOrder).toHaveLength(256);
});
test.each([
  { ...processSignal, eraseCount: -1 }, { ...processSignal, eraseCount: 0.5 }, { ...processSignal, eraseCount: 10001 },
  { ...processSignal, longestPauseMs: -1 }, { ...processSignal, longestPauseMs: 1.5 }, { ...processSignal, longestPauseMs: 3600001 },
  { ...processSignal, strokeOrder: Array(257).fill("stroke:st-a") },
  { ...processSignal, strokeOrder: [""] }, { ...processSignal, strokeOrder: ["x".repeat(81)] },
  { ...processSignal, emotion: "frustrated" }, { ...processSignal, ocr: "123" },
  { ...processSignal, strokeOrder: ["孩子很着急"] }, { ...processSignal, longestPauseMs: Infinity },
])("过程信号拒绝无界或解释性内容 %j", invalid => {
  expect(evidenceSchema.safeParse({ ...evidence, processSignal: invalid }).success).toBe(false);
});
