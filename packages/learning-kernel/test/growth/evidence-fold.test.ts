import { describe, expect, test } from "vitest";
import type { DisciplineEvidence } from "../../src/challenge.js";
import { buildEvidenceLinks, foldRunDirection, summarizeClaim } from "../../src/growth/evidence-fold.js";
import type { ChallengeRun, ClaimEvidenceLink } from "../../src/growth/types.js";
import { resolveConfirmedEvents } from "../../src/transcript-confirmation.js";
import { InMemorySessionStore } from "../../src/store.js";

// 计数单位是「挑战」不是「事件」：一轮里话多的孩子不该因此显得证据更足。
// 计数从链接 fold 出来、从不增量累加，所以「只由已确认且未删除的事件算出」是结构上成立的。
const run = (patch: Partial<ChallengeRun> = {}): ChallengeRun => ({
  runId: "r-1", sessionId: "s-1", challengeId: "c-1", discipline: "fake",
  probeFamilyId: "fam-1", difficultyBand: "base", difficultyBandIndex: 1,
  developmentGoalId: "goal-1", childFacingGoalPhrase: "把这件事说清楚",
  surfaceContextKey: "surf-a", surfaceContextLabel: "这种样子的题", claimKey: "fake::fam-1::goal-1",
  startedAt: 0, endedAt: 100, firstServerSeq: 1, lastServerSeq: 9, artifactVersionIds: [],
  maxHintLevelUsed: 0, escalationCount: 0, probesIssued: 0,
  transferOutcome: "none", transferHintLevelUsed: 0, transferTainted: false,
  reconstructed: false, assistedRound: false, selfCorrectionObserved: false,
  timeToFirstProductiveActionMs: null, probeResolved: false, discriminates: [], ...patch,
});

const evidence = (id: string, direction: "supports" | "weakens", patch: Partial<DisciplineEvidence> = {}): DisciplineEvidence => ({
  evidenceId: id, eventId: `e-${id}`, kind: "answer", summary: id,
  hypothesisSupport: [{ hypothesisId: "h1", direction }],
  surfaceContextKey: "surf-a", selfCorrection: false, ...patch,
});

const build = (r: ChallengeRun, ev: DisciplineEvidence[], quality: (id: string) => "unconfirmed" | "confirmed" | "corrected" = () => "confirmed") =>
  buildEvidenceLinks({ run: r, evidence: ev, qualityOf: quality, artifactVersionOf: () => "av-1" });

describe("建链接", () => {
  test("一条证据既落一行主张级链接，也为每个假设各落一行", () => {
    const { links } = build(run(), [evidence("a", "supports")]);
    expect(links.filter((l) => l.hypothesisKey === null)).toHaveLength(1);
    expect(links.filter((l) => l.hypothesisKey === "h1")).toHaveLength(1);
    expect(links[0]?.artifactVersionId).toBe("av-1");
  });

  test("链接 id 由 run、证据、主张、假设决定，重放同一 run 不双计", () => {
    const first = build(run(), [evidence("a", "supports")]).links;
    const again = build(run(), [evidence("a", "supports")]).links;
    expect(again.map((l) => l.linkId)).toEqual(first.map((l) => l.linkId));
    expect(new Set(first.map((l) => l.linkId)).size).toBe(first.length);
  });

  test("未确认的转写不成链接，单独计数供 Agent 视图查看", () => {
    const result = build(run(), [evidence("a", "supports"), evidence("b", "weakens")], (id) => (id === "e-a" ? "unconfirmed" : "confirmed"));
    expect(result.skippedUnconfirmed).toBe(1);
    expect(result.links.every((l) => l.evidenceId === "b")).toBe(true);
  });

  test("孩子确认或修正过的转写照常成链接", () => {
    expect(build(run(), [evidence("a", "supports")], () => "corrected").links.length).toBeGreaterThan(0);
  });
});

describe("本轮净方向", () => {
  test("同一轮内先支持后削弱，净方向按最后一条算", () => {
    const { links } = build(run(), [
      evidence("a", "supports", { eventId: "e-1" }),
      evidence("b", "weakens", { eventId: "e-2" }),
    ]);
    const claimLinks = links.filter((l) => l.hypothesisKey === null);
    expect(foldRunDirection(claimLinks)).toBe("weakens");
    expect(claimLinks).toHaveLength(2);   // 两条原始链接都还在表里
  });

  test("只有一条证据时净方向就是它自己", () => {
    expect(foldRunDirection(build(run(), [evidence("a", "weakens")]).links.filter((l) => l.hypothesisKey === null))).toBe("weakens");
  });
});

describe("离散摘要", () => {
  const claim = "fake::fam-1::goal-1";
  function linksOf(specs: Array<{ runId: string; direction: "supports" | "weakens"; surface: string; status?: "active" | "evidence_removed" }>): ClaimEvidenceLink[] {
    return specs.map((spec, i) => ({
      linkId: `l-${i}`, learnerId: "kid", runId: spec.runId, eventId: `e-${i}`, evidenceId: `ev-${i}`,
      claimKey: claim, hypothesisKey: null, direction: spec.direction, surfaceContextKey: spec.surface,
      fromProbeId: null, selfCorrection: false, artifactVersionId: null, observedAt: i,
      status: spec.status ?? "active",
    }));
  }

  test("同一轮里三条同向证据只算一个挑战", () => {
    const links = linksOf([
      { runId: "r-1", direction: "supports", surface: "surf-a" },
      { runId: "r-1", direction: "supports", surface: "surf-a" },
      { runId: "r-1", direction: "supports", surface: "surf-a" },
    ]);
    expect(summarizeClaim(links, [run()]).supportingChallenges).toBe(1);
  });

  test("失效的链接不进任何计数", () => {
    const links = linksOf([
      { runId: "r-1", direction: "supports", surface: "surf-a" },
      { runId: "r-2", direction: "supports", surface: "surf-b", status: "evidence_removed" },
    ]);
    const counts = summarizeClaim(links, [run(), run({ runId: "r-2" })]);
    expect(counts.supportingChallenges).toBe(1);
    expect(counts.distinctSurfaceContexts).toBe(1);
  });

  test("不同表面情境数按表面键去重", () => {
    const links = linksOf([
      { runId: "r-1", direction: "supports", surface: "surf-a" },
      { runId: "r-2", direction: "supports", surface: "surf-b" },
      { runId: "r-3", direction: "supports", surface: "surf-a" },
    ]);
    expect(summarizeClaim(links, [run(), run({ runId: "r-2" }), run({ runId: "r-3" })]).distinctSurfaceContexts).toBe(2);
  });

  test("无提示迁移要求这一轮既不是辅助轮、迁移期也没用过提示", () => {
    const clean = run({ runId: "r-1", transferOutcome: "succeeded" });
    const assisted = run({ runId: "r-2", transferOutcome: "succeeded", assistedRound: true });
    const hinted = run({ runId: "r-3", transferOutcome: "succeeded", transferHintLevelUsed: 1 });
    const tainted = run({ runId: "r-4", transferOutcome: "succeeded", transferTainted: true });
    const links = linksOf([1, 2, 3, 4].map((n) => ({ runId: `r-${n}`, direction: "supports" as const, surface: `surf-${n}` })));
    expect(summarizeClaim(links, [clean, assisted, hinted, tainted]).independentTransferSuccesses).toBe(1);
  });

  test("四级演示之后的零提示迁移，两项各加一次：允许写入，依赖度照常记账", () => {
    const afterDemo = run({ runId: "r-1", transferOutcome: "succeeded", transferHintLevelUsed: 0, maxHintLevelUsed: 4 });
    const counts = summarizeClaim(linksOf([{ runId: "r-1", direction: "supports", surface: "surf-a" }]), [afterDemo]);
    expect(counts.independentTransferSuccesses).toBe(1);
    expect(counts.hintedSuccesses).toBe(1);
  });

  test("削弱方向的轮次记进反驳数，不记进支持数", () => {
    const links = linksOf([{ runId: "r-1", direction: "weakens", surface: "surf-a" }]);
    const counts = summarizeClaim(links, [run()]);
    expect([counts.supportingChallenges, counts.refutingChallenges]).toEqual([0, 1]);
  });

  test("没有链接时五项全为零，成长模型为空也算得出", () => {
    expect(summarizeClaim([], [])).toEqual({
      supportingChallenges: 0, refutingChallenges: 0, distinctSurfaceContexts: 0,
      independentTransferSuccesses: 0, hintedSuccesses: 0,
    });
  });
});

describe("有效质量的两个口径必须一致", () => {
  test("存储的单点查询与事件日志的整体推导给出同一结论", () => {
    const store = new InMemorySessionStore();
    const mk = (id: string, seq: number, payload: never, quality: "unconfirmed" | "confirmed" = "confirmed") =>
      ({ event: { eventId: id, clientSessionId: "s", deviceId: "d", clientSeq: seq, occurredAt: seq, quality, source: "child_voice" as const, semanticObjectIds: [], payload }, serverSeq: seq, receivedAt: seq, contentHash: `h-${id}` });
    const utter = mk("e-1", 1, { type: "UTTERANCE", text: "四十一" } as never, "unconfirmed");
    const confirm = mk("e-2", 2, { type: "CONFIRM_TRANSCRIPT", targetEventId: "e-1", confirmed: true, correctedText: "42" } as never);
    store.createSession({ sessionId: "s", discipline: "fake", challenge: {} as never, createdAt: 0 });
    store.appendEvent("s", utter);
    store.appendEvent("s", confirm);
    const resolved = resolveConfirmedEvents(store.listEvents("s").map((e) => e.event));
    expect(store.effectiveQualityOf("s", "e-1")).toBe(resolved[0]?.quality);
    expect(store.effectiveQualityOf("s", "e-1")).toBe("corrected");
  });
});
