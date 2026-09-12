import { expect, test } from "vitest";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { SessionOrchestrator } from "../../src/orchestrator.js";
import { InMemorySessionStore } from "../../src/store.js";
import { ScriptedReplayBridge } from "../../src/bridges/scripted-replay-bridge.js";
import { fakePlugin } from "../helpers/fake-plugin.js";

test("三个诊断问句不升级提示，重启后的未回答探针不会重复发", async () => {
  const store = new InMemorySessionStore();
  const plugin = { ...fakePlugin, interpretEvent: (challenge: Parameters<typeof fakePlugin.interpretEvent>[0], event: EvidenceEvent) =>
    event.payload.type === "ANSWER" ? [{ evidenceId: event.eventId, eventId: event.eventId, kind: "wrong_answer", summary: "待区分",
      hypothesisSupport: [{ hypothesisId: "h1", direction: "supports" as const }, { hypothesisId: "h2", direction: "supports" as const }],
      surfaceContextKey: challenge.surfaceContextKey, selfCorrection: false }] : [] };
  const deps = { sessionId: "probe", plugin, store, bridge: new ScriptedReplayBridge({ scriptVersion: 1, turns: [] }),
    clock: () => 100, challengeInput: { curriculumAnchor: "test" } };
  let orch = new SessionOrchestrator(deps), seq = 0;
  const send = (payload: EvidenceEvent["payload"]) => orch.handleEvent({ eventId: `e${++seq}`, clientSessionId: "probe", deviceId: "d", clientSeq: seq,
    occurredAt: 100, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload });
  await orch.start();
  await send({ type: "ANSWER", text: "41" });
  const first = await send({ type: "HELP_REQUEST" });
  expect(first.outbound.find(message => message.type === "speak")).toMatchObject({ hintLevel: 0 });
  orch.snapshotNow();
  orch = SessionOrchestrator.restore(deps)!;
  expect((await send({ type: "HELP_REQUEST" })).outbound.filter(message => message.type === "speak")).toEqual([]);
  await send({ type: "UTTERANCE", text: "还没想好" });
  await send({ type: "UTTERANCE", text: "还没想好" });
  orch.snapshotNow();
  expect(store.latestSnapshot("probe")?.runtime?.runRecorder?.run).toMatchObject({ probesIssued: 3, escalationCount: 0, maxHintLevelUsed: 0, assistedRound: false });
  expect(orch.context.state).toBe("ASSESSING");
});
