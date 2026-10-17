import { expect, test } from "vitest";
import { buildProductionCases, reserveProductionCall, productionGate } from "../scripts/production-teaching-probe-core.js";

test("生产路径预算按模型子请求计数，失败与修复也计数，超时或用量上限禁止再调用", () => {
  const budget = { calls: 0, maxCalls: 2, deadline: 1000, knownCostCny: 0, costLimitCny: 3 };
  reserveProductionCall(budget, 900); reserveProductionCall(budget, 901);
  expect(budget.calls).toBe(2); expect(() => reserveProductionCall(budget, 902)).toThrow("callBudget");
  expect(() => reserveProductionCall({ ...budget, calls: 0 }, 1000)).toThrow("deadline");
  expect(() => reserveProductionCall({ ...budget, calls: 0, knownCostCny: 3 }, 900)).toThrow("costBudget");
});

test("未评分或只有单轮结果不能切默认，硬失败与拒绝交付不被空数组当零失败", () => {
  const result = { caseId: "x", mode: "thinking", error: null, decision: { move: "look_back" } };
  expect(productionGate([result], [])).toMatchObject({ passed: false });
  expect(productionGate([{ ...result, error: "decisionNeedsReview" }], [{ caseId: "x", mode: "thinking", t1: 2, t2: 2, hard: [] }])).toMatchObject({ passed: false });
});

test("新固定样本保持原8例，三条失败取实际续聊上下文，五题族预写脚本与题干一致", () => {
  const source = Array.from({ length: 8 }, (_, i) => ({ id: ["multiply-no-answer", "area-why", "area-resume", "trees-missing-zero", "trees-challenge", "division-one-side", "division-new-units", "equation-resume"][i],
    input: { record: { problem: { statement: { text: "题目", revision: 0 } }, submissions: [], feedback: [] },
      child: "原表达", history: [], turnId: "t", responseId: "r", permission: "review" }, imageBase64: "", provenance: { index: i } }));
  const cases = buildProductionCases(source as any, []);
  expect(cases.initial).toHaveLength(19); expect(cases.multiturn).toHaveLength(5);
  expect(new Set(cases.initial.map(c => c.id)).size).toBe(19);
  expect(cases.multiturn.every(c => c.turns.length >= 6 && c.turns.length <= 8)).toBe(true);
  const division = cases.multiturn.find(c => c.id === "divide")!;
  expect(division.problem).toContain("5.4"); expect(JSON.stringify(division.turns)).not.toContain("12.5");
  expect(cases.initial.find(c => c.id === "regression-area-leak")?.input.child).toContain("高变小");
});
