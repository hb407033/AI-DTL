import { expect, it } from "vitest";
import { eventPayloadSchema } from "@ai-scholar/session-contracts";
import { planRetentionPrune, redactEventPayload, redactProposalForStorage, redactSnapshot } from "../../src/growth/retention.js";
import type { ProposalRecord } from "../../src/store.js";
import { InMemorySessionStore } from "../../src/store.js";
import { SessionOrchestrator } from "../../src/orchestrator.js";
import { ScriptedReplayBridge } from "../../src/bridges/scripted-replay-bridge.js";
import { fakePlugin } from "../helpers/fake-plugin.js";

it("prunes only old unreferenced events and unredacted old proposals", () => {
  const now = 31 * 86400000;
  expect(planRetentionPrune({ now, referencedEventIds: new Set(["kept"]), events: [
    { eventId: "old", receivedAt: 0, redacted: false }, { eventId: "kept", receivedAt: 0, redacted: false },
    { eventId: "recent", receivedAt: now, redacted: false }, { eventId: "done", receivedAt: 0, redacted: true },
  ], proposals: [{ proposalId: "p", decidedAt: 0, accepted: true, redacted: false }] })).toEqual({ redactEventIds: ["old"], redactProposalIds: ["p"] });
});

it("scrubs nested snapshot teaching content while preserving restore and idempotence", async () => {
  const store = new InMemorySessionStore();
  const deps = { sessionId: "s", store, plugin: fakePlugin, bridge: new ScriptedReplayBridge({ scriptVersion: 1, turns: [] }), clock: () => 1, challengeInput: { curriculumAnchor: "fake/unit-1" } };
  const orch = new SessionOrchestrator(deps);
  await orch.start();
  const snapshot = store.latestSnapshot("s")!;
  snapshot.challenge.learnerPrompt = "secret";
  snapshot.challenge.hintLadder[2].spokenResponse = "secret";
  snapshot.evidence = [{ evidenceId: "e", eventId: "event", kind: "utterance", summary: "secret", hypothesisSupport: [], surfaceContextKey: "surface", selfCorrection: false }];
  snapshot.runtime!.lastSpoken = "secret";
  snapshot.runtime!.agentObjects = [{ id: "o", owner: "agent", kind: "label", props: { text: "secret" } }];
  snapshot.runtime!.runRecorder!.run!.childFacingGoalPhrase = "secret";
  snapshot.context.state = "PAUSED_CHILD"; snapshot.context.priorState = "MEMORY_PENDING";
  snapshot.runtime!.memoryPreview = { candidateId: "candidate", nonce: "nonce", tier: 2, childFacingText: "secret", evidenceSummaryText: "secret", contestTarget: { kind: "candidate", id: "candidate" }, shownAt: 1 };
  const safe = redactSnapshot(snapshot);
  expect(JSON.stringify(safe)).not.toContain("secret");
  expect(snapshot.runtime!.lastSpoken).toBe("secret");
  expect(redactSnapshot(safe)).toEqual(safe);
  expect(safe.context).toMatchObject({ state: "COMPLETED", priorState: null });
  expect(safe.runtime!.memoryPreview).toBeUndefined();
  expect(safe.challenge.learnerPrompt).toBe("（已删除）");
  store.saveSnapshot("s", safe);
  const restored = SessionOrchestrator.restore(deps)!;
  expect(restored).not.toBeNull();
  expect(restored.evidence[0]!.summary).toBe("");
  expect(JSON.stringify(restored.viewSnapshot())).not.toContain("secret");
});
it("event redaction is parseable, immutable and preserves dedupe metadata", () => {
  const stroke = { type: "STROKE" as const, strokeId: "x", contentHash: "hash", bounds: { x: 1, y: 2, width: 3, height: 4 } };
  expect(redactEventPayload(stroke)).toEqual(stroke);
  const redacted = redactEventPayload({ type: "CONFIRM_TRANSCRIPT", targetEventId: "e", confirmed: true, correctedText: "secret" });
  expect(eventPayloadSchema.parse(redacted)).toEqual({ type: "CONFIRM_TRANSCRIPT", targetEventId: "e", confirmed: true, correctedText: "" });
  expect(redactEventPayload(redacted)).toEqual(redacted);
});
it("proposal redaction removes all free teaching text and model memory", () => {
  const record = { proposalId: "p", accepted: false, reasons: ["rule"], decidedAt: 1,
    proposal: { spokenResponse: "secret", learnerTask: "secret", canvasActions: [{ text: "secret" }], memoryCandidate: { description: "secret" }, hintLevel: 0 } } as unknown as ProposalRecord;
  const safe = redactProposalForStorage(record);
  expect(JSON.stringify(safe)).not.toContain("secret");
  expect(safe.proposal.learnerTask).toBe("（已删除）");
  expect(redactProposalForStorage(safe)).toEqual(safe);
});
