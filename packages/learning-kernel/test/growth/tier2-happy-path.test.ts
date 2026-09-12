import { expect, test } from "vitest";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { mathPlugin } from "../../../plugin-math/src/index.js";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { SessionOrchestrator } from "../../src/orchestrator.js";
import { SqliteSessionStore } from "../../src/sqlite-store.js";
import { ScriptedReplayBridge } from "../../src/bridges/scripted-replay-bridge.js";

test("真实插件独立主路径：预览、重启恢复、同意后只落一条档2", async () => {
  const db = openLearningDatabase(":memory:");
  let now = 10;
  const ledger = GrowthLedgerService.open({ db, clock: () => now });
  try {
    ledger.childPort().acknowledgeFirstUse("kid");
    const deps = { sessionId: "real", learnerId: "kid", plugin: mathPlugin,
      store: new SqliteSessionStore(db), bridge: new ScriptedReplayBridge({ scriptVersion: 1, turns: [] }),
      ledger: ledger.sessionPort(), assent: ledger.assentPort(), clock: () => now,
      challengeInput: { curriculumAnchor: "人教版五年级上册" } };
    let orch = new SessionOrchestrator(deps);
    let seq = 0;
    const send = (payload: EvidenceEvent["payload"]) => {
      now += 1; seq += 1;
      return orch.handleEvent({ eventId: `e-${seq}`, clientSessionId: "real", deviceId: "ipad", clientSeq: seq,
        occurredAt: now, quality: "confirmed", source: "child_button", semanticObjectIds: [], payload });
    };
    await orch.start();
    await send({ type: "UTTERANCE", text: "应该比2.4小，因为是取十分之三" });
    await send({ type: "ANSWER", text: "0.72" });
    await send({ type: "DONE" });
    await send({ type: "EXPLAIN", text: "因为 0.3 是十分之三，乘完只剩十分之三那么多，所以比 2.4 小" });
    expect(orch.context.state).toBe("TRANSFER");
    const output = await send({ type: "ANSWER", text: "1.4" });
    const preview = output.outbound.find(message => message.type === "memoryPreview");
    expect(preview?.type).toBe("memoryPreview");
    if (preview?.type !== "memoryPreview") throw new Error("没有预览");
    expect(ledger.childPort().records("kid")).toHaveLength(0);
    orch = SessionOrchestrator.restore(deps)!;
    const restored = orch.viewSnapshot().find(message => message.type === "memoryPreview");
    expect(restored).toMatchObject({ previewNonce: preview.previewNonce });
    await send({ type: "MEMORY_ASSENT", candidateId: preview.candidateId, previewNonce: preview.previewNonce, choice: "record" });
    expect(orch.context.state).toBe("COMPLETED");
    expect(ledger.childPort().records("kid")).toHaveLength(1);
    expect(ledger.childPort().records("kid")[0]).toMatchObject({ tier: 2, hypothesisKeys: [] });
  } finally { db.close(); }
});
