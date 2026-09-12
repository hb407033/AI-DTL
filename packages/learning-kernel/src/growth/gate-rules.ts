// 成长写入规则集中在此；预检与提交共用规则，逐条留下结果而不短路。
import { ASK_AGAIN_COOLDOWN_MS } from "./constants.js";
import { findDiscreteViolations } from "./discrete-guard.js";
import { screenChildFacingText } from "./forbidden-labels.js";
import type { ChallengeRun, GrowthRecord, MemoryCandidate, MemoryCommitDecision, RuleResult, SessionGateSnapshot } from "./types.js";
import type { SessionState } from "../session-state.js";

export const GATE_RULESET_ID = "growth-gate-v2";

/** 事实由账本读取，时刻由调用方注入；规则函数不访问持久层。 */
export interface GateInput {
  candidate: MemoryCandidate;
  record: GrowthRecord;
  run: ChallengeRun;
  snapshot: SessionGateSnapshot;
  callAt: number;
  clock: () => number;
  decisionId: string;
  firstUseAcknowledged: boolean;
  knownHypothesisKeys: readonly string[];
  unresolvedContest: boolean;
  frozenLinkIds: readonly string[];
  unfreezeConditionsMet: boolean;
  claimSuppressed: boolean;
  forbiddenClaimPatterns: readonly string[];
  comparableRuns: readonly ChallengeRun[];
  parentReview: { reviewId: string; status: string; reviewedAt: number; claimContestedAtReview: boolean } | null;
  assent: { previewNonce: string; answeredAt: number; choice: "record" | "unsure" | "disagree" } | null;
  transitionAccepted: boolean;
  stateAfterTransition: SessionState;
  priorDecline: { declinedAt: number; newRunCount: number; hasNewSurfaceEvidence: boolean } | null;
  sourceRejected?: boolean | undefined;
}

/** 返回七项记录契约的缺失字段；空假设集合是合法情况。 */
export function assertRecordComplete(record: GrowthRecord): string[] {
  const missing: string[] = [];
  const nonnegativeInteger = (value: unknown): boolean => typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (!record.targetObject?.id || !record.targetObject.label) missing.push("targetObject");
  if (!record.scope?.probeFamilyId || !nonnegativeInteger(record.scope.difficultyBandIndex) || !record.scope.surfaceContextKeys?.length) missing.push("scope");
  if (!record.evidenceLinkIds?.length) missing.push("evidenceLinkIds");
  if (!record.counts || ["supportingChallenges", "refutingChallenges", "distinctSurfaceContexts", "independentTransferSuccesses", "hintedSuccesses"].some((key) => !nonnegativeInteger((record.counts as unknown as Record<string, unknown>)[key]))) missing.push("counts");
  if (!Number.isFinite(record.lastObservedAt)) missing.push("lastObservedAt");
  if (!["suspected", "confirmed", "refuted", "contested", "expired", "evidence_removed"].includes(record.status)) missing.push("status");
  if (!record.nextVerification?.probeFamilyId || !["sameFamilyNewSurface", "trendWindowRefresh"].includes(record.nextVerification.kind) || !nonnegativeInteger(record.nextVerification.difficultyBandIndex) || !nonnegativeInteger(record.nextVerification.minSurfaceContexts) || !Number.isFinite(record.nextVerification.dueAt) || !Number.isFinite(record.nextVerification.expiresAt)) missing.push("nextVerification");
  if (!Array.isArray(record.contests)) missing.push("contests");
  if (!record.transferRefs || (record.tier === 2 ? record.transferRefs.length !== 1 : record.transferRefs.length < 3) || record.transferRefs.some((ref) => ref.transferHintLevelUsed !== 0 || !ref.runId || !ref.challengeId || !nonnegativeInteger(ref.maxHintLevelUsedInRound) || !Number.isFinite(ref.occurredAt) || !["independent", "afterDemoRebuild"].includes(ref.achievedVia))) missing.push("transferRefs");
  if (!nonnegativeInteger(record.maxHintLevelUsedAtAchievement)) missing.push("maxHintLevelUsedAtAchievement");
  if (record.tier === 3 && !record.trendRef) missing.push("trendRef");
  return missing;
}

export interface GateRule {
  ruleId: string;
  tiers: readonly (2 | 3)[];
  phase: "preflight" | "decide";
  evaluate: (input: GateInput) => RuleResult;
}

function rule(ruleId: string, tiers: readonly (2 | 3)[], phase: GateRule["phase"], predicate: (input: GateInput) => boolean, detail?: (input: GateInput) => string): GateRule {
  return { ruleId, tiers, phase, evaluate: (input) => ({ ruleId, passed: predicate(input), detail: detail?.(input) ?? ruleId }) };
}

export const GATE_RULES: readonly GateRule[] = [
  rule("shared.sourceAligned", [2, 3], "preflight", i => i.sourceRejected !== true),
  rule("shared.firstUseAcknowledged", [2, 3], "preflight", (i) => i.firstUseAcknowledged),
  rule("shared.snapshotPresent", [2, 3], "preflight", (i) => i.snapshot != null),
  rule("shared.snapshotFresh", [2, 3], "decide", (i) => i.snapshot?.takenAt === i.callAt),
  rule("shared.stateIsMemoryPending", [2, 3], "decide", (i) => i.snapshot?.state === "MEMORY_PENDING"),
  rule("shared.notAssistedRound", [2, 3], "preflight", (i) => i.snapshot?.assistedRound === false),
  rule("shared.notFrozenTarget", [2, 3], "preflight", (i) => !!i.snapshot && !i.snapshot.frozenTargets.some((target) => target.id === i.candidate.candidateId || target.id === i.candidate.claimKey || i.candidate.hypothesisKeys.includes(target.id) || (target.kind === "session" && target.id === i.snapshot.sessionId))),
  rule("shared.notContestedClaim", [2, 3], "preflight", (i) => !i.unresolvedContest),
  rule("shared.notReusingFrozenEvidence", [2, 3], "preflight", (i) => i.unfreezeConditionsMet && !i.candidate.evidenceLinkIds.some((id) => i.frozenLinkIds.includes(id))),
  rule("shared.claimNotSuppressed", [2, 3], "preflight", (i) => !i.claimSuppressed),
  rule("shared.discreteOnly", [2, 3], "preflight", (i) => findDiscreteViolations(i.candidate).length === 0),
  rule("shared.forbiddenLabelFree", [2, 3], "preflight", (i) => screenChildFacingText({ childFacingText: i.candidate.childFacingText, evidenceSummaryText: i.candidate.evidenceSummaryText, targetObjectLabel: i.candidate.targetObject.label, scopeLabel: i.run.surfaceContextLabel }, i.forbiddenClaimPatterns).length === 0),
  rule("shared.recordFieldsComplete", [2, 3], "preflight", (i) => assertRecordComplete(i.record).length === 0, (i) => assertRecordComplete(i.record).join(",")),
  rule("t2.transferSucceededThisRun", [2], "preflight", (i) => i.run.transferOutcome === "succeeded"),
  rule("t2.transferUnhinted", [2], "preflight", (i) => i.snapshot?.transferHintLevelUsedInRound === 0 && i.snapshot.transferTainted === false),
  rule("t2.hypothesesKnown", [2], "preflight", (i) => i.candidate.hypothesisKeys.every((key) => i.knownHypothesisKeys.includes(key))),
  rule("t2.rootCauseDiscriminated", [2], "preflight", (i) => i.candidate.hypothesisKeys.length !== 1 || i.snapshot?.probeResolved === true),
  rule("t2.askAgainAllowed", [2, 3], "preflight", (i) => i.priorDecline === null || (i.callAt - i.priorDecline.declinedAt >= ASK_AGAIN_COOLDOWN_MS && i.priorDecline.newRunCount >= 1 && i.priorDecline.hasNewSurfaceEvidence)),
  rule("t3.threeComparableChallenges", [3], "preflight", (i) => {
    const supportingIds = new Set(i.comparableRuns.map((run) => run.runId));
    const windowIds = new Set(i.record.trendRef?.windowRunIds ?? []);
    // 趋势窗口、支撑轮与迁移引用必须相连，不能用别处成功的轮替当前结论凑数。
    const refsMatch = (refs: GrowthRecord["transferRefs"]): boolean => Array.isArray(refs) && refs.length === supportingIds.size && new Set(refs.map((ref) => ref?.runId)).size === supportingIds.size && refs.every((ref) => ref != null && supportingIds.has(ref.runId) && ref.transferHintLevelUsed === 0);
    return supportingIds.size >= 3 && refsMatch(i.record.transferRefs) && refsMatch(i.candidate.transferRefs)
      && i.comparableRuns.every((run) => windowIds.has(run.runId) && !run.assistedRound
        && run.transferOutcome === "succeeded" && run.transferHintLevelUsed === 0 && !run.transferTainted
        && run.developmentGoalId === i.run.developmentGoalId && run.discipline === i.run.discipline
        && run.probeFamilyId === i.run.probeFamilyId && run.difficultyBandIndex === i.run.difficultyBandIndex);
  }),
  rule("t3.trendUsable", [3], "preflight", (i) => i.record.trendRef?.verdict === "withdrawing" || i.record.trendRef?.verdict === "flat"),
  rule("t3.parentApproved", [3], "preflight", (i) => i.parentReview?.status === "approved"),
  rule("t3.noApprovalOnContested", [3], "preflight", (i) => !i.unresolvedContest && i.parentReview?.claimContestedAtReview === false),
  rule("t3.parentBeforeChild", [3], "decide", (i) => i.parentReview !== null && i.candidate.shownAt !== null && i.parentReview.reviewedAt <= i.candidate.shownAt),
  rule("t2.assentNonceMatches", [2, 3], "decide", (i) => i.assent !== null && i.candidate.previewNonce !== null && i.assent.previewNonce === i.candidate.previewNonce),
  rule("t2.assentAfterPreview", [2, 3], "decide", (i) => i.assent !== null && i.candidate.shownAt !== null && i.assent.answeredAt >= i.candidate.shownAt),
  rule("t2.assentChoiceIsRecord", [2, 3], "decide", (i) => i.assent?.choice === "record"),
  rule("shared.postTransitionCompleted", [2, 3], "decide", (i) => i.transitionAccepted && i.stateAfterTransition === "COMPLETED"),
];

function runRules(input: GateInput, phase: "preflight" | "decide"): MemoryCommitDecision {
  const ruleResults = GATE_RULES.filter((entry) => entry.tiers.includes(input.candidate.tier) && (phase === "decide" || entry.phase === "preflight")).map((entry) => entry.evaluate(input));
  const failures = ruleResults.filter((entry) => !entry.passed).map((entry) => entry.ruleId);
  const committed = phase === "decide" && failures.length === 0;
  return { decisionId: input.decisionId, learnerId: input.candidate.learnerId, candidateId: input.candidate.candidateId, tier: input.candidate.tier, phase, rulesetId: GATE_RULESET_ID, ruleResults, failures, childChoice: input.assent?.choice ?? null, parentReviewId: input.parentReview?.reviewId ?? null, assistedRound: input.snapshot?.assistedRound ?? false, outcome: { committed, recordId: committed ? input.record.recordId : null, reasonCode: failures[0] ?? null }, decidedBy: "GrowthLedgerService", decidedAt: input.clock() };
}

/** 预览前运行；通过仅代表可询问，不表示已提交。 */
export function preflight(input: GateInput): MemoryCommitDecision { return runRules(input, "preflight"); }
/** 孩子回答后重新检查全部规则；本函数只生成决策。 */
export function decide(input: GateInput): MemoryCommitDecision { return runRules(input, "decide"); }

export interface Tier1GateInput {
  artifactId: string; versionNo: number; contentRef: string; contentHash: string;
  writer: "host_snapshot" | "child_upload";
  payload: Record<string, unknown>;
}
export interface Tier1GateResult { ok: boolean; failures: string[] }
function hasClaim(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasClaim);
  return value !== null && typeof value === "object" && Object.entries(value).some(([key, item]) => ["claim", "counts", "hypothesisKeys", "status"].includes(key) || hasClaim(item));
}
/** 原始作品只检查内容引用与结构，不检查孩子原话。 */
export function evaluateTier1Gate(input: Tier1GateInput): Tier1GateResult {
  const rules = [
    { ruleId: "t1.noCapabilityClaim", passed: !hasClaim(input.payload) },
    { ruleId: "t1.hasContentRef", passed: input.contentRef.trim().length > 0 && input.contentHash.trim().length > 0 },
    { ruleId: "t1.noAssentRequired", passed: true },
  ];
  const failures = rules.filter((entry) => !entry.passed).map((entry) => entry.ruleId);
  return { ok: failures.length === 0, failures };
}
