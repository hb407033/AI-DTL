import { expect, test } from "vitest";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { mathPlugin } from "../../../plugin-math/src/decimal-multiplication.js";
import { SessionOrchestrator } from "../../src/orchestrator.js";
import { SqliteSessionStore } from "../../src/sqlite-store.js";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { ScriptedReplayBridge } from "../../src/bridges/scripted-replay-bridge.js";

test.each([true, false])("真实插件：孩子主动要求新验证，完成新证据后异议才解除（旧假设=%s）", async hasHypothesis => {
  const db = openLearningDatabase(":memory:");
  let now = 10, seq = 0;
  const ledger = GrowthLedgerService.open({ db, clock: () => now });
  const deps = { sessionId: "verify", learnerId: "kid", plugin: mathPlugin, store: new SqliteSessionStore(db),
    bridge: new ScriptedReplayBridge({ scriptVersion: 1, turns: [] }), ledger: ledger.sessionPort(),
    clock: () => now, challengeInput: { curriculumAnchor: "人教版五上/小数乘法" } };
  let orch = new SessionOrchestrator(deps);
  const send = (payload: EvidenceEvent["payload"]) => orch.handleEvent({ eventId: `e${++seq}`, clientSessionId: "verify", deviceId: "d", clientSeq: seq,
    occurredAt: ++now, quality: "confirmed", source: "child_button", semanticObjectIds: [], payload });
  try {
    const initialTask = (await orch.start()).find(m => m.type === "learnerTask");
    await send({ type: "ANSWER", text: hasHypothesis ? "7.2" : "我先画一下" });
    orch.snapshotNow();
    orch = SessionOrchestrator.restore(deps)!;
    expect(orch.viewSnapshot().find(m => m.type === "learnerTask")?.contestTarget).toEqual(initialTask?.contestTarget);
    const contested = await send({ type: "CONTEST", target: hasHypothesis ? { kind: "hypothesis", id: "intuition_gap" } : { kind: "session", id: "verify" } });
    expect(orch.context.state).toBe("CONTESTED");
    expect(contested.outbound.some(m => m.type === "learnerTask")).toBe(false);
    const contestSpeech = contested.outbound.find(m => m.type === "speak");
    orch.snapshotNow();
    expect(deps.store.latestSnapshot("verify")?.runtime).toMatchObject({ lastTaskContestTarget: initialTask?.contestTarget, lastSpeakContestTarget: contestSpeech?.contestTarget });
    orch = SessionOrchestrator.restore(deps)!;
    expect(orch.viewSnapshot().find(m => m.type === "speak")?.contestTarget).toEqual(contestSpeech?.contestTarget);
    await send({ type: "UTTERANCE", text: "会变小" });
    expect(db.prepare("SELECT resolved_at FROM contests").get()?.resolved_at).toBeNull();
    await send({ type: "HELP_REQUEST" });
    expect(orch.context.state).toBe("INDEPENDENT");
    expect(orch.challenge).toMatchObject({ probeId: "magnitude-first", surfaceContextKey: "4.2x0.6" });
    orch.snapshotNow();
    orch = SessionOrchestrator.restore(deps)!;
    expect(orch.viewSnapshot().find(m => m.type === "learnerTask")).toHaveProperty("contestTarget");
    await send({ type: "UTTERANCE", text: "会变小" });
    expect(db.prepare("SELECT resolved_at FROM contests").get()?.resolved_at).toBeNull();
    await send({ type: "UTTERANCE", text: "十分之六" });
    await send({ type: "ANSWER", text: "2.52" });
    await send({ type: "EXPLAIN", text: "因为只有十分之六，所以会变小" });
    await send({ type: "ANSWER", text: "1.4" });
    expect(db.prepare("SELECT resolved_at FROM contests").get()?.resolved_at).not.toBeNull();
    if (hasHypothesis) expect(db.prepare("SELECT status FROM hypotheses WHERE hypothesis_key='intuition_gap'").get()?.status).toBe("suspected");
  } finally { db.close(); }
});
