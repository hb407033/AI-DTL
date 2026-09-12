// packages/learning-kernel/src/session-state.ts
// 学习会话状态机：逐行实现设计稿 v0.4 第 5.0 节转换表。
// 元规则：教学转换未列出即拒绝并记策略错误；儿童控制权事件（求助/暂停/异议）在任何活动状态都必须被接受。
// 本文件只做状态与上下文的纯函数转换，不碰时钟、桥接和存储，便于把整张表当数据逐行测试。

import type { ContestTarget } from "./growth/types.js";
export const SESSION_STATES = [
  "PREPARING", "INDEPENDENT", "ASSESSING", "INTERVENING", "RECONSTRUCT", "EXPLAIN_BACK", "TRANSFER",
  "MEMORY_PENDING", "COMPLETED", "SOFT_LANDING", "WAITING_PARENT", "WAITING_CONFIRMATION",
  "PAUSED_TECH", "PAUSED_CHILD", "CONTESTED",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** “活动状态”：儿童控制权事件在这些状态下不得被拒绝 */
export const ACTIVE_STATES: readonly SessionState[] = [
  "INDEPENDENT", "ASSESSING", "INTERVENING", "RECONSTRUCT", "EXPLAIN_BACK", "TRANSFER", "MEMORY_PENDING", "SOFT_LANDING", "CONTESTED",
];

export type Signal =
  | { kind: "challengeValidated" }
  | { kind: "curriculumInsufficient" }
  | { kind: "parentConfirmedMaterial" }
  | { kind: "childOutput"; isNewStrategy: boolean }
  | { kind: "childDone" }
  | { kind: "helpRequest" }
  | { kind: "pauseRequest" }
  | { kind: "resume" }
  | { kind: "contest"; target: ContestTarget }
  | { kind: "windowExpired" }
  | { kind: "hardCapReached" }
  | { kind: "assessedRecoverable" }
  | { kind: "assessedIndependentSolution" }
  | { kind: "assessedBudgetExhausted" }
  | { kind: "hintIssued"; level: number; liftsSoftBudget: boolean }
  | { kind: "demoIssued" }
  | { kind: "noNewOutputWillingToContinue" }
  | { kind: "budgetExhausted" }
  | { kind: "reconstructDone" }
  | { kind: "reconstructStuck" }
  | { kind: "explainBackPassed" }
  | { kind: "explainBackRevealedGap" }
  | { kind: "transferSucceeded"; hasMemoryCandidate: boolean }
  | { kind: "transferFailed" }
  | { kind: "memoryAssent"; choice: "record" | "unsure" | "disagree"; localRulesPassed?: boolean | undefined }
  | { kind: "memoryHeld" }
  | { kind: "probeIssued" }
  | { kind: "softLandingChoice"; choice: "simpler" | "hint" | "stop" }
  | { kind: "transcriptUncertain" }
  | { kind: "transcriptConfirmed" }
  | { kind: "confirmationTimeout" }
  | { kind: "techInterrupted" }
  | { kind: "techRecovered"; checkpointConsistent: boolean }
  | { kind: "contestNewTask" }
  | { kind: "contestVerificationDone"; hasCandidate: boolean }
  | { kind: "nextChallenge" };

export type KernelAction =
  | "createCheckpoint" | "resetHintLevel" | "freezeTeaching" | "summarizeEvidence" | "authorizeNextHint"
  | "requestExplainBack" | "withdrawHint" | "removeDemoRequireRebuild" | "enterAssistance" | "createTransferChallenge"
  | "previewMemory" | "saveArtifactOnly" | "commitGrowthRecord" | "keepCandidateTemporary" | "freezeAndPlanVerification"
  | "markAssistedHint" | "saveTempHypotheses" | "revalidateChallenge" | "holdUnconfirmedEvent" | "writeConfirmation"
  | "keepUnconfirmed" | "stopTimers" | "resumeFromCheckpoint" | "restartFromSnapshot" | "restoreContextNoHint"
  | "planDiscriminatingTask" | "stopDiagnosticQuestions" | "askWhereDiffers" | "clearAssisted" | "noInterventionEvidence"
  | "presenceOnly" | "checkUnderstanding" | "askDiscriminatingProbe";

export interface PolicyError {
  code: "unlistedTransition" | "guardFailed";
  from: SessionState;
  signal: Signal["kind"];
}

export interface SessionContext {
  state: SessionState;
  /** 进入等待/暂停类状态前的活动状态，用于“回到原活动状态” */
  priorState: SessionState | null;
  hintLevel: number;
  maxHintLevelUsed: number;
  escalationCount: number;
  /** 软着陆之后的辅助轮：为真时任何能力记录都不得提交 */
  assistedRound: boolean;
  /** 超过软预算继续升级后置为 false，本轮不再计作独立成功 */
  independentSuccess: boolean;
  newOutputSinceLastHint: boolean;
  helpRequestedSinceLastHint: boolean;
  /** 孩子侧实质性尝试次数；4 级演示前必须 ≥ 1 */
  substantiveAttempts: number;
  /** 被异议冻结的提案或假设 id */
  frozenTargets: readonly ContestTarget[];
  policyErrors: PolicyError[];
}

export function createSessionContext(): SessionContext {
  return {
    state: "PREPARING", priorState: null, hintLevel: 0, maxHintLevelUsed: 0, escalationCount: 0,
    assistedRound: false, independentSuccess: true, newOutputSinceLastHint: true, helpRequestedSinceLastHint: false,
    substantiveAttempts: 0, frozenTargets: [], policyErrors: [],
  };
}

export type TransitionResult =
  | { ok: true; context: SessionContext; actions: KernelAction[] }
  | { ok: false; context: SessionContext; actions: []; error: PolicyError };

type Target = SessionState | "SAME" | "PRIOR";

interface Rule {
  from: SessionState | "ANY_ACTIVE";
  signal: Signal["kind"];
  guard?: (ctx: SessionContext, signal: Signal) => boolean;
  to: Target | ((signal: Signal) => Target);
  actions: KernelAction[] | ((signal: Signal) => KernelAction[]);
  update?: (ctx: SessionContext, signal: Signal) => Partial<SessionContext>;
}

const childOutputUpdate = (ctx: SessionContext): Partial<SessionContext> => ({
  newOutputSinceLastHint: true,
  substantiveAttempts: ctx.substantiveAttempts + 1,
});

// 顺序即优先级：先匹配具体状态行，再匹配“任意活动状态”通配行
const RULES: Rule[] = [
  { from: "PREPARING", signal: "challengeValidated", to: "INDEPENDENT", actions: ["createCheckpoint", "resetHintLevel"], update: () => ({ hintLevel: 0, escalationCount: 0, newOutputSinceLastHint: true, helpRequestedSinceLastHint: false }) },
  { from: "PREPARING", signal: "curriculumInsufficient", to: "WAITING_PARENT", actions: ["freezeTeaching"] },
  { from: "INDEPENDENT", signal: "childOutput", to: "SAME", actions: (s) => (s.kind === "childOutput" && s.isNewStrategy ? ["presenceOnly"] : []), update: (ctx, s) => (s.kind === "childOutput" && s.isNewStrategy ? childOutputUpdate(ctx) : {}) },
  { from: "INDEPENDENT", signal: "windowExpired", to: "ASSESSING", actions: ["summarizeEvidence"] },
  { from: "INDEPENDENT", signal: "hardCapReached", to: "ASSESSING", actions: ["summarizeEvidence"] },
  { from: "INDEPENDENT", signal: "childDone", to: "EXPLAIN_BACK", actions: ["noInterventionEvidence", "requestExplainBack"] },
  { from: "ASSESSING", signal: "helpRequest", to: "SAME", actions: ["summarizeEvidence"], update: () => ({ helpRequestedSinceLastHint: true }) },
  { from: "ASSESSING", signal: "probeIssued", to: "SAME", actions: ["askDiscriminatingProbe"] },
  { from: "ASSESSING", signal: "childOutput", to: "SAME", actions: [], update: (ctx, s) => s.kind === "childOutput" && s.isNewStrategy ? childOutputUpdate(ctx) : {} },
  { from: "ASSESSING", signal: "assessedRecoverable", to: "INTERVENING", actions: ["authorizeNextHint"] },
  { from: "ASSESSING", signal: "assessedIndependentSolution", to: "EXPLAIN_BACK", actions: ["requestExplainBack"] },
  { from: "ASSESSING", signal: "assessedBudgetExhausted", to: "SOFT_LANDING", actions: ["enterAssistance"], update: () => ({ assistedRound: true }) },
  // 只有“新尝试”才撤提示回 0 级；擦除或重画相同内容不算
  { from: "INTERVENING", signal: "childOutput", to: (s) => (s.kind === "childOutput" && s.isNewStrategy ? "INDEPENDENT" : "SAME"), actions: (s) => (s.kind === "childOutput" && s.isNewStrategy ? ["withdrawHint", "resetHintLevel"] : []), update: (ctx, s) => (s.kind === "childOutput" && s.isNewStrategy ? { ...childOutputUpdate(ctx), hintLevel: 0 } : {}) },
  { from: "INTERVENING", signal: "hintIssued", to: "SAME", actions: [], update: (ctx, s) => s.kind === "hintIssued" ? ({
      hintLevel: s.level, maxHintLevelUsed: Math.max(ctx.maxHintLevelUsed, s.level), escalationCount: ctx.escalationCount + 1,
      newOutputSinceLastHint: false, helpRequestedSinceLastHint: false, independentSuccess: ctx.independentSuccess && !s.liftsSoftBudget,
    }) : {} },
  { from: "INTERVENING", signal: "noNewOutputWillingToContinue", to: "ASSESSING", actions: ["summarizeEvidence"] },
  { from: "INTERVENING", signal: "demoIssued", guard: (ctx) => ctx.substantiveAttempts >= 1, to: "RECONSTRUCT", actions: ["removeDemoRequireRebuild"] },
  { from: "INTERVENING", signal: "budgetExhausted", to: "SOFT_LANDING", actions: ["enterAssistance"], update: () => ({ assistedRound: true }) },
  { from: "RECONSTRUCT", signal: "childOutput", to: "SAME", actions: [], update: (ctx) => childOutputUpdate(ctx) },
  { from: "RECONSTRUCT", signal: "reconstructDone", to: "EXPLAIN_BACK", actions: ["checkUnderstanding"] },
  { from: "RECONSTRUCT", signal: "reconstructStuck", to: "SOFT_LANDING", actions: ["enterAssistance"], update: () => ({ assistedRound: true }) },
  { from: "EXPLAIN_BACK", signal: "childOutput", to: "SAME", actions: [], update: (ctx) => childOutputUpdate(ctx) },
  { from: "EXPLAIN_BACK", signal: "explainBackPassed", to: "TRANSFER", actions: ["createTransferChallenge", "resetHintLevel"], update: () => ({ hintLevel: 0 }) },
  { from: "EXPLAIN_BACK", signal: "explainBackRevealedGap", to: "ASSESSING", actions: ["saveTempHypotheses"] },
  { from: "TRANSFER", signal: "childOutput", to: "SAME", actions: [], update: (ctx) => childOutputUpdate(ctx) },
  { from: "TRANSFER", signal: "transferSucceeded", to: (s) => (s.kind === "transferSucceeded" && s.hasMemoryCandidate ? "MEMORY_PENDING" : "COMPLETED"), actions: (s) => (s.kind === "transferSucceeded" && s.hasMemoryCandidate ? ["previewMemory"] : ["saveArtifactOnly"]) },
  { from: "TRANSFER", signal: "transferFailed", to: "SOFT_LANDING", actions: ["enterAssistance"], update: () => ({ assistedRound: true }) },
  { from: "MEMORY_PENDING", signal: "memoryAssent", guard: (_ctx, s) => s.kind === "memoryAssent" && (s.choice !== "record" || s.localRulesPassed === true), to: (s) => (s.kind === "memoryAssent" && s.choice === "disagree" ? "CONTESTED" : "COMPLETED"), actions: (s) => {
      if (s.kind !== "memoryAssent") return [];
      return s.choice === "record" ? ["commitGrowthRecord"] : s.choice === "unsure" ? ["keepCandidateTemporary"] : ["freezeAndPlanVerification"];
    } },
  { from: "MEMORY_PENDING", signal: "memoryHeld", to: "COMPLETED", actions: ["keepCandidateTemporary"] },
  { from: "SOFT_LANDING", signal: "softLandingChoice", to: (s) => (s.kind !== "softLandingChoice" ? "SAME" : s.choice === "simpler" ? "PREPARING" : s.choice === "hint" ? "INTERVENING" : "COMPLETED"), actions: (s) => (s.kind !== "softLandingChoice" ? [] : s.choice === "simpler" ? ["revalidateChallenge"] : s.choice === "hint" ? ["markAssistedHint"] : ["saveTempHypotheses"]), update: () => ({ assistedRound: true }) },
  { from: "WAITING_PARENT", signal: "parentConfirmedMaterial", to: "PREPARING", actions: ["revalidateChallenge"] },
  { from: "WAITING_CONFIRMATION", signal: "transcriptConfirmed", to: "PRIOR", actions: ["writeConfirmation"] },
  { from: "WAITING_CONFIRMATION", signal: "confirmationTimeout", to: "PRIOR", actions: ["keepUnconfirmed"] },
  { from: "PAUSED_TECH", signal: "techRecovered", to: (s) => (s.kind === "techRecovered" && s.checkpointConsistent ? "PRIOR" : "PREPARING"), actions: (s) => (s.kind === "techRecovered" && s.checkpointConsistent ? ["resumeFromCheckpoint"] : ["restartFromSnapshot"]) },
  { from: "PAUSED_CHILD", signal: "resume", to: "PRIOR", actions: ["restoreContextNoHint"], update: () => ({ hintLevel: 0 }) },
  { from: "CONTESTED", signal: "contestNewTask", to: "PREPARING", actions: ["planDiscriminatingTask"] },
  { from: "CONTESTED", signal: "contestVerificationDone", to: (s) => (s.kind === "contestVerificationDone" && s.hasCandidate ? "MEMORY_PENDING" : "COMPLETED"), actions: [] },
  { from: "COMPLETED", signal: "nextChallenge", to: "PREPARING", actions: ["clearAssisted", "resetHintLevel"], update: () => ({ assistedRound: false, hintLevel: 0, escalationCount: 0, independentSuccess: true, maxHintLevelUsed: 0, substantiveAttempts: 0 }) },
  // 儿童控制权与中断类通配行
  { from: "ANY_ACTIVE", signal: "pauseRequest", to: "PAUSED_CHILD", actions: ["createCheckpoint"] },
  { from: "ANY_ACTIVE", signal: "helpRequest", to: "ASSESSING", actions: ["summarizeEvidence"], update: () => ({ helpRequestedSinceLastHint: true }) },
  { from: "ANY_ACTIVE", signal: "contest", to: "CONTESTED", actions: ["stopDiagnosticQuestions", "freezeTeaching", "askWhereDiffers"], update: (ctx, s) => ({ frozenTargets: s.kind === "contest" && !ctx.frozenTargets.some(target => target.kind === s.target.kind && target.id === s.target.id) ? [...ctx.frozenTargets, s.target] : ctx.frozenTargets }) },
  { from: "ANY_ACTIVE", signal: "transcriptUncertain", to: "WAITING_CONFIRMATION", actions: ["holdUnconfirmedEvent"] },
  { from: "ANY_ACTIVE", signal: "techInterrupted", to: "PAUSED_TECH", actions: ["createCheckpoint", "stopTimers"] },
];

const PARKING_STATES: readonly SessionState[] = ["WAITING_CONFIRMATION", "PAUSED_TECH", "PAUSED_CHILD"];

export function transition(ctx: SessionContext, signal: Signal): TransitionResult {
  const isActive = ACTIVE_STATES.includes(ctx.state);
  const rule = RULES.find((r) => r.signal === signal.kind && (r.from === ctx.state || (r.from === "ANY_ACTIVE" && isActive)));
  if (!rule) return reject(ctx, { code: "unlistedTransition", from: ctx.state, signal: signal.kind });
  if (rule.guard && !rule.guard(ctx, signal)) return reject(ctx, { code: "guardFailed", from: ctx.state, signal: signal.kind });

  const target = typeof rule.to === "function" ? rule.to(signal) : rule.to;
  let nextState: SessionState;
  let priorState = ctx.priorState;
  if (target === "SAME") nextState = ctx.state;
  else if (target === "PRIOR") { nextState = ctx.priorState ?? "PREPARING"; priorState = null; }
  else { nextState = target; if (PARKING_STATES.includes(target)) priorState = ctx.state; else priorState = null; }

  const actions = typeof rule.actions === "function" ? rule.actions(signal) : rule.actions;
  const patch = rule.update ? rule.update(ctx, signal) : {};
  return { ok: true, context: { ...ctx, ...patch, state: nextState, priorState }, actions: [...actions] };
}

function reject(ctx: SessionContext, error: PolicyError): TransitionResult {
  return { ok: false, context: { ...ctx, policyErrors: [...ctx.policyErrors, error] }, actions: [], error };
}
