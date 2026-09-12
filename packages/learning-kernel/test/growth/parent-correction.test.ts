import { expect, test } from "vitest";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { RunRecorder } from "../../src/growth/run-recorder.js";
import { fakePlugin } from "../helpers/fake-plugin.js";
import type { SessionGateSnapshot } from "../../src/growth/types.js";

function fixture(firstLabel?: string) {
  const db = openLearningDatabase(":memory:");
  let now = 100;
  const ledger = GrowthLedgerService.open({ db, clock: () => now });
  ledger.childPort().acknowledgeFirstUse("kid");
  const session = ledger.sessionPort();
  const ingest = (index: number, surface = "one", hinted = false) => {
    now = index * 100;
    const recorder = new RunRecorder(`s${index}`, "kid");
    recorder.beginRun({ ...fakePlugin.createChallenge({ curriculumAnchor: "test" }), surfaceContextKey: surface, surfaceContextLabel: index === 1 && firstLabel ? firstLabel : `场景${surface}` }, 1, 1, now - 20);
    recorder.enterTransfer(now - 10); recorder.noteTransferOutcome("succeeded");
    const run = { ...recorder.snapshot(now), transferHintLevelUsed: hinted ? 1 : 0 };
    session.ingestRun({ learnerId: "kid", run, qualityOf: () => "confirmed", artifactVersionOf: () => null,
      evidence: [surface, "two"].map((key, i) => ({ evidenceId: `e${index}-${i}`, eventId: `e${index}-${i}`, kind: "answer" as const,
        summary: "完成", hypothesisSupport: [], surfaceContextKey: key, selfCorrection: false })) });
    const snapshot: SessionGateSnapshot = { sessionId: run.sessionId, runId: run.runId, takenAt: now, state: "TRANSFER",
      assistedRound: false, frozenTargets: [], maxHintLevelUsedInRound: 0, transferHintLevelUsedInRound: hinted ? 1 : 0,
      transferTainted: false, probeResolved: false, previewNonce: null };
    return { run, snapshot };
  };
  const first = ingest(1);
  const candidate = session.buildAndPreflight({ learnerId: "kid", ...first, plugin: { forbiddenClaimPatterns: [], knownHypothesisKeys: [] } }).candidate!;
  const assent = (candidateId: string, snapshot: SessionGateSnapshot, nonce: string) => {
    session.markPreviewShown("kid", candidateId, nonce, now);
    now++;
    return { learnerId: "kid", candidateId, previewNonce: nonce, choice: "record" as const, eventId: `assent-${nonce}`, answeredAt: now,
      snapshot: { ...snapshot, takenAt: now, state: "MEMORY_PENDING" as const, previewNonce: nonce }, transitionAccepted: true, stateAfterTransition: "COMPLETED" as const };
  };
  const originalInput = assent(candidate.candidateId, first.snapshot, "old");
  expect(ledger.assentPort().recordAssent(originalInput).outcome.committed).toBe(true);
  const record = ledger.childPort().records("kid")[0]!;
  expect(record.scope.surfaceContextKeys).toEqual(["one", "two"]);
  return { db, ledger, session, ingest, assent, record, first, originalInput };
}

test("家长缩小范围必须等新一轮同范围独立迁移，孩子重新同意原记录才替换", () => {
  const f = fixture();
  try {
    const narrowed = f.ledger.parentPort().narrowScope("kid", f.record.recordId, { toSurfaceContextKey: "one" });
    expect(narrowed.needsReassent).toBe(true);
    expect(f.ledger.sessionPort().activeModel("kid", "fake")).toEqual([]);
    expect(f.ledger.parentPort().candidates("kid").find(c => c.candidateId === narrowed.candidateId)?.status).toBe("awaiting_reassent");
    expect(f.db.prepare("SELECT voided_reason FROM child_assents WHERE preview_nonce='old'").get()?.voided_reason).toBe("parent_narrowed_scope");
    expect(f.db.prepare("SELECT reason_code FROM ledger_audit WHERE subject_id=?").get(f.record.recordId)?.reason_code).toBe("record_scope_narrowed");
    expect(f.session.nextCandidateToAsk("kid", "fake", { ...f.first.snapshot, takenAt: 101 })).toBeNull();
    const outside = f.ingest(2, "outside");
    expect(f.session.nextCandidateToAsk("kid", "fake", outside.snapshot)).toBeNull();
    const hinted = f.ingest(3, "one", true);
    expect(f.session.nextCandidateToAsk("kid", "fake", hinted.snapshot)).toBeNull();
    const next = f.ingest(4);
    const queued = f.session.nextCandidateToAsk("kid", "fake", next.snapshot)!;
    expect(queued.candidateId).toBe(narrowed.candidateId);
    expect(queued.scope.surfaceContextKeys).toEqual(["one"]);
    const newInput = f.assent(queued.candidateId, next.snapshot, "new");
    const shown = f.ledger.parentPort().candidates("kid").find(c => c.candidateId === queued.candidateId)!;
    f.session.nextCandidateToAsk("kid", "fake", { ...newInput.snapshot, state: "TRANSFER", previewNonce: null });
    expect(f.ledger.parentPort().candidates("kid").find(c => c.candidateId === queued.candidateId)).toEqual(shown);
    expect(f.ledger.assentPort().recordAssent(newInput).outcome.committed).toBe(true);
    const records = f.ledger.childPort().records("kid");
    expect(records).toHaveLength(1);
    expect(records[0]?.recordId).toBe(f.record.recordId);
    expect(records[0]?.scope.surfaceContextKeys).toEqual(["one"]);
    expect(f.session.activeModel("kid", "fake")).toHaveLength(1);
    f.ledger.assentPort().recordAssent({ ...f.originalInput, choice: "disagree" });
    expect(f.ledger.childPort().records("kid")).toEqual(records);
  } finally { f.db.close(); }
});

test("重新同意替换当前引用后，删除旧作品仍清除历史决策文本", () => {
  const marker = "prior-assent-canary-7a42";
  const f = fixture(marker);
  try {
    f.session.ingestArtifactVersion({ learnerId: "kid", artifactId: "old-artifact", artifactVersionId: "old-version", sessionId: f.first.run.sessionId,
      discipline: "fake", versionNo: 1, writer: "host_snapshot", contentRef: "session:old", contentHash: "hash", payload: {} });
    f.db.prepare("INSERT INTO run_artifacts VALUES (?,?)").run(f.first.run.runId, "old-version");
    const narrowed = f.ledger.parentPort().narrowScope("kid", f.record.recordId, { toSurfaceContextKey: "one" });
    const next = f.ingest(2);
    expect(f.session.nextCandidateToAsk("kid", "fake", next.snapshot)?.candidateId).toBe(narrowed.candidateId);
    expect(f.ledger.assentPort().recordAssent(f.assent(narrowed.candidateId, next.snapshot, "new")).outcome.committed).toBe(true);
    const scan = () => f.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().flatMap(row => f.db.prepare(`SELECT * FROM "${String(row.name)}"`).all()).filter(row => JSON.stringify(row).includes(marker));
    expect(scan().length).toBeGreaterThan(0);
    const subject = { kind: "artifact" as const, id: "old-artifact" };
    const { preview } = f.ledger.parentPort().deletionPreview("kid", subject);
    f.ledger.parentPort().executeDeletion("kid", subject, preview);
    expect(scan()).toEqual([]);
    expect(f.ledger.childPort().records("kid")[0]?.status).toBe("confirmed");
  } finally { f.db.close(); }
});

test("家长普通降级和撤回不创建新记录，导出包含已有档案，范围只能真正缩小", () => {
  const f = fixture();
  try {
    const parent = f.ledger.parentPort();
    expect(() => parent.narrowScope("kid", f.record.recordId, { toSurfaceContextKey: "outside" })).toThrow("parent.scopeNotNarrower");
    expect(() => parent.narrowScope("kid", f.record.recordId, { toBandIndex: 9, toSurfaceContextKey: "one" })).toThrow("parent.scopeNotSubset");
    parent.downgrade("kid", f.record.recordId);
    expect(parent.records("kid")).toHaveLength(1);
    expect(f.session.activeModel("kid", "fake")).toEqual([]);
    parent.retract("kid", f.record.recordId);
    expect(parent.records("kid")).toHaveLength(1);
    expect(f.db.prepare("SELECT reason_code FROM ledger_audit ORDER BY rowid").all().map(row => row.reason_code)).toEqual(["record_downgraded", "record_retracted"]);
    const archive = parent.exportArchive("kid") as { records: unknown[]; runs: unknown[]; decisions: unknown[] };
    expect(archive.records).toHaveLength(1);
    expect(archive.runs).toHaveLength(1);
    expect(archive.decisions.length).toBeGreaterThan(0);
    expect(parent.exportArchive("other")).toMatchObject({ records: [] });
  } finally { f.db.close(); }
});

test.each(["downgrade", "retract"] as const)("%s 取消尚待孩子重新同意的收窄候选", action => {
  const f = fixture();
  try {
    const parent = f.ledger.parentPort();
    const narrowed = parent.narrowScope("kid", f.record.recordId, { toSurfaceContextKey: "one" });
    parent[action]("kid", f.record.recordId);
    const next = f.ingest(2);
    expect(f.session.nextCandidateToAsk("kid", "fake", next.snapshot)).toBeNull();
    expect(parent.candidates("kid").find(c => c.candidateId === narrowed.candidateId)?.status).toBe("held");
    expect(f.session.activeModel("kid", "fake")).toEqual([]);
  } finally { f.db.close(); }
});

test.each(["contested", "trend"])("%s 记录禁止所有家长纠正", kind => {
  const f = fixture();
  try {
    // 直接设置拒绝分支状态；允许路径的记录均由真实孩子同意生成。
    if (kind === "contested") f.db.prepare("UPDATE growth_records SET status='contested' WHERE record_id=?").run(f.record.recordId);
    else f.db.prepare("UPDATE growth_records SET tier=3,trend_ref_json=? WHERE record_id=?").run(JSON.stringify({ windowRunIds: [f.first.run.runId], verdict: "insufficient" }), f.record.recordId);
    const parent = f.ledger.parentPort();
    const before = parent.records("kid");
    for (const correction of [() => parent.narrowScope("kid", f.record.recordId, { toSurfaceContextKey: "one" }),
      () => parent.downgrade("kid", f.record.recordId), () => parent.retract("kid", f.record.recordId)]) {
      expect(correction).toThrow(kind === "contested" ? "parent.cannotCorrectContested" : "parent.cannotCorrectTrend");
    }
    expect(parent.records("kid")).toEqual(before);
  } finally { f.db.close(); }
});
