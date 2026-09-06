// packages/learning-kernel/src/hint-budget.ts
// 提示预算裁定（设计稿 5.4）：软预算 2 次升级、硬预算 4 级；每次只升一级；升级前必须有孩子新产出；
// 超软预算只有“有实质性尝试 + 再次明确求助”才能解除，并使本轮不再计作独立成功。预算上限由内核强制，插件与模型只能收紧。
import type { SessionContext } from "./session-state.js";

export interface InterventionBudget {
  softEscalations: number;
  hardEscalations: number;
  maxHintLevel: number;
}

export const KERNEL_BUDGET_CEILING: InterventionBudget = { softEscalations: 2, hardEscalations: 4, maxHintLevel: 4 };

export function clampBudget(requested: Partial<InterventionBudget>): InterventionBudget {
  return {
    softEscalations: Math.min(requested.softEscalations ?? KERNEL_BUDGET_CEILING.softEscalations, KERNEL_BUDGET_CEILING.softEscalations),
    hardEscalations: Math.min(requested.hardEscalations ?? KERNEL_BUDGET_CEILING.hardEscalations, KERNEL_BUDGET_CEILING.hardEscalations),
    maxHintLevel: Math.min(requested.maxHintLevel ?? KERNEL_BUDGET_CEILING.maxHintLevel, KERNEL_BUDGET_CEILING.maxHintLevel),
  };
}

export type EscalationVerdict =
  | { allowed: true; liftsSoftBudget: boolean }
  | { allowed: false; reason: "notOneLevelUp" | "aboveMaxHintLevel" | "hardBudgetExhausted" | "noNewOutputSinceLastHint" | "softBudgetNeedsAttemptAndHelp" | "demoNeedsPriorAttempt" };

type BudgetContext = Pick<SessionContext, "hintLevel" | "maxHintLevelUsed" | "escalationCount" | "newOutputSinceLastHint" | "substantiveAttempts" | "helpRequestedSinceLastHint" | "assistedRound">;

/** 阶梯的下一级：可见提示撤回后 hintLevel 归 0，但阶梯不从头来，以本挑战用过的最高级别为准 */
export function nextHintRung(ctx: Pick<SessionContext, "hintLevel" | "maxHintLevelUsed">): number {
  return Math.max(ctx.hintLevel, ctx.maxHintLevelUsed) + 1;
}

export function evaluateEscalation(ctx: BudgetContext, requestedLevel: number, budget: InterventionBudget): EscalationVerdict {
  if (requestedLevel !== nextHintRung(ctx)) return { allowed: false, reason: "notOneLevelUp" };
  if (ctx.escalationCount >= budget.hardEscalations) return { allowed: false, reason: "hardBudgetExhausted" };
  if (requestedLevel > budget.maxHintLevel) return { allowed: false, reason: "aboveMaxHintLevel" };
  if (requestedLevel === 4 && ctx.substantiveAttempts < 1) return { allowed: false, reason: "demoNeedsPriorAttempt" };
  // 辅助轮的提示明确“不计入验证”，不再受软预算与新产出门禁约束，但仍不能越硬预算
  if (ctx.assistedRound) return { allowed: true, liftsSoftBudget: false };
  if (!ctx.newOutputSinceLastHint) return { allowed: false, reason: "noNewOutputSinceLastHint" };
  if (ctx.escalationCount >= budget.softEscalations) {
    if (ctx.substantiveAttempts >= 1 && ctx.helpRequestedSinceLastHint) return { allowed: true, liftsSoftBudget: true };
    return { allowed: false, reason: "softBudgetNeedsAttemptAndHelp" };
  }
  return { allowed: true, liftsSoftBudget: false };
}
