// packages/learning-kernel/test/store.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { createSessionContext } from "../src/session-state.js";
import { InMemorySessionStore, shouldSnapshot, type SessionStore } from "../src/store.js";
import { SqliteSessionStore } from "../src/sqlite-store.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

const dir = mkdtempSync(join(tmpdir(), "ai-scholar-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const challenge = fakePlugin.createChallenge({ curriculumAnchor: "fake/unit-1" });
const stored = (id: string, seq: number) => ({
  event: { eventId: id, clientSessionId: "s-1", deviceId: "d", clientSeq: seq, occurredAt: seq, quality: "confirmed" as const, source: "child_button" as const, semanticObjectIds: [], payload: { type: "DONE" as const } },
  serverSeq: seq, receivedAt: 1_000 + seq, contentHash: `h-${id}`,
});

const impls: Array<[string, () => SessionStore]> = [
  ["内存", () => new InMemorySessionStore()],
  ["SQLite", () => new SqliteSessionStore(join(dir, `${Math.random().toString(16).slice(2)}.sqlite`))],
];

for (const [name, make] of impls) {
  describe(`${name} 存储`, () => {
    test("会话、事件、出站消息、提案、快照都能写入并读回", () => {
      const store = make();
      store.createSession({ sessionId: "s-1", discipline: "fake", challenge, createdAt: 1 });
      store.appendEvent("s-1", stored("e-1", 1));
      store.appendEvent("s-1", stored("e-2", 2));
      expect(store.listEvents("s-1").map((e) => e.event.eventId)).toEqual(["e-1", "e-2"]);

      store.saveOutbound("s-1", "e-1", [{ type: "notice", id: "o-1", text: "hi" }]);
      expect(store.getOutbound("s-1", "e-1")).toEqual([{ type: "notice", id: "o-1", text: "hi" }]);
      expect(store.getOutbound("s-1", "e-9")).toBeNull();

      store.saveProposal("s-1", { proposalId: "p-1", accepted: false, reasons: ["hint:notOneLevelUp"], proposal: { proposalId: "p-1", spokenResponse: "", learnerTask: "t", canvasActions: [], expectedEvidence: [], hintLevel: 3 }, decidedAt: 5 });
      expect(store.listProposals("s-1")[0]).toMatchObject({ proposalId: "p-1", accepted: false });

      const ctx = { ...createSessionContext(), state: "INDEPENDENT" as const };
      store.saveSnapshot("s-1", { snapshotSeq: 1, context: ctx, lastConfirmedSeq: 2, challenge, transferChallenge: null, evidence: [], createdAt: 9 });
      expect(store.latestSnapshot("s-1")).toMatchObject({ snapshotSeq: 1, lastConfirmedSeq: 2, context: { state: "INDEPENDENT" } });
      expect(store.latestSnapshot("nope")).toBeNull();
    });

    test("同一 event_id 重复写入不报错也不重复", () => {
      const store = make();
      store.createSession({ sessionId: "s-1", discipline: "fake", challenge, createdAt: 1 });
      store.appendEvent("s-1", stored("e-1", 1));
      store.appendEvent("s-1", stored("e-1", 1));
      expect(store.listEvents("s-1")).toHaveLength(1);
    });
  });
}

describe("快照策略（设计稿 12）", () => {
  test("状态转换、100 条事件或 30 秒，先到者触发", () => {
    expect(shouldSnapshot({ stateChanged: true, eventsSinceSnapshot: 0, msSinceSnapshot: 0 })).toBe(true);
    expect(shouldSnapshot({ stateChanged: false, eventsSinceSnapshot: 100, msSinceSnapshot: 0 })).toBe(true);
    expect(shouldSnapshot({ stateChanged: false, eventsSinceSnapshot: 3, msSinceSnapshot: 30_000 })).toBe(true);
    expect(shouldSnapshot({ stateChanged: false, eventsSinceSnapshot: 99, msSinceSnapshot: 29_999 })).toBe(false);
  });
});
