// packages/learning-kernel/test/hint-budget.test.ts
import { describe, expect, test } from "vitest";
import { KERNEL_BUDGET_CEILING, clampBudget, evaluateEscalation, nextHintRung } from "../src/hint-budget.js";
import { createSessionContext } from "../src/session-state.js";

const base = () => ({ ...createSessionContext(), state: "ASSESSING" as const });

describe("预算钳制：插件与模型只能收紧，不能放松", () => {
  test("请求超过内核上限时按上限截断", () => {
    expect(clampBudget({ softEscalations: 5, hardEscalations: 9, maxHintLevel: 5 })).toEqual(KERNEL_BUDGET_CEILING);
  });
  test("更严的请求原样保留", () => {
    expect(clampBudget({ softEscalations: 1, maxHintLevel: 2 })).toEqual({ softEscalations: 1, hardEscalations: 4, maxHintLevel: 2 });
  });
});

describe("升级裁定（设计稿 5.4）", () => {
  test("从 0 级升到 1 级，且有新产出：允许", () => {
    expect(evaluateEscalation(base(), 1, KERNEL_BUDGET_CEILING)).toEqual({ allowed: true, liftsSoftBudget: false });
  });
  test("一次跳两级：拒绝", () => {
    expect(evaluateEscalation(base(), 2, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "notOneLevelUp" });
  });
  test("上次提示后没有新产出：拒绝，禁止连续自动升级", () => {
    const ctx = { ...base(), hintLevel: 1, escalationCount: 1, newOutputSinceLastHint: false };
    expect(evaluateEscalation(ctx, 2, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "noNewOutputSinceLastHint" });
  });
  test("软预算用完、有实质性尝试且再次求助：允许但标记解除软预算", () => {
    const ctx = { ...base(), hintLevel: 2, escalationCount: 2, substantiveAttempts: 2, helpRequestedSinceLastHint: true };
    expect(evaluateEscalation(ctx, 3, KERNEL_BUDGET_CEILING)).toEqual({ allowed: true, liftsSoftBudget: true });
  });
  test("软预算用完但没有再次求助：拒绝", () => {
    const ctx = { ...base(), hintLevel: 2, escalationCount: 2, substantiveAttempts: 2, helpRequestedSinceLastHint: false };
    expect(evaluateEscalation(ctx, 3, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "softBudgetNeedsAttemptAndHelp" });
  });
  test("4 级演示前必须有过实质性尝试", () => {
    const ctx = { ...base(), hintLevel: 3, escalationCount: 3, substantiveAttempts: 0, helpRequestedSinceLastHint: true };
    expect(evaluateEscalation(ctx, 4, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "demoNeedsPriorAttempt" });
  });
  test("硬预算耗尽：拒绝", () => {
    const ctx = { ...base(), hintLevel: 4, escalationCount: 4, substantiveAttempts: 3, helpRequestedSinceLastHint: true };
    expect(evaluateEscalation(ctx, 5, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "hardBudgetExhausted" });
  });
  test("插件把最高级别收紧到 2 时，请求 3 级被拒", () => {
    const ctx = { ...base(), hintLevel: 2, escalationCount: 1, substantiveAttempts: 1, helpRequestedSinceLastHint: true };
    expect(evaluateEscalation(ctx, 3, clampBudget({ maxHintLevel: 2 }))).toEqual({ allowed: false, reason: "aboveMaxHintLevel" });
  });
  test("可见提示撤回后阶梯不从头来：hintLevel 0 但用过 1 级时，下一级是 2", () => {
    const ctx = { ...base(), hintLevel: 0, maxHintLevelUsed: 1, escalationCount: 1 };
    expect(nextHintRung(ctx)).toBe(2);
    expect(evaluateEscalation(ctx, 1, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "notOneLevelUp" });
    expect(evaluateEscalation(ctx, 2, KERNEL_BUDGET_CEILING)).toEqual({ allowed: true, liftsSoftBudget: false });
  });
  test("辅助轮跳过软预算与新产出门禁，但仍只能升一级且不越硬预算", () => {
    const ctx = { ...base(), hintLevel: 2, escalationCount: 2, newOutputSinceLastHint: false, assistedRound: true };
    expect(evaluateEscalation(ctx, 3, KERNEL_BUDGET_CEILING)).toEqual({ allowed: true, liftsSoftBudget: false });
    expect(evaluateEscalation(ctx, 4, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "notOneLevelUp" });
  });
});
