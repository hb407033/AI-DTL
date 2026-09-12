import { expect, test } from "vitest";
import { openLearningDatabase } from "../../src/growth/database.js";
import { FIRST_USE_NOTICE, GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { RunRecorder } from "../../src/growth/run-recorder.js";
import { fakePlugin } from "../helpers/fake-plugin.js";
import type { SessionGateSnapshot } from "../../src/growth/types.js";

function fixture(patterns: string[] = []) {
  const db = openLearningDatabase(":memory:");
  let now = 0;
  const ledger = GrowthLedgerService.open({ db, clock: () => now });
  ledger.childPort().acknowledgeFirstUse("kid");
  const ingest = (index: number) => {
    now = index * 100;
    const recorder = new RunRecorder(`s${index}`, "kid");
    recorder.beginRun({ ...fakePlugin.createChallenge({ curriculumAnchor: "test" }), surfaceContextKey: `surface${index}` }, 1, 1, now - 20);
    recorder.noteArtifactVersion(`v${index}`); recorder.enterTransfer(now - 10); recorder.noteTransferOutcome("succeeded");
    const run = recorder.snapshot(now);
    ledger.sessionPort().ingestArtifactVersion({ learnerId: "kid", artifactId: `a${index}`, artifactVersionId: `v${index}`, sessionId: run.sessionId,
      discipline: "fake", writer: "host_snapshot", versionNo: 1, contentRef: `session:s${index}`, contentHash: `hash${index}`, payload: {} });
    ledger.sessionPort().ingestRun({ learnerId: "kid", run, qualityOf: () => "confirmed", artifactVersionOf: () => `v${index}`,
      pluginPolicy: { forbiddenClaimPatterns: patterns, knownHypothesisKeys: ["h1"] },
      evidence: [{ evidenceId: `e${index}`, eventId: `e${index}`, kind: "answer", summary: "完成", hypothesisSupport: [{ hypothesisId: "h1", direction: "supports" }], surfaceContextKey: run.surfaceContextKey, selfCorrection: false }] });
    const snapshot: SessionGateSnapshot = { sessionId: run.sessionId, runId: run.runId, takenAt: now, state: "TRANSFER", assistedRound: false,
      frozenTargets: [], maxHintLevelUsedInRound: 0, transferHintLevelUsedInRound: 0, transferTainted: false, probeResolved: false, previewNonce: null };
    return { run, snapshot };
  };
  return { db, ledger, ingest, getNow: () => now };
}

test("删除待决按主张停用；撤回恢复；真正删除后残余假设立即重算", () => {
  const f = fixture();
  try {
    f.ingest(1); f.ingest(2);
    expect(f.ledger.sessionPort().personalizationInputs("kid", "fake")[0]?.status).toBe("confirmed");
    const subject = { kind: "artifact" as const, id: "a1" };
    const request = f.ledger.childPort().requestDeletion("kid", subject);
    expect(f.ledger.sessionPort().personalizationInputs("kid", "fake")).toEqual([]);
    expect(f.ledger.sessionPort().blockedHypothesisKeys("kid", "fake")).toEqual(["h1"]);
    f.ledger.childPort().withdrawDeletion("kid", request.requestId);
    expect(f.ledger.sessionPort().personalizationInputs("kid", "fake")).toHaveLength(1);
    f.ledger.parentPort().executeDeletion("kid", subject, f.ledger.parentPort().deletionPreview("kid", subject).preview);
    expect(f.ledger.sessionPort().personalizationInputs("kid", "fake")[0]).toMatchObject({ status: "suspected", counts: { supportingChallenges: 1, distinctSurfaceContexts: 1 } });
  } finally { f.db.close(); }
});

test("档3不得丢失插件对组合文案的禁止规则", () => {
  const f = fixture(["你自己做出来了 3 次"]);
  try { f.ingest(1); f.ingest(2); f.ingest(3); expect(f.ledger.parentPort().candidates("kid").filter(c => c.tier === 3)).toEqual([]); }
  finally { f.db.close(); }
});

test("档3拒绝后不能靠下一轮重新生成、家长批准绕过14天冷却", () => {
  const f = fixture();
  try {
    f.ingest(1); f.ingest(2); f.ingest(3);
    const first = f.ledger.parentPort().candidates("kid")[0]!;
    f.ledger.parentPort().review("kid", first.candidateId, "approved");
    const fourth = f.ingest(4);
    expect(f.ledger.sessionPort().nextCandidateToAsk("kid", "fake", fourth.snapshot)?.candidateId).toBe(first.candidateId);
    f.ledger.sessionPort().markPreviewShown("kid", first.candidateId, "pv", f.getNow());
    f.ledger.assentPort().recordAssent({ learnerId: "kid", candidateId: first.candidateId, previewNonce: "pv", choice: "unsure", eventId: "no", answeredAt: f.getNow(),
      snapshot: { ...fourth.snapshot, state: "MEMORY_PENDING", previewNonce: "pv" }, transitionAccepted: true, stateAfterTransition: "COMPLETED" });
    const fifth = f.ingest(5);
    const next = f.ledger.parentPort().candidates("kid").find(c => c.status === "awaiting_parent")!;
    f.ledger.parentPort().review("kid", next.candidateId, "approved");
    expect(f.ledger.sessionPort().nextCandidateToAsk("kid", "fake", fifth.snapshot)).toBeNull();
  } finally { f.db.close(); }
});

test("首次知情说明覆盖位置、家长可见范围、两次同意与删除待决停用", () => {
  for (const text of ["家里这台电脑", "爸爸妈妈能看到你的作品", "他们同意了我才来问你", "你说‘记下来’我才会记", "爸爸妈妈一起决定", "我先不用那句话"]) expect(FIRST_USE_NOTICE).toContain(text);
});
