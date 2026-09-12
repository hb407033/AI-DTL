import { expect, test } from "vitest";
import { assertRecordComplete, decide, GATE_RULES, preflight, type GateInput } from "../../src/growth/gate-rules.js";
import { ASK_AGAIN_COOLDOWN_MS } from "../../src/growth/constants.js";

function fixture(tier: 2 | 3 = 2): GateInput {
  const transferRefs = Array.from({ length: tier === 2 ? 1 : 3 }, (_, index) => ({ runId: `r${index}`, challengeId: `c${index}`, transferHintLevelUsed: 0 as const, maxHintLevelUsedInRound: 4, achievedVia: "afterDemoRebuild" as const, occurredAt: 100 }));
  const candidate = { candidateId: "candidate", learnerId: "learner", tier, claimKey: "claim", targetObject: { id: "goal", label: "把过程说清楚" }, scope: { probeFamilyId: "family", difficultyBandIndex: 0, surfaceContextKeys: ["surface"] }, counts: { supportingChallenges: 3, refutingChallenges: 0, distinctSurfaceContexts: 3, independentTransferSuccesses: 3, hintedSuccesses: 0 }, evidenceLinkIds: ["link"], hypothesisKeys: [], transferRefs, maxHintLevelUsedAtAchievement: 4, nextVerification: { kind: "sameFamilyNewSurface" as const, probeFamilyId: "family", difficultyBandIndex: 0, minSurfaceContexts: 1, dueAt: 200, expiresAt: 300 }, childFacingText: "你把过程说清楚了", evidenceSummaryText: "观察到三次", contestTarget: { kind: "candidate" as const, id: "candidate" }, proposedBy: "kernel" as const, previewNonce: "nonce", shownAt: 90, status: "awaiting_child" as const, createdAt: 80 };
  const run = { runId: "r0", sessionId: "session", challengeId: "c0", discipline: "fake", probeFamilyId: "family", difficultyBand: "base", difficultyBandIndex: 0, developmentGoalId: "goal", childFacingGoalPhrase: "把过程说清楚", surfaceContextKey: "surface", surfaceContextLabel: "这种情境", claimKey: "claim", startedAt: 0, endedAt: 100, firstServerSeq: 1, lastServerSeq: 5, artifactVersionIds: ["artifact"], maxHintLevelUsed: 4, escalationCount: 1, probesIssued: 0, transferOutcome: "succeeded" as const, transferHintLevelUsed: 0, transferTainted: false, reconstructed: true, assistedRound: false, selfCorrectionObserved: false, timeToFirstProductiveActionMs: 10, probeResolved: false, discriminates: [] };
  return { candidate, record: { ...candidate, recordId: "record", lastObservedAt: 100, status: "confirmed", contests: [], trendRef: tier === 3 ? { windowRunIds: ["r0", "r1", "r2"], verdict: "flat" } : null, decisionId: "decision", committedAt: 100, suppressedReason: null }, run, snapshot: { sessionId: "session", runId: "r0", takenAt: 100, state: "MEMORY_PENDING", assistedRound: false, frozenTargets: [], maxHintLevelUsedInRound: 4, transferHintLevelUsedInRound: 0, transferTainted: false, probeResolved: false, previewNonce: "nonce" }, callAt: 100, clock: () => 100, decisionId: "decision", firstUseAcknowledged: true, knownHypothesisKeys: [], unresolvedContest: false, frozenLinkIds: [], unfreezeConditionsMet: true, claimSuppressed: false, forbiddenClaimPatterns: [], comparableRuns: [run, { ...run, runId: "r1" }, { ...run, runId: "r2" }], parentReview: { reviewId: "review", status: "approved", reviewedAt: 80, claimContestedAtReview: false }, assent: { previewNonce: "nonce", answeredAt: 100, choice: "record" }, transitionAccepted: true, stateAfterTransition: "COMPLETED", priorDecline: null };
}

test.each([2, 3] as const)("档 %s 合法候选全规则通过，预检不提交", (tier) => {
  const input = fixture(tier);
  expect(preflight(input).failures).toEqual([]);
  expect(preflight(input).outcome.committed).toBe(false);
  expect(decide(input).outcome).toEqual({ committed: true, recordId: "record", reasonCode: null });
  input.snapshot.assistedRound = true;
  expect(preflight(input).failures).toContain("shared.notAssistedRound");
});

const mutations: [string, 2 | 3, (i: GateInput) => void][] = [
  ["shared.sourceAligned", 2, i => { i.sourceRejected = true; }],
  ["shared.firstUseAcknowledged", 2, (i) => { i.firstUseAcknowledged = false; }],
  ["shared.snapshotPresent", 2, (i) => { i.snapshot = undefined as unknown as GateInput["snapshot"]; }],
  ["shared.snapshotFresh", 2, (i) => { i.snapshot.takenAt--; }],
  ["shared.stateIsMemoryPending", 2, (i) => { i.snapshot.state = "ASSESSING"; }],
  ["shared.notAssistedRound", 2, (i) => { i.snapshot.assistedRound = true; }],
  ["shared.notFrozenTarget", 2, (i) => { i.snapshot.frozenTargets = [{ kind: "candidate", id: "candidate" }]; }],
  ["shared.notContestedClaim", 2, (i) => { i.unresolvedContest = true; }],
  ["shared.notReusingFrozenEvidence", 2, (i) => { i.frozenLinkIds = ["link"]; }],
  ["shared.claimNotSuppressed", 2, (i) => { i.claimSuppressed = true; }],
  ["shared.discreteOnly", 2, (i) => { i.candidate.counts.supportingChallenges = 0.7; }],
  ["shared.forbiddenLabelFree", 2, (i) => { i.candidate.childFacingText = "你总是错"; }],
  ["shared.recordFieldsComplete", 2, (i) => { i.record.evidenceLinkIds = []; }],
  ["t2.transferSucceededThisRun", 2, (i) => { i.run.transferOutcome = "failed"; }],
  ["t2.transferUnhinted", 2, (i) => { i.snapshot.transferHintLevelUsedInRound = 2; }],
  ["t2.hypothesesKnown", 2, (i) => { i.candidate.hypothesisKeys = ["unknown"]; }],
  ["t2.rootCauseDiscriminated", 2, (i) => { i.candidate.hypothesisKeys = ["known"]; i.knownHypothesisKeys = ["known"]; }],
  ["t2.askAgainAllowed", 2, (i) => { i.priorDecline = { declinedAt: 99, newRunCount: 1, hasNewSurfaceEvidence: true }; }],
  ["t3.threeComparableChallenges", 3, (i) => { i.comparableRuns = i.comparableRuns.slice(0, 2); }],
  ["t3.trendUsable", 3, (i) => { i.record.trendRef = { windowRunIds: [], verdict: "rising" }; }],
  ["t3.parentApproved", 3, (i) => { i.parentReview = null; }],
  ["t3.noApprovalOnContested", 3, (i) => { i.parentReview!.claimContestedAtReview = true; }],
  ["t3.parentBeforeChild", 3, (i) => { i.parentReview!.reviewedAt = 101; }],
  ["t2.assentNonceMatches", 2, (i) => { i.assent!.previewNonce = "old"; }],
  ["t2.assentAfterPreview", 2, (i) => { i.assent!.answeredAt = 89; }],
  ["t2.assentChoiceIsRecord", 2, (i) => { i.assent!.choice = "unsure"; }],
  ["shared.postTransitionCompleted", 2, (i) => { i.transitionAccepted = false; }],
];
test.each(mutations)("拒绝 %s 并保留决策轨迹", (id, tier, mutate) => {
  const input = fixture(tier); mutate(input);
  const result = decide(input);
  expect(result.failures).toContain(id);
  expect(result.outcome.recordId).toBeNull();
  expect(result.rulesetId).toBe("growth-gate-v2");
});
test("规则表每条均有反例断言", () => expect(mutations.map(([id]) => id).sort()).toEqual(GATE_RULES.map((entry) => entry.ruleId).sort()));
test("20 组组合输入：失败集包含关系且不短路", () => {
  for (let index = 0; index < 20; index++) {
    const input = fixture(index % 2 ? 2 : 3);
    input.firstUseAcknowledged = index % 3 === 0;
    input.claimSuppressed = index % 2 === 0;
    input.unresolvedContest = true;
    expect(preflight(input).failures.every((id) => decide(input).failures.includes(id))).toBe(true);
    expect(decide(input).ruleResults.length).toBe(GATE_RULES.filter((entry) => entry.tiers.includes(input.candidate.tier)).length);
  }
});
test("冷却期满仍须新轮与新情境", () => {
  const input = fixture();
  input.priorDecline = { declinedAt: 100 - ASK_AGAIN_COOLDOWN_MS, newRunCount: 1, hasNewSurfaceEvidence: false };
  expect(preflight(input).failures).toContain("t2.askAgainAllowed");
  input.priorDecline.hasNewSurfaceEvidence = true;
  expect(preflight(input).failures).toEqual([]);
  input.priorDecline.newRunCount = 0;
  expect(preflight(input).failures).toContain("t2.askAgainAllowed");
});
test("缺字段明确列名，无根因时完整性不受影响", () => {
  const input = fixture();
  expect(assertRecordComplete(input.record)).toEqual([]);
  input.record.evidenceLinkIds = [];
  expect(preflight(input).ruleResults.find((r) => r.ruleId === "shared.recordFieldsComplete")?.detail).toContain("evidenceLinkIds");
});
test("迁移污染与历史高提示分开，隔天同意有效", () => {
  const input = fixture();
  input.assent!.answeredAt += 86400000;
  expect(decide(input).failures).toEqual([]);
  input.snapshot.transferTainted = true;
  expect(preflight(input).failures).toContain("t2.transferUnhinted");
});
test.each(["rising", "incomplete", "insufficient"] as const)("档 3 拒绝趋势 %s", (verdict) => {
  const input = fixture(3); input.record.trendRef = { windowRunIds: [], verdict };
  expect(preflight(input).failures).toContain("t3.trendUsable");
});
test("档 3 任一点受帮助均不合格", () => {
  const input = fixture(3);
  input.comparableRuns = input.comparableRuns.map((run, index) => ({ ...run, assistedRound: index === 1 }));
  expect(preflight(input).failures).toContain("t3.threeComparableChallenges");
});
test.each([
  ["迁移失败", { transferOutcome: "failed" as const }],
  ["未迁移", { transferOutcome: "none" as const }],
  ["迁移用过提示", { transferHintLevelUsed: 1 }],
  ["迁移被污染", { transferTainted: true }],
  ["发展目标不同", { developmentGoalId: "other" }],
  ["题族不同", { probeFamilyId: "other" }],
  ["难度不同", { difficultyBandIndex: 1 }],
  ["领域不同", { discipline: "other" }],
] as const)("档 3 支撑轮%s不能混入", (_label, patch) => {
  const input = fixture(3);
  input.comparableRuns = input.comparableRuns.map((run, index) => index === 1 ? { ...run, ...patch } : run);
  expect(preflight(input).failures).toContain("t3.threeComparableChallenges");
});
test("档 3 支撑轮必须属于引用的趋势窗口", () => {
  const input = fixture(3);
  input.record.trendRef = { windowRunIds: ["other0", "other1", "other2"], verdict: "flat" };
  expect(preflight(input).failures).toContain("t3.threeComparableChallenges");
});
test.each(["candidate", "record"] as const)("档 3 %s 的迁移引用必须与支撑轮集合一致", (field) => {
  const input = fixture(3);
  input[field].transferRefs = input[field].transferRefs.map((ref, index) => index === 1 ? { ...ref, runId: "other" } : ref);
  expect(preflight(input).failures).toContain("t3.threeComparableChallenges");
});
test("重复支撑轮不能凑成三个挑战", () => {
  const input = fixture(3);
  input.comparableRuns = [input.run, input.run, input.run];
  expect(preflight(input).failures).toContain("t3.threeComparableChallenges");
});
test.each([preflight, decide])("档 3 缺迁移引用仍收齐门禁轨迹", (evaluate) => {
  const input = fixture(3);
  delete (input.record as unknown as Record<string, unknown>).transferRefs;
  const result = evaluate(input);
  expect(result.failures).toContain("shared.recordFieldsComplete");
  expect(result.failures).toContain("t3.threeComparableChallenges");
  expect(result.ruleResults.at(-1)?.ruleId).toBe(evaluate === decide ? "shared.postTransitionCompleted" : "t3.noApprovalOnContested");
});
test.each(["targetObject", "scope", "evidenceLinkIds", "counts", "lastObservedAt", "status", "nextVerification", "contests", "transferRefs", "maxHintLevelUsedAtAchievement"])("记录缺失 %s 给出字段名", (field) => {
  const input = fixture();
  delete (input.record as unknown as Record<string, unknown>)[field];
  expect(assertRecordComplete(input.record)).toContain(field);
});
