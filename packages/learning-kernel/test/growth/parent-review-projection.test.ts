import { expect, test } from "vitest";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { RunRecorder } from "../../src/growth/run-recorder.js";
import { fakePlugin } from "../helpers/fake-plugin.js";

test("家长待审矩阵取真实轮次、五计数、标签与本地作品证据", () => {
  const db = openLearningDatabase(":memory:");
  let now = 0;
  const ledger = GrowthLedgerService.open({ db, clock: () => now });
  try {
    for (let index = 1; index <= 3; index++) {
      now = index * 100;
      const sessionId = `s${index}`, artifactId = `a${index}`, eventId = `e${index}`;
      ledger.sessionPort().ingestArtifactVersion({ learnerId: "kid", artifactId, artifactVersionId: `${artifactId}-v1`, sessionId, discipline: "fake", versionNo: 1, writer: "host_snapshot", contentRef: `session:${sessionId}`, contentHash: "hash", payload: {} });
      const event = { eventId, payload: { type: "ANSWER", text: "实际保存的答案" } };
      db.prepare("INSERT INTO events (event_id,session_id,client_seq,server_seq,content_hash,quality,event_json,received_at) VALUES (?,?,1,1,'hash','confirmed',?,?)").run(eventId, sessionId, JSON.stringify(event), now);
      const recorder = new RunRecorder(sessionId, "kid");
      recorder.beginRun({ ...fakePlugin.createChallenge({ curriculumAnchor: "test" }), surfaceContextKey: `surface${index}` }, 1, 1, now - 20);
      recorder.enterTransfer(now - 10); recorder.noteTransferOutcome("succeeded");
      ledger.sessionPort().ingestRun({ learnerId: "kid", run: recorder.snapshot(now), qualityOf: () => "confirmed", artifactVersionOf: () => `${artifactId}-v1`,
        evidence: [{ evidenceId: eventId, eventId, kind: "answer", summary: "完成", hypothesisSupport: [{ hypothesisId: "h1", direction: "supports" }], surfaceContextKey: `surface${index}`, selfCorrection: false }] });
    }
    const [review] = ledger.parentPort().pendingReviews("kid", fakePlugin.manifest);
    expect(review!.runs.map(run => [run.startedAt, run.probeFamilyId, run.difficultyBandIndex, run.maxHintLevelUsed, run.probesIssued, run.assistedRound])).toEqual([80, 180, 280].map(at => [at, "fake-family", 1, 0, 0, false]));
    expect(review!.hypotheses[0]).toMatchObject({ parentFacingLabel: "关系表征断点", counts: { supportingChallenges: 3, refutingChallenges: 0, distinctSurfaceContexts: 3, independentTransferSuccesses: 3, hintedSuccesses: 0 } });
    expect(review!.artifactLinks).toHaveLength(3);
    expect(review!.blocked).toEqual([]);
    expect(ledger.parentPort().artifactEvidence("kid", "a1")).toMatchObject({ previewAvailable: false, versions: [{ content_ref: "session:s1" }], events: [{ eventId: "e1", payload: { text: "实际保存的答案" } }] });
    expect(ledger.parentPort().artifactEvidence("other", "a1")).toBeNull();
    expect(ledger.parentPort().artifactEvidence("kid", "unknown")).toBeNull();
    ledger.childPort().contest({ learnerId: "kid", target: { kind: "candidate", id: review!.candidate.candidateId }, sessionId: "s3", runId: null, eventId: "contest" });
    expect(ledger.parentPort().pendingReviews("kid", fakePlugin.manifest)[0]!.blocked.length).toBeGreaterThan(0);
  } finally { db.close(); }
});
