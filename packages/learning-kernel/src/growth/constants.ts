// 成长记忆层的常量与标识构造（设计稿 §2.1）。
// 时间常量集中在这里，判定函数一律接收注入的当前时刻，不自己读时钟——否则「过期」「冷却」这类判定不可重复测。
import { createHash } from "node:crypto";

/**
 * 主张键：跨会话、跨轮稳定，第 2 档与第 3 档共用。
 * discipline 是运行时传进来的字符串，不是内核里写死的字面量。
 */
export function claimKeyOf(discipline: string, probeFamilyId: string, developmentGoalId: string): string {
  return `${discipline}::${probeFamilyId}::${developmentGoalId}`;
}

/** 链接标识由「哪一轮、哪条证据、哪个主张、哪个假设」决定，重放同一轮不会双计 */
export function linkIdOf(runId: string, evidenceId: string, claimKey: string, hypothesisKey: string | null): string {
  return createHash("sha256").update(`${runId}|${evidenceId}|${claimKey}|${hypothesisKey ?? ""}`).digest("hex").slice(0, 32);
}

export const ASK_AGAIN_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
export const VERIFY_INTERVAL_MS = 21 * 24 * 60 * 60 * 1000;
export const EXPIRE_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DELETION_SLA_MS = 7 * 24 * 60 * 60 * 1000;

/** 从「疑似」升到「确认」的门槛：至少两次支持，且至少两种不同表面情境 */
export const CONFIRM_SUPPORT_MIN = 2;
export const CONFIRM_SURFACE_MIN = 2;

/** 同一轮最多同时保持三个活跃候选 */
export const ROUND_ACTIVE_CANDIDATE_CAP = 3;

/** 探针预算与提示预算分开：探针是诊断动作，不是帮助动作 */
export const PROBE_BUDGET = { maxPerRun: 3, maxPerAssessing: 1 } as const;
