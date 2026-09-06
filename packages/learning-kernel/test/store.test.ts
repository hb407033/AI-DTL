// packages/learning-kernel/test/store.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { createSessionContext } from "../src/session-state.js";
import { InMemorySessionStore, shouldSnapshot, type SessionStore } from "../src/store.js";
import { openLearningDatabase } from "../src/growth/database.js";
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
  // 会话库与成长库同库同连接：SqliteSessionStore 不再自己开库，改为接收注入的连接
  ["SQLite", () => new SqliteSessionStore(openLearningDatabase(join(dir, `${Math.random().toString(16).slice(2)}.sqlite`)))],
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

// 两个实现跑同一套契约：作品版本外键、转写有效质量、旧库回填
for (const [name, make] of impls) {
  describe(`${name} 存储的三处扩展`, () => {
    const utter = (id: string, seq: number, quality: "unconfirmed" | "confirmed" = "unconfirmed") => ({
      event: { eventId: id, clientSessionId: "s-1", deviceId: "d", clientSeq: seq, occurredAt: seq, quality, source: "child_voice" as const, semanticObjectIds: [], payload: { type: "UTTERANCE" as const, text: "四十一" } },
      serverSeq: seq, receivedAt: 1_000 + seq, contentHash: `h-${id}`,
    });
    const confirm = (id: string, seq: number, target: string, corrected?: string) => ({
      event: { eventId: id, clientSessionId: "s-1", deviceId: "d", clientSeq: seq, occurredAt: seq, quality: "confirmed" as const, source: "child_button" as const, semanticObjectIds: [], payload: { type: "CONFIRM_TRANSCRIPT" as const, targetEventId: target, confirmed: true, ...(corrected === undefined ? {} : { correctedText: corrected }) } },
      serverSeq: seq, receivedAt: 1_000 + seq, contentHash: `h-${id}`,
    });

    function open(): SessionStore {
      const store = make();
      store.createSession({ sessionId: "s-1", discipline: "fake", challenge, createdAt: 1 });
      return store;
    }

    test("事件带作品版本外键落盘，纯语音事件同样有", () => {
      const store = open();
      store.appendEvent("s-1", utter("e-1", 1), "av-1");
      expect(store.listEvents("s-1")[0]?.artifactVersionId).toBe("av-1");
    });

    test("有效质量由确认事件推导：未确认是 unconfirmed，确认后 confirmed，修正后 corrected", () => {
      const store = open();
      store.appendEvent("s-1", utter("e-1", 1), "av-1");
      expect(store.effectiveQualityOf("s-1", "e-1")).toBe("unconfirmed");
      store.appendEvent("s-1", confirm("e-2", 2, "e-1"), "av-1");
      expect(store.effectiveQualityOf("s-1", "e-1")).toBe("confirmed");
      store.appendEvent("s-1", confirm("e-3", 3, "e-1", "42"), "av-1");
      expect(store.effectiveQualityOf("s-1", "e-1")).toBe("corrected");
      // 原事件行永不改写
      expect(store.listEvents("s-1")[0]?.event.quality).toBe("unconfirmed");
    });

    test("不存在的事件按未确认处理", () => {
      expect(open().effectiveQualityOf("s-1", "nope")).toBe("unconfirmed");
    });

    test("回填只补没有外键的行，返回补了几条，重复调返回 0", () => {
      const store = open();
      store.appendEvent("s-1", utter("e-1", 1));
      store.appendEvent("s-1", utter("e-2", 2), "av-existing");
      expect(store.backfillArtifactVersion("s-1", "av-new")).toBe(1);
      expect(store.backfillArtifactVersion("s-1", "av-new")).toBe(0);
      const byId = Object.fromEntries(store.listEvents("s-1").map((e) => [e.event.eventId, e.artifactVersionId]));
      expect(byId).toEqual({ "e-1": "av-new", "e-2": "av-existing" });
    });
  });
}
