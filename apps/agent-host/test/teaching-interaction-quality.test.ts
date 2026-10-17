import { expect, test, vi } from "vitest";
import { buildDecisionPrompt, QwenTeachingDecisionProvider, validateTeachingDecision, type TeachingDecision, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import type { QwenConfig } from "../src/ai/config.js";

const base: TeachingInput = { record: { schemaVersion: 2, sessionId: "quality-work", eventId: "initial", revision: 0,
  problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "植树问题" },
    statement: { text: "60米的小路一侧，每隔5米栽一棵，两端都栽，一共多少棵？", revision: 0, confirmed: true } },
  phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] },
  turnId: "t", responseId: "r", permission: "hint", child: "我不会区分间隔和树，给一个小例子吧。", history: [] };
const prior: TeachingDecision = { problemId: "p", problemRevision: 0, turnId: "prior", responseId: "prior-r",
  child: "六十除以五是十二，我先答十二棵。", focus: "verify", observation: "孩子把间隔当棵数", evidenceIds: ["prior"],
  resolved: [], utterance: "先拿10米、每隔5米两端都栽的小路试试，看有几段、几棵树？", method: "ordinary", handoff: false };
const input = { ...base, history: [prior] };
const draft = { focus: "clarify", observation: "孩子求助区分间隔和树", evidenceIds: ["t"],
  utterance: "拿10米路每隔5米两端都栽试试，数数有几段、几棵树？", method: "ordinary", handoff: false };
const good = { ...draft, utterance: "先只画一段短路，在起点点一个点表示树。" };
const allowed = '{"allowed":true,"reason":"none"}';

test.each([
  ["repeated_question", "换词重问"],
  ["help_not_reduced", "降低任务"],
  ["relation_check_skipped", "题意关系"],
  ["review_overreach", "计算流程"],
])("真实互动失败 %s 走有原因的一次改写再复核，不退化为invalidReview", async (reason, requirement) => {
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(draft))
    .mockResolvedValueOnce(JSON.stringify({ allowed: false, reason }))
    .mockResolvedValueOnce(JSON.stringify(good)).mockResolvedValueOnce(allowed);
  const provider = new QwenTeachingDecisionProvider({ decisionMode: "realtime" } as QwenConfig, undefined, request);
  await expect(provider.decide(input)).resolves.toMatchObject({ utterance: good.utterance });
  expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls[2]![1]).toContain(`semantic_${reason}`);
  expect(request.mock.calls[2]![1]).toContain(requirement);
  expect(request.mock.calls[2]![1]).toMatch(/^你是教学互动修复器/u);
  const context = JSON.parse(request.mock.calls[2]![1].split("\n").at(-1)!);
  expect(context.history.at(-1).teacher).toBe(prior.utterance);
  expect(context.child).toBe(input.child);
});

test("现有同一次复核同时看已回答、未接住和原题关系，不新添一个模型层", async () => {
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(good)).mockResolvedValueOnce(allowed);
  await new QwenTeachingDecisionProvider({ decisionMode: "realtime" } as QwenConfig, undefined, request).decide(input);
  const review = request.mock.calls[1]![1];
  for (const requirement of ["repeated_question", "help_not_reduced", "relation_check_skipped", "review_overreach",
    "已经回答", "没有接住", "只列式", "明确要求重听"]) expect(review).toContain(requirement);
  expect(request).toHaveBeenCalledTimes(2);
});

test("第一次求助只要上一问未接住就需降阶，不等累计第二次求助", () => {
  const prompt = buildDecisionPrompt(input);
  expect(prompt).toContain("当前最近会话第1次");
  expect(prompt).toContain("上一问未接住");
  expect(prompt).toContain("只换词");
});

test("孩子的新表达先被接住，不因没有算结果就重复老师上一问", () => {
  expect(buildDecisionPrompt({ ...input, permission: "review", child: "我把一段路两端都标了树。" }))
    .toContain("先承接已说的新信息");
});

// 2026-10-16 起：质量类意见在最后一次修复后放行（留日志），不让孩子的话落空；抢答等硬错误仍拦截。
test("反复质量拒绝仍保持4子调用上限，最后一次放行并留日志", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(draft))
    .mockResolvedValueOnce('{"allowed":false,"reason":"help_not_reduced"}')
    .mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce('{"allowed":false,"reason":"help_not_reduced"}');
  await expect(new QwenTeachingDecisionProvider({ decisionMode: "realtime" } as QwenConfig, undefined, request).decide(input))
    .resolves.toMatchObject({ utterance: draft.utterance });
  expect(warn).toHaveBeenCalledWith("teachingReviewOverride", expect.objectContaining({ reason: "help_not_reduced" }));
  warn.mockRestore();
  expect(request).toHaveBeenCalledTimes(4);
});

test("孩子只是没听清并明确要求原话重听时，重复原问不是教学循环", () => {
  const repeat = { ...input, permission: "clarification" as const, child: "我没听清，刚才那句再说一遍。" };
  expect(validateTeachingDecision({ ...draft, utterance: prior.utterance }, repeat).utterance).toBe(prior.utterance);
  expect(() => validateTeachingDecision({ ...draft, utterance: prior.utterance }, { ...repeat, child: "我没听懂，不会区分树和间隔。" }))
    .toThrow("repeatedQuestion");
});
