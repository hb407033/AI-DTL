// packages/learning-kernel/test/proposal-validator.test.ts
import { describe, expect, test } from "vitest";
import type { TeachingProposal } from "@ai-scholar/session-contracts";
import { KERNEL_BUDGET_CEILING } from "../src/hint-budget.js";
import { validateProposal } from "../src/proposal-validator.js";
import { createSessionContext, type SessionContext } from "../src/session-state.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

const ctx = (): SessionContext => ({ ...createSessionContext(), state: "INTERVENING", substantiveAttempts: 1 });
const proposal = (patch: Partial<TeachingProposal> = {}): TeachingProposal => ({
  proposalId: "p-1", spokenResponse: "你现在已经确定了什么？", canvasActions: [], learnerTask: "说说看", expectedEvidence: [], hintLevel: 1, ...patch,
});
const input = (p: TeachingProposal, c = ctx()) => ({ proposal: p, context: c, budget: KERNEL_BUDGET_CEILING, plugin: fakePlugin, protectedObjectIds: ["child-stroke-1"] });

describe("教学提案本地校验（设计稿 10.3、13）", () => {
  test("合规的一级提示通过", () => {
    expect(validateProposal(input(proposal()))).toEqual({ accepted: true, liftsSoftBudget: false });
  });
  test("越级提示被拒", () => {
    expect(validateProposal(input(proposal({ hintLevel: 3 })))).toEqual({ accepted: false, reasons: ["hint:notOneLevelUp"] });
  });
  test("上次提示后没有新产出时的升级被拒", () => {
    const r = validateProposal(input(proposal({ hintLevel: 2 }), { ...ctx(), hintLevel: 1, escalationCount: 1, newOutputSinceLastHint: false }));
    expect(r).toEqual({ accepted: false, reasons: ["hint:noNewOutputSinceLastHint"] });
  });
  test("超长语音与多个问题被拒", () => {
    const r = validateProposal(input(proposal({ spokenResponse: "先想一想？再说一说？" + "很长".repeat(80) })));
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.reasons).toEqual(["spoken:tooLong", "spoken:multipleQuestions"]);
  });
  test("未声明的语义对象种类与覆盖孩子层被拒", () => {
    const r = validateProposal(input(proposal({ canvasActions: [
      { kind: "upsertObject", object: { id: "x", owner: "agent", kind: "unknownKind", props: {} } },
      { kind: "removeObject", objectId: "child-stroke-1" },
    ] })));
    expect(r).toEqual({ accepted: false, reasons: ["canvas:unknownKind:unknownKind", "canvas:overwritesChildLayer:child-stroke-1"] });
  });
  test("辅助轮或非迁移阶段的记忆候选被拒", () => {
    const withMemory = proposal({ memoryCandidate: { description: "会了", evidenceEventIds: ["e-1"] } });
    expect(validateProposal(input(withMemory))).toEqual({ accepted: false, reasons: ["memory:notAfterTransfer"] });
    const assisted = { ...ctx(), state: "TRANSFER" as const, assistedRound: true };
    expect(validateProposal(input(proposal({ hintLevel: 0, memoryCandidate: { description: "会了", evidenceEventIds: ["e-1"] } }), assisted))).toEqual({ accepted: false, reasons: ["memory:assistedRound"] });
  });
  test("被异议冻结的提案 id 不能再次提出", () => {
    const r = validateProposal(input(proposal(), { ...ctx(), frozenTargets: [{ kind: "proposal", id: "p-1" }] }));
    expect(r).toEqual({ accepted: false, reasons: ["proposal:frozen"] });
  });
  test("0 级提案（非提示发言）不做升级裁定", () => {
    expect(validateProposal(input(proposal({ hintLevel: 0 }), { ...ctx(), state: "EXPLAIN_BACK" }))).toEqual({ accepted: true, liftsSoftBudget: false });
  });
});
