import { expect, test } from "vitest";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { RunRecorder } from "../../src/growth/run-recorder.js";
import { fakePlugin } from "../helpers/fake-plugin.js";
import type { SessionGateSnapshot } from "../../src/growth/types.js";

test("三次独立迁移只生成待审候选，家长不能直接提交，后续孩子同意才写档3", () => {
  const db = openLearningDatabase(":memory:");
  let now = 0;
  const ledger = GrowthLedgerService.open({ db, clock: () => now });
  try {
    ledger.childPort().acknowledgeFirstUse("kid");
    const ingest = (index: number) => {
      now = index * 100;
      const challenge = { ...fakePlugin.createChallenge({ curriculumAnchor: "test" }), surfaceContextKey: `surface${index}` };
      const recorder = new RunRecorder(`s${index}`, "kid");
      recorder.beginRun(challenge, 1, 1, now - 20); recorder.enterTransfer(now - 10); recorder.noteTransferOutcome("succeeded");
      const run = recorder.snapshot(now);
      ledger.sessionPort().ingestRun({ learnerId: "kid", run, qualityOf: () => "confirmed", artifactVersionOf: () => null,
        evidence: [{ evidenceId: `e${index}`, eventId: `e${index}`, kind: "answer", summary: "完成", hypothesisSupport: [], surfaceContextKey: run.surfaceContextKey, selfCorrection: false }] });
      return run;
    };
    ingest(1); ingest(2); ingest(3);
    const candidate = ledger.parentPort().candidates("kid").find(candidate => candidate.tier === 3)!;
    expect(candidate.status).toBe("awaiting_parent");
    ledger.parentPort().review("kid", candidate.candidateId, "approved");
    expect(ledger.childPort().records("kid")).toHaveLength(0);
    const run = ingest(4);
    const snapshot: SessionGateSnapshot = { sessionId: run.sessionId, runId: run.runId, takenAt: now, state: "TRANSFER",
      assistedRound: false, frozenTargets: [], maxHintLevelUsedInRound: 0, transferHintLevelUsedInRound: 0, transferTainted: false, probeResolved: false, previewNonce: null };
    const queued = ledger.sessionPort().nextCandidateToAsk("kid", "fake", snapshot);
    expect(queued?.candidateId).toBe(candidate.candidateId);
    ledger.sessionPort().markPreviewShown("kid", candidate.candidateId, "pv", now);
    now++;
    const decision = ledger.assentPort().recordAssent({ learnerId: "kid", candidateId: candidate.candidateId, previewNonce: "pv", choice: "record", eventId: "assent", answeredAt: now,
      snapshot: { ...snapshot, takenAt: now, state: "MEMORY_PENDING", previewNonce: "pv" }, transitionAccepted: true, stateAfterTransition: "COMPLETED" });
    expect(decision.failures).toEqual([]);
    expect(ledger.childPort().records("kid")[0]?.tier).toBe(3);
  } finally { db.close(); }
});
