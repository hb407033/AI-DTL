import { describe, expect, test } from "vitest";
import { EXPIRE_INTERVAL_MS } from "../../src/growth/constants.js";
import { assertActiveCandidateLimit, canUnfreeze, recomputeHypothesisState, type ContestRecord } from "../../src/growth/hypothesis.js";
import type { ChallengeRun, ClaimEvidenceLink } from "../../src/growth/types.js";

const run = (runId: string, patch: Partial<ChallengeRun> = {}): ChallengeRun => ({
  runId, sessionId: "s-1", challengeId: `c-${runId}`, discipline: "fake",
  probeFamilyId: "fam-1", difficultyBand: "base", difficultyBandIndex: 1,
  developmentGoalId: "goal-1", childFacingGoalPhrase: "把这件事说清楚",
  surfaceContextKey: "surf-a", surfaceContextLabel: "这种题", claimKey: "fake::fam-1::goal-1",
  startedAt: 0, endedAt: 1, firstServerSeq: 1, lastServerSeq: 2, artifactVersionIds: [],
  maxHintLevelUsed: 0, escalationCount: 0, probesIssued: 0,
  transferOutcome: "none", transferHintLevelUsed: 0, transferTainted: false,
  reconstructed: false, assistedRound: false, selfCorrectionObserved: false,
  timeToFirstProductiveActionMs: null, probeResolved: false, discriminates: [], ...patch,
});

const link = (id: string, runId: string, surface: string, at: number, patch: Partial<ClaimEvidenceLink> = {}): ClaimEvidenceLink => ({
  linkId: id, learnerId: "kid", runId, eventId: `e-${id}`, evidenceId: `ev-${id}`,
  claimKey: "fake::fam-1::goal-1", hypothesisKey: "h1", direction: "supports",
  surfaceContextKey: surface, fromProbeId: null, selfCorrection: false,
  artifactVersionId: null, observedAt: at, status: "active", ...patch,
});

const state = (input: Parameters<typeof recomputeHypothesisState>[0]) => recomputeHypothesisState(input);

describe("假设状态由证据重算，不靠维护", () => {
  test("只在一种表面情境里成功，永远到不了确认", () => {
    const links = [link("l1", "r-1", "surf-a", 1), link("l2", "r-2", "surf-a", 2)];
    const result = state({ previous: "suspected", hypothesisKey: "h1", links, runs: [run("r-1"), run("r-2")], contests: [], now: 10 });
    expect(result.counts.supportingChallenges).toBe(2);
    expect(result.counts.distinctSurfaceContexts).toBe(1);
    expect(result.status).toBe("suspected");
  });

  test("两次支持且两种表面情境才升到确认", () => {
    const links = [link("l1", "r-1", "surf-a", 1), link("l2", "r-2", "surf-b", 2)];
    expect(state({ previous: "suspected", hypothesisKey: "h1", links, runs: [run("r-1"), run("r-2")], contests: [], now: 10 }).status).toBe("confirmed");
  });

  test("确认之后收到一条反驳就降回疑似，不赖着不走", () => {
    const links = [link("l1", "r-1", "surf-a", 1), link("l2", "r-2", "surf-b", 2), link("l3", "r-3", "surf-c", 3, { direction: "weakens" })];
    const result = state({ previous: "confirmed", hypothesisKey: "h1", links, runs: [run("r-1"), run("r-2"), run("r-3")], contests: [], now: 10 });
    expect(result.counts.refutingChallenges).toBe(1);
    expect(result.status).toBe("suspected");
  });

  test("孩子异议后转异议态，且不再用于个性化", () => {
    const links = [link("l1", "r-1", "surf-a", 1), link("l2", "r-2", "surf-b", 2)];
    const contest: ContestRecord = { contestId: "ct-1", claimKeys: ["fake::fam-1::goal-1"], hypothesisKeys: ["h1"], contestedAt: 5, resolvedAt: null, frozenLinkIds: ["l1", "l2"] };
    const result = state({ previous: "confirmed", hypothesisKey: "h1", links, runs: [run("r-1"), run("r-2")], contests: [contest], now: 10 });
    expect(result.status).toBe("contested");
    expect(result.stopsDrivingPersonalization).toBe(true);
  });

  test("异议不能一步跳回确认：解冻后先回疑似", () => {
    const links = [
      link("l1", "r-1", "surf-a", 1), link("l2", "r-2", "surf-b", 2),
      link("l3", "r-3", "surf-c", 9),   // 异议之后、来自区分性轮次的新证据
    ];
    const contest: ContestRecord = { contestId: "ct-1", claimKeys: [], hypothesisKeys: ["h1"], contestedAt: 5, resolvedAt: null, frozenLinkIds: ["l1", "l2"] };
    const runs = [run("r-1"), run("r-2"), run("r-3", { discriminates: ["h1", "h2"] })];
    expect(canUnfreeze(contest, links, runs)).toBe(true);
    const result = state({ previous: "contested", hypothesisKey: "h1", links, runs, contests: [{ ...contest, resolvedAt: 9 }], now: 10 });
    expect(result.status).toBe("suspected");
  });

  test("解冻三条件缺一不可", () => {
    const contest: ContestRecord = { contestId: "ct-1", claimKeys: [], hypothesisKeys: ["h1"], contestedAt: 5, resolvedAt: null, frozenLinkIds: ["l1"] };
    const discriminating = run("r-3", { discriminates: ["h1", "h2"] });
    // 只有冻结集里的旧证据：不算
    expect(canUnfreeze(contest, [link("l1", "r-1", "surf-a", 1)], [run("r-1")])).toBe(false);
    // 新链接但时间早于异议时刻：不算
    expect(canUnfreeze(contest, [link("l9", "r-3", "surf-c", 3)], [discriminating])).toBe(false);
    // 新链接、时间也晚，但来自不能区分候选的轮次：不算
    expect(canUnfreeze(contest, [link("l9", "r-9", "surf-c", 9)], [run("r-9")])).toBe(false);
    // 三条都满足才行
    expect(canUnfreeze(contest, [link("l9", "r-3", "surf-c", 9)], [discriminating])).toBe(true);
  });

  test("证据被删光后转为证据已移除；再有新证据回到疑似", () => {
    const removed = [link("l1", "r-1", "surf-a", 1, { status: "evidence_removed" })];
    expect(state({ previous: "confirmed", hypothesisKey: "h1", links: removed, runs: [run("r-1")], contests: [], now: 10 }).status).toBe("evidence_removed");
    const revived = [...removed, link("l2", "r-2", "surf-b", 2)];
    expect(state({ previous: "evidence_removed", hypothesisKey: "h1", links: revived, runs: [run("r-1"), run("r-2")], contests: [], now: 10 }).status).toBe("suspected");
  });

  test("过期由注入的时刻驱动，跑两遍结论一样", () => {
    const links = [link("l1", "r-1", "surf-a", 1), link("l2", "r-2", "surf-b", 2)];
    const runs = [run("r-1"), run("r-2")];
    const late = 2 + EXPIRE_INTERVAL_MS + 1;
    const first = state({ previous: "confirmed", hypothesisKey: "h1", links, runs, contests: [], now: late });
    const second = state({ previous: "confirmed", hypothesisKey: "h1", links, runs, contests: [], now: late });
    expect(first.status).toBe("expired");
    expect(second).toEqual(first);
    expect(state({ previous: "confirmed", hypothesisKey: "h1", links, runs, contests: [], now: 3 }).status).toBe("confirmed");
  });
});

describe("同一轮最多三个活跃候选", () => {
  test("第四个被拒，两条路径共用同一个判定", () => {
    expect(() => assertActiveCandidateLimit(2)).not.toThrow();
    expect(() => assertActiveCandidateLimit(3)).toThrowError(/roundCandidateCapReached/);
    expect(() => assertActiveCandidateLimit(4)).toThrowError(/roundCandidateCapReached/);
  });
});
