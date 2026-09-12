import { expect, test } from "vitest";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { SessionOrchestrator } from "../../src/orchestrator.js";
import { SqliteSessionStore } from "../../src/sqlite-store.js";
import { ScriptedReplayBridge, type ReplayScript } from "../../src/bridges/scripted-replay-bridge.js";
import { fakePlugin } from "../helpers/fake-plugin.js";

async function setup(acknowledged = true, turns: ReplayScript["turns"] = []) {
  const db = openLearningDatabase(":memory:");
  let now = 10, seq = 0;
  const ledger = GrowthLedgerService.open({ db, clock: () => now });
  if (acknowledged) ledger.childPort().acknowledgeFirstUse("kid");
  const deps = { sessionId: "s", learnerId: "kid", plugin: fakePlugin, store: new SqliteSessionStore(db),
    bridge: new ScriptedReplayBridge({ scriptVersion: 1, turns }),
    ledger: ledger.sessionPort(), assent: ledger.assentPort(), clock: () => now, challengeInput: { curriculumAnchor: "test" } };
  const orch = new SessionOrchestrator(deps);
  const send = async (payload: EvidenceEvent["payload"], quality: EvidenceEvent["quality"] = "confirmed") => {
    now++; seq++;
    return orch.handleEvent({ eventId: `e${seq}`, clientSessionId: "s", deviceId: "d", clientSeq: seq, occurredAt: now,
      source: "child_button", quality, semanticObjectIds: [], payload });
  };
  await orch.start();
  const finish = async () => {
    await send({ type: "ANSWER", text: "42" });
    await send({ type: "DONE" });
    await send({ type: "EXPLAIN", text: "因为两边一样" });
    const result = await send({ type: "ANSWER", text: "42" });
    return result.outbound.find(message => message.type === "memoryPreview");
  };
  return { db, ledger, orch, deps, send, finish };
}

test("未告知时不展示候选，预检失败仍有审计", async () => {
  const h = await setup(false);
  try {
    expect(await h.finish()).toBeUndefined();
    expect(h.orch.context.state).toBe("COMPLETED");
    expect(h.db.prepare("SELECT failures_json FROM memory_decisions").get()?.failures_json).toContain("shared.firstUseAcknowledged");
    expect(h.ledger.childPort().records("kid")).toEqual([]);
  } finally { h.db.close(); }
});

test("停车期间点击旧卡不写记录，也不给孩子假成功通知", async () => {
  const h = await setup();
  try {
    const preview = (await h.finish())!;
    await h.send({ type: "UTTERANCE", text: "等一下" }, "unconfirmed");
    expect(h.orch.context.state).toBe("WAITING_CONFIRMATION");
    const result = await h.send({ type: "MEMORY_ASSENT", candidateId: preview.candidateId, previewNonce: preview.previewNonce, choice: "record" });
    expect(h.ledger.childPort().records("kid")).toHaveLength(0);
    expect(h.db.prepare("SELECT count(*) AS n FROM memory_decisions WHERE committed=1").get()?.n).toBe(0);
    expect(result.outbound.some(message => message.type === "memoryDismissed")).toBe(false);
    expect(h.db.prepare("SELECT count(*) AS n FROM child_assents").get()?.n).toBe(0);
    await h.send({ type: "CONFIRM_TRANSCRIPT", targetEventId: "e5", confirmed: false });
    expect(h.orch.viewSnapshot()).toEqual(expect.arrayContaining([expect.objectContaining({ type: "memoryPreview", previewNonce: preview.previewNonce })]));
    await h.send({ type: "MEMORY_ASSENT", candidateId: preview.candidateId, previewNonce: preview.previewNonce, choice: "record" });
    expect(h.ledger.childPort().records("kid")).toHaveLength(1);
  } finally { h.db.close(); }
});

test("错误nonce不产生账本行，并重新呈现原nonce", async () => {
  const h = await setup();
  try {
    const preview = (await h.finish())!;
    const before = h.db.prepare("SELECT count(*) AS n FROM memory_decisions").get()?.n;
    const result = await h.send({ type: "MEMORY_ASSENT", candidateId: preview.candidateId, previewNonce: "wrong", choice: "record" });
    expect(h.db.prepare("SELECT count(*) AS n FROM memory_decisions").get()?.n).toBe(before);
    expect(h.db.prepare("SELECT count(*) AS n FROM child_assents").get()?.n).toBe(0);
    expect(result.outbound).toEqual(expect.arrayContaining([expect.objectContaining({ type: "memoryPreview", previewNonce: preview.previewNonce })]));
  } finally { h.db.close(); }
});

test.each(["unsure", "disagree"] as const)("孩子选%s不写记录，保留对应决定", async choice => {
  const h = await setup();
  try {
    const preview = (await h.finish())!;
    await h.send({ type: "MEMORY_ASSENT", candidateId: preview.candidateId, previewNonce: preview.previewNonce, choice });
    expect(h.ledger.childPort().records("kid")).toEqual([]);
    expect(h.db.prepare("SELECT choice FROM child_assents").get()?.choice).toBe(choice);
    expect(h.orch.context.state).toBe(choice === "unsure" ? "COMPLETED" : "CONTESTED");
  } finally { h.db.close(); }
});

test("外部异议使已展示候选门禁失效，孩子可直接收尾", async () => {
  const h = await setup();
  try {
    const preview = (await h.finish())!;
    h.ledger.childPort().contest({ learnerId: "kid", target: preview.contestTarget, sessionId: "s", runId: null, eventId: "outside" });
    await h.send({ type: "MEMORY_ASSENT", candidateId: preview.candidateId, previewNonce: preview.previewNonce, choice: "record" });
    expect(h.orch.context.state).toBe("COMPLETED");
    expect(h.orch.context.policyErrors.at(-1)?.code).toBe("guardFailed");
    expect(h.ledger.childPort().records("kid")).toHaveLength(0);
  } finally { h.db.close(); }
});

test("全轮事件含纯语音均有服务端作品版本归属", async () => {
  const h = await setup();
  try {
    await h.send({ type: "UTTERANCE", text: "我想先画一画" });
    await h.finish();
    const rows = h.db.prepare("SELECT e.event_id,av.artifact_version_id FROM events e LEFT JOIN artifact_versions av ON av.artifact_version_id=e.artifact_version_id").all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.artifact_version_id !== null)).toBe(true);
  } finally { h.db.close(); }
});

test("来源A被拒不能静默换成自建，拒绝审计不含模型原句", async () => {
  const proposal = { proposalId: "p1", spokenResponse: "你已经知道什么？", learnerTask: "说说你知道的", hintLevel: 1,
    canvasActions: [], expectedEvidence: [], memoryCandidate: { description: "ZZQQ-REJECTED-CLAIM-782", evidenceEventIds: [] } };
  const h = await setup(true, [{ purpose: "hint", proposal }, { purpose: "hint", proposal: { ...proposal, proposalId: "p2", memoryCandidate: undefined } }]);
  try {
    await h.send({ type: "HELP_REQUEST" });
    expect(await h.finish()).toBeUndefined();
    expect(h.db.prepare("SELECT failures_json FROM memory_decisions").get()?.failures_json).toContain("shared.sourceAligned");
    for (const name of ["proposals", "snapshots", "memory_candidates", "memory_decisions", "growth_records"]) {
      expect(JSON.stringify(h.db.prepare(`SELECT * FROM ${name}`).all())).not.toContain("ZZQQ-REJECTED-CLAIM-782");
    }
  } finally { h.db.close(); }
});

test("辅助轮拒绝仍落完整门禁决策而不询问孩子", async () => {
  const h = await setup();
  try {
    h.orch.context.assistedRound = true;
    await h.send({ type: "ANSWER", text: "42" });
    expect(await h.finish()).toBeUndefined();
    expect(h.db.prepare("SELECT failures_json FROM memory_decisions").get()?.failures_json).toContain("shared.notAssistedRound");
    expect(h.db.prepare("SELECT count(*) AS n FROM memory_candidates").get()?.n).toBe(0);
  } finally { h.db.close(); }
});
