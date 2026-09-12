import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { mathPlugin } from "../../../plugin-math/src/index.js";
import { openLearningDatabase, type LearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { SessionOrchestrator } from "../../src/orchestrator.js";
import { SqliteSessionStore } from "../../src/sqlite-store.js";
import { ScriptedReplayBridge } from "../../src/bridges/scripted-replay-bridge.js";

const canary = "deletion-canary-3c2a938d";
const canaryObject = { id: "agent-note", owner: "agent" as const, kind: "label", props: { text: canary } };
function hits(db: LearningDatabase): string[] {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().flatMap(row => {
    const name = String(row.name);
    return db.prepare(`SELECT * FROM "${name}"`).all().filter(value => JSON.stringify(value).includes(canary)).map(() => name);
  });
}
async function fixture(db: LearningDatabase) {
  let now = 10, seq = 0;
  const ledger = GrowthLedgerService.open({ db, clock: () => now });
  ledger.childPort().acknowledgeFirstUse("kid");
  const store = new SqliteSessionStore(db);
  const deps = { sessionId: "delete-test", learnerId: "kid", plugin: mathPlugin, store,
    bridge: new ScriptedReplayBridge({ scriptVersion: 1, turns: [] }), ledger: ledger.sessionPort(), assent: ledger.assentPort(),
    clock: () => now, challengeInput: { curriculumAnchor: "人教版五年级上册" } };
  const orch = new SessionOrchestrator(deps);
  const send = (payload: EvidenceEvent["payload"]) => {
    now++; seq++;
    return orch.handleEvent({ eventId: `delete-e-${seq}`, clientSessionId: deps.sessionId, deviceId: "ipad", clientSeq: seq,
      occurredAt: now, quality: "confirmed", source: "child_button", semanticObjectIds: [], payload });
  };
  await orch.start();
  await send({ type: "UTTERANCE", text: `应该比2.4小，因为是取十分之三 ${canary}` });
  await send({ type: "ANSWER", text: "0.72" });
  await send({ type: "DONE" });
  await send({ type: "EXPLAIN", text: "因为0.3是十分之三，所以比2.4小" });
  const output = await send({ type: "ANSWER", text: "1.4" });
  const preview = output.outbound.find(row => row.type === "memoryPreview");
  if (preview?.type !== "memoryPreview") throw new Error("previewMissing");
  await send({ type: "MEMORY_ASSENT", candidateId: preview.candidateId, previewNonce: preview.previewNonce, choice: "record" });
  expect(ledger.childPort().records("kid")).toHaveLength(1);
  // 模拟先前显示过的复述，同时在每个会话副本中放入可检测文本。
  const snapshot = store.latestSnapshot(deps.sessionId)!;
  snapshot.snapshotSeq++;
  snapshot.runtime!.lastSpoken = canary;
  snapshot.runtime!.lastLearnerTask = canary;
  snapshot.runtime!.agentObjects = [canaryObject];
  store.saveSnapshot(deps.sessionId, snapshot);
  store.saveOutbound(deps.sessionId, "delete-e-1", [{ type: "speak", id: "canary-output", text: canary, hintLevel: 0, interruptible: true }, { type: "canvasAction", id: "canary-canvas", action: { kind: "upsertObject", object: canaryObject } }]);
  store.saveProposal(deps.sessionId, { proposalId: "canary-proposal", accepted: true, reasons: [], decidedAt: now,
    runId: snapshot.runtime!.runRecorder!.run!.runId,
    proposal: { proposalId: "canary-proposal", spokenResponse: canary, learnerTask: canary, hintLevel: 0, canvasActions: [{ kind: "upsertObject", object: canaryObject }], expectedEvidence: [] } });
  const artifactId = String(db.prepare("SELECT artifact_id FROM artifacts").get()!.artifact_id);
  return { ledger, orch, deps, subject: { kind: "artifact" as const, id: artifactId }, setNow: (value: number) => { now = value; } };
}

test("删除前金丝雀阳性；原子级联后全库零命中、重启不恢复、磁盘无残留", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scholar-delete-"));
  const path = join(dir, "ledger.sqlite");
  const db = openLearningDatabase(path);
  try {
    const { ledger, deps, subject, orch } = await fixture(db);
    expect(hits(db)).toContain("events");
    expect(hits(db)).toContain("snapshots");
    expect(hits(db)).toContain("outbound");
    expect(hits(db)).toContain("proposals");
    const { preview } = ledger.parentPort().deletionPreview("kid", subject);
    expect(preview.invalidatedRecordIds).toBe(1);
    expect(preview.removeScaffoldPointIds).toBe(1);
    const result = ledger.parentPort().executeDeletion("kid", subject, preview);
    orch.snapshotNow(); // 旧内存里的内容不能覆盖脱敏后的快照。
    expect(hits(db)).toEqual([]);
    expect(ledger.childPort().records("kid")[0]?.status).toBe("evidence_removed");
    expect(ledger.sessionPort().activeModel("kid", "math")).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM trend_gaps").get()?.n).toBe(1);
    expect(JSON.stringify(SessionOrchestrator.restore(deps)!.viewSnapshot())).not.toContain(canary);
    expect(ledger.parentPort().executeDeletion("kid", subject, preview)).toEqual(result);
    expect(readFileSync(path).includes(Buffer.from(canary))).toBe(false);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("通知写入失败也回滚物理删除；不是先删成功再补请求状态", async () => {
  const db = openLearningDatabase(":memory:");
  try {
    const { ledger, subject } = await fixture(db);
    const request = ledger.childPort().requestDeletion("kid", subject);
    db.exec("CREATE TRIGGER fail_notify BEFORE INSERT ON child_notifications BEGIN SELECT RAISE(ABORT, 'notificationFailure'); END");
    expect(() => ledger.parentPort().resolveDeletion("kid", request.requestId, "approved")).toThrow("notificationFailure");
    expect(hits(db)).toContain("events");
    expect(db.prepare("SELECT count(*) AS n FROM artifact_versions").get()?.n).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM ledger_audit").get()?.n).toBe(0);
  } finally { db.close(); }
});

test("记录级删除保留作品与原事件；重叠申请撤回不能解除另一个申请的停用", async () => {
  const db = openLearningDatabase(":memory:");
  try {
    const { ledger, subject } = await fixture(db);
    const record = ledger.childPort().records("kid")[0]!;
    const recordSubject = { kind: "growth_record" as const, id: record.recordId };
    ledger.childPort().requestDeletion("kid", subject);
    const request = ledger.childPort().requestDeletion("kid", recordSubject);
    ledger.childPort().withdrawDeletion("kid", request.requestId);
    expect(ledger.childPort().records("kid")[0]?.suppressedReason).toBe("deletionRequested");
    const { preview } = ledger.parentPort().deletionPreview("kid", recordSubject);
    ledger.parentPort().executeDeletion("kid", recordSubject, preview);
    expect(db.prepare("SELECT count(*) AS n FROM artifact_versions").get()?.n).toBe(1);
    expect(hits(db)).toContain("events");
    expect(ledger.childPort().records("kid")[0]?.status).toBe("evidence_removed");
  } finally { db.close(); }
});

test("超过保留期的未被记录引用原话及历史快照一起脱敏，被引用证据不删", async () => {
  const db = openLearningDatabase(":memory:");
  try {
    const { ledger } = await fixture(db);
    // 原话参与哪条链接由插件确定，明确去掉记录对第一条话的引用而不改原话。
    const first = new Set(db.prepare("SELECT link_id FROM claim_evidence_links WHERE event_id='delete-e-1'").all().map(row => String(row.link_id)));
    const record = ledger.childPort().records("kid")[0]!;
    db.prepare("UPDATE growth_records SET evidence_link_ids_json=? WHERE record_id=?").run(JSON.stringify(record.evidenceLinkIds.filter(id => !first.has(id))), record.recordId);
    expect(hits(db)).toContain("events");
    ledger.sweepRetention(31 * 86400000);
    expect(db.prepare("SELECT redacted FROM events WHERE event_id='delete-e-1'").get()?.redacted).toBe(1);
    expect(hits(db)).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM events WHERE redacted=0 AND event_id IN (SELECT event_id FROM claim_evidence_links)").get()!.n).toBeGreaterThan(0);
  } finally { db.close(); }
});

test("被记录引用的事件保留，不代表它所触发的到期提案出站副本永久保留", async () => {
  const db = openLearningDatabase(":memory:");
  try {
    const { ledger, deps } = await fixture(db);
    const snapshot = deps.store.latestSnapshot(deps.sessionId)!;
    snapshot.snapshotSeq++; snapshot.createdAt = 30 * 86400000;
    deps.store.saveSnapshot(deps.sessionId, snapshot);
    expect(db.prepare("SELECT messages_json FROM outbound WHERE event_id='delete-e-1'").get()!.messages_json).toContain(canary);
    ledger.sweepRetention(31 * 86400000);
    expect(db.prepare("SELECT event_json FROM events WHERE event_id='delete-e-1'").get()!.event_json).toContain(canary);
    expect(db.prepare("SELECT messages_json FROM outbound WHERE event_id='delete-e-1'").get()!.messages_json).not.toContain(canary);
    expect(JSON.stringify(SessionOrchestrator.restore(deps)!.viewSnapshot())).not.toContain(canary);
  } finally { db.close(); }
});

test("级联中途失败整体回滚，包括事件脱敏与请求状态", async () => {
  const db = openLearningDatabase(":memory:");
  try {
    const { ledger, subject } = await fixture(db);
    const request = ledger.childPort().requestDeletion("kid", subject);
    db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON scaffold_points BEGIN SELECT RAISE(ABORT, 'testFailure'); END");
    expect(() => ledger.parentPort().resolveDeletion("kid", request.requestId, "approved")).toThrow("testFailure");
    expect(hits(db)).toContain("events");
    expect(ledger.childPort().deletionRequests("kid")[0]?.status).toBe("pending");
    expect(db.prepare("SELECT count(*) AS n FROM ledger_audit").get()?.n).toBe(0);
  } finally { db.close(); }
});

test("请求立即停用；拒绝不解禁；再次申请升级；七天只告警；批准原子通知", async () => {
  const db = openLearningDatabase(":memory:");
  try {
    const { ledger, subject, setNow } = await fixture(db);
    const request = ledger.childPort().requestDeletion("kid", subject);
    expect(ledger.childPort().requestDeletion("kid", subject).requestId).toBe(request.requestId);
    expect(ledger.childPort().records("kid")[0]?.suppressedReason).toBe("deletionRequested");
    ledger.parentPort().resolveDeletion("kid", request.requestId, "rejected");
    expect(ledger.childPort().records("kid")[0]?.suppressedReason).toBe("deletionRequested");
    const again = ledger.childPort().requestDeletion("kid", subject);
    expect(ledger.childPort().deletionRequests("kid").find(row => row.requestId === again.requestId)?.escalated).toBe(true);
    setNow(8 * 86400000);
    ledger.sweepRetention(8 * 86400000);
    expect(ledger.parentPort().alerts("kid").some(row => row.kind === "deletionSlaBreached")).toBe(true);
    expect(hits(db)).toContain("events");
    ledger.parentPort().resolveDeletion("kid", again.requestId, "approved");
    expect(ledger.childPort().deletionRequests("kid").find(row => row.requestId === again.requestId)?.status).toBe("approved");
    expect(ledger.childPort().notifications("kid").some(row => row.text.includes("删除"))).toBe(true);
    expect(hits(db)).toEqual([]);
  } finally { db.close(); }
});
