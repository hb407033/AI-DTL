import { expect, test, vi } from "vitest";
import { mathPlugin } from "@ai-scholar/plugin-math";
import { thinkingMove } from "../src/learning/teaching-decision.js";
import { buildDecisionPrompt, QwenTeachingDecisionProvider, validateTeachingDecision, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import type { QwenConfig } from "../src/ai/config.js";

const base = { record: { sessionId: "test-s", problem: { problemId: "test-p", statement: {
  text: "在一条长60米的小路一侧，每隔5米栽一棵树，两端都栽。一共要栽多少棵树？", revision: 0 },
  curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "植树问题" } }, submissions: [], feedback: [] },
  turnId: "new-turn", responseId: "new-response", permission: "review", child: "我想先用短路试试。", history: [] } as unknown as TeachingInput;
const raw = { focus: "clarify", observation: "孩子使用短路例子", evidenceIds: [base.turnId],
  utterance: "可以先试试短路。", method: "ordinary", handoff: false };
const teacher = { ...validateTeachingDecision(raw, base), turnId: "old-turn", responseId: "old-r",
  child: "我画了5米和10米。", utterance: "5到10米是两个间隔。" };

test("纠正老师的澄清权限可承认错误，自我纠正不会触发acknowledge", () => {
  const correcting = { ...base, permission: "clarification" as const, history: [teacher],
    child: "你说得不对，5到10米只有一个间隔。" };
  expect(validateTeachingDecision({ ...raw, focus: "acknowledge", utterance: "你指出得对，是我说错了，5到10米只有一个间隔。" }, correcting).focus).toBe("acknowledge");
  expect(() => validateTeachingDecision(raw, correcting)).toThrow("nextFocus_acknowledge");
  const self = { ...base, history: [teacher], child: "我算得不对吧，我自己改成13棵。" };
  expect(() => validateTeachingDecision(raw, self)).not.toThrow();
});

test("acknowledge必须回应自己的错误，不能只表扬或布置新的计算", () => {
  const input = { ...base, history: [teacher], child: "你说错了，5到10米只有一个间隔。" };
  for (const utterance of ["你很棒。", "是我说错了。你再算60除以5是多少？"])
    expect(() => validateTeachingDecision({ ...raw, focus: "acknowledge", utterance }, input)).toThrow("acknowledgementRequired");
});

test("动作枚举来自数学插件；本轮图像证据必须真的附图，不能空表达造childMove", () => {
  expect(thinkingMove.options).toEqual([...mathPlugin.manifest.thinkingMoves, "none"]);
  expect(() => validateTeachingDecision({ ...raw, childMove: { move: "represent", evidenceId: "img" } },
    { ...base, imageId: "img" })).toThrow("childMoveEvidenceInvalid");
  expect(() => validateTeachingDecision({ ...raw, childMove: { move: "represent", evidenceId: base.turnId } },
    { ...base, child: "", history: [teacher] })).toThrow("childMoveEvidenceInvalid");
});

test.each(["我不会画。", "我不想画，也还没做。", "我还没画线。", "我还没做。"])("拒绝或尚未进行的表达不能被误报为已做动作：%s", child => {
  expect(() => validateTeachingDecision({ ...raw, childMove: { move: "represent", evidenceId: base.turnId } },
    { ...base, child })).toThrow("childMoveEvidenceInvalid");
});

test.each(["我不会画，但我画了一条线表示路。", "我还没画好，不过我已经画出了三段。", "我先画了两段，但还不会画第三段。"])("混合表达保留已经实际进行的动作：%s", child => {
  expect(() => validateTeachingDecision({ ...raw, childMove: { move: "represent", evidenceId: base.turnId } },
    { ...base, child })).not.toThrow();
});

test("本轮输入事实进入提示；analysis仅要求摘要而非隐藏推理过程", () => {
  const prompt = buildDecisionPrompt({ ...base, processSignal: { eraseCount: 2, longestPauseMs: 8000, strokeOrder: ["stroke", "erase", "stroke"] } });
  expect(prompt).toContain('"eraseCount":2');
  expect(prompt).toContain("决策摘要"); expect(prompt).toContain("不输出思维链");
});

test("跨题唤起只能引用当前有效账本；孩子当前求助优先于撤手", () => {
  const input: TeachingInput = { ...base, ledgerSummary: [{ move: "represent", withdrawalLevel: 2,
    evidenceId: "prior-proof", turnId: "prior-turn", sessionId: "prior-work" }] };
  const recall = { ...raw, move: "represent", evidenceIds: [base.turnId, "prior-proof"],
    utterance: "上次你试过用图表示，这次你想先怎么试？" };
  expect(() => validateTeachingDecision(recall, input)).not.toThrow();
  expect(() => validateTeachingDecision(recall, base)).toThrow("invalidEvidence");
  expect(() => validateTeachingDecision({ ...recall, evidenceIds: [base.turnId] }, input)).toThrow("memoryEvidenceRequired");
  const concrete = { ...raw, move: "represent", utterance: "先画一条线，再标出两端。" };
  expect(() => validateTeachingDecision(concrete, input)).toThrow("withdrawalRequired");
  expect(() => validateTeachingDecision(concrete, { ...input, permission: "hint", child: "我不会，帮我一下。" })).not.toThrow();
  expect(buildDecisionPrompt(input)).toContain("有效账本");
  expect(buildDecisionPrompt(input)).toContain("childMove");
});

test("小数除法也走数学/画面复核，已提供正确结果不误拦", async () => {
  const input = { ...base, record: { ...base.record, problem: { ...base.record.problem!, statement: { text: "12.5÷0.5", revision: 0, confirmed: true } } },
    child: "我猜25，想检验。" };
  const draft = { ...raw, focus: "verify", method: "scale_both", utterance: "你准备怎么检验这个结果？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce('{"allowed":true,"reason":"none"}');
  const accepted = await new QwenTeachingDecisionProvider({ decisionMode: "realtime" } as QwenConfig, undefined, request).decide(input);
  expect(accepted.focus).toBe("verify"); expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]![1]).toContain("数学错误");
});

test("数学复核持续拒绝只允许一次修复，未能求解的小例子不伪造真值", async () => {
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(raw)).mockResolvedValueOnce('{"allowed":false,"reason":"math_error"}')
    .mockResolvedValueOnce(JSON.stringify(raw)).mockResolvedValueOnce('{"allowed":false,"reason":"math_error"}');
  await expect(new QwenTeachingDecisionProvider({} as QwenConfig, undefined, request).decide(base)).rejects.toThrow("decisionNeedsReview");
  expect(request.mock.calls[2]![1]).toContain("semantic_math_error"); expect(request).toHaveBeenCalledTimes(4);
  const unknown = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...raw, probe: { family: "not-known", params: {} } }))
    .mockResolvedValueOnce('{"allowed":true,"reason":"none"}');
  await expect(new QwenTeachingDecisionProvider({} as QwenConfig, undefined, unknown).decide(base)).resolves.toMatchObject({ utterance: raw.utterance });
  expect(unknown.mock.calls[1]![1]).toContain('"probeStatus":"unverified"');
});
