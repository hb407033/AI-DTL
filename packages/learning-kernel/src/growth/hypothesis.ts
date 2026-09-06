// 假设生命周期（设计稿 §5.1，规范 9.4 的六态）。
// 状态是从证据链接重算出来的，不是维护出来的：删除只把链接翻成失效，整体重算一次即可，
// 不存在「某处忘了减计数」这种失效模式。
import { CONFIRM_SURFACE_MIN, CONFIRM_SUPPORT_MIN, EXPIRE_INTERVAL_MS } from "./constants.js";
import { summarizeHypothesis } from "./evidence-fold.js";
import type { ChallengeRun, ClaimEvidenceLink, DiscreteCounts, JudgementStatus } from "./types.js";
import { ROUND_ACTIVE_CANDIDATE_CAP } from "./constants.js";

/** 一次异议：冻结的一等对象是主张键，不是假设——顺利成功那条路上根本没有假设 */
export interface ContestRecord {
  contestId: string;
  claimKeys: readonly string[];
  hypothesisKeys: readonly string[];
  contestedAt: number;
  resolvedAt: number | null;
  /** 异议发生时支撑这些主张的全部证据链接；用原证据重提要被拒 */
  frozenLinkIds: readonly string[];
}

export interface HypothesisStateInput {
  previous: JudgementStatus;
  hypothesisKey: string;
  links: readonly ClaimEvidenceLink[];
  runs: readonly ChallengeRun[];
  contests: readonly ContestRecord[];
  now: number;
}

export interface HypothesisState {
  status: JudgementStatus;
  counts: DiscreteCounts;
  lastObservedAt: number | null;
  expiresAt: number | null;
  /** 异议未解决期间不得用于个性化教学 */
  stopsDrivingPersonalization: boolean;
}

export function recomputeHypothesisState(input: HypothesisStateInput): HypothesisState {
  const mine = input.links.filter((l) => l.hypothesisKey === input.hypothesisKey);
  const active = mine.filter((l) => l.status === "active");
  const counts = summarizeHypothesis(mine, input.runs, input.hypothesisKey);
  const lastObservedAt = active.reduce<number | null>((acc, l) => (acc === null || l.observedAt > acc ? l.observedAt : acc), null);
  const expiresAt = lastObservedAt === null ? null : lastObservedAt + EXPIRE_INTERVAL_MS;

  const open = input.contests.find((c) => c.resolvedAt === null && c.hypothesisKeys.includes(input.hypothesisKey));
  if (open) {
    return { status: "contested", counts, lastObservedAt, expiresAt, stopsDrivingPersonalization: true };
  }

  const base: Omit<HypothesisState, "status"> = { counts, lastObservedAt, expiresAt, stopsDrivingPersonalization: false };
  if (active.length === 0) return { ...base, status: "evidence_removed" };
  if (expiresAt !== null && input.now > expiresAt) return { ...base, status: "expired" };

  // 异议刚解冻只能回到疑似：不能拿被质疑过的同一批证据一步跳回确认
  const justUnfroze = input.previous === "contested";
  if (justUnfroze) return { ...base, status: "suspected" };

  const confirmable = counts.supportingChallenges >= CONFIRM_SUPPORT_MIN
    && counts.distinctSurfaceContexts >= CONFIRM_SURFACE_MIN
    && counts.refutingChallenges === 0;
  return { ...base, status: confirmable ? "confirmed" : "suspected" };
}

/**
 * 解冻的三个条件缺一不可（设计稿 §8.2）：
 * 存在一条新链接，① 不在冻结集里，② 发生在异议之后，③ 来自能区分候选的那种轮次。
 * 少了第三条，孩子的异议就只是一道减速带——同一批证据换个时间点又能把结论顶回来。
 */
export function canUnfreeze(contest: ContestRecord, links: readonly ClaimEvidenceLink[], runs: readonly ChallengeRun[]): boolean {
  const discriminating = new Set(runs.filter((r) => r.discriminates.length > 0).map((r) => r.runId));
  return links.some((link) =>
    link.status === "active"
    && !contest.frozenLinkIds.includes(link.linkId)
    && link.observedAt > contest.contestedAt
    && discriminating.has(link.runId));
}

export class GateError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GateError";
  }
}

/**
 * 同一轮最多三个活跃候选（硬约束 9）。新建候选与把降级候选改回活跃两条路径共用这一个判定，
 * 不依赖任何数据库触发器——触发器挡不住绕过它的写入路径。
 */
export function assertActiveCandidateLimit(activeCount: number): void {
  if (activeCount >= ROUND_ACTIVE_CANDIDATE_CAP) throw new GateError("roundCandidateCapReached");
}
