import { expect, test } from "vitest";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { RunRecorder } from "../../src/growth/run-recorder.js";
import { fakePlugin } from "../helpers/fake-plugin.js";
import type { SessionGateSnapshot } from "../../src/growth/types.js";

test("预检及裁决不创建记录，真实同意后提交且重放幂等", () => {
  const db = openLearningDatabase(":memory:");
  let now = 100;
  const ledger = GrowthLedgerService.open({ db, clock: () => now });
  try {
    ledger.childPort().acknowledgeFirstUse("kid");
    const challenge = fakePlugin.createChallenge({ curriculumAnchor: "test" });
    const recorder = new RunRecorder("s", "kid");
    recorder.beginRun(challenge, 1, 1, 10);
    recorder.enterTransfer(20); recorder.noteTransferOutcome("succeeded");
    const run = recorder.snapshot(now);
    const session = ledger.sessionPort();
    session.ingestRun({ learnerId: "kid", run, qualityOf: () => "confirmed", artifactVersionOf: () => null,
      evidence: [{ evidenceId: "ev", eventId: "e", kind: "answer", summary: "完成", hypothesisSupport: [],
        surfaceContextKey: run.surfaceContextKey, selfCorrection: false }] });
    const snapshot: SessionGateSnapshot = { sessionId: "s", runId: run.runId, takenAt: now, state: "TRANSFER",
      assistedRound: false, frozenTargets: [], maxHintLevelUsedInRound: 0, transferHintLevelUsedInRound: 0,
      transferTainted: false, probeResolved: false, previewNonce: null };
    const candidate = session.buildAndPreflight({ learnerId: "kid", run, snapshot,
      plugin: { forbiddenClaimPatterns: [], knownHypothesisKeys: [] } }).candidate!;
    expect(candidate).not.toBeNull();
    expect(ledger.childPort().records("kid")).toHaveLength(0);
    session.markPreviewShown("kid", candidate.candidateId, "pv", now);
    now = 101;
    const input = { learnerId: "kid", candidateId: candidate.candidateId, previewNonce: "pv", choice: "record" as const,
      eventId: "assent", answeredAt: now, snapshot: { ...snapshot, state: "MEMORY_PENDING" as const, takenAt: now, previewNonce: "pv" } };
    const allRows = () => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row =>
      db.prepare(`SELECT * FROM "${String(row.name)}" ORDER BY rowid`).all()));
    const beforeEvaluation = allRows();
    expect(session.evaluateAssent(input).wouldCommit).toBe(true);
    expect(allRows()).toBe(beforeEvaluation);
    expect(ledger.childPort().records("kid")).toHaveLength(0);
    const committed = ledger.assentPort().recordAssent({ ...input, transitionAccepted: true, stateAfterTransition: "COMPLETED" });
    expect(committed.outcome.committed).toBe(true);
    expect(ledger.assentPort().recordAssent({ ...input, transitionAccepted: true, stateAfterTransition: "COMPLETED" })).toEqual(committed);
    expect(ledger.childPort().records("kid")).toHaveLength(1);
    const reopened = GrowthLedgerService.open({ db, clock: () => now });
    expect(reopened.childPort().records("kid")).toHaveLength(1);
    expect(reopened.assentPort().recordAssent({ ...input, transitionAccepted: true, stateAfterTransition: "COMPLETED" })).toEqual(committed);
  } finally { db.close(); }
});
