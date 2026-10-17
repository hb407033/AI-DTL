import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import Fastify from "fastify";
import { WorkspaceScaffoldService, registerWorkspaceScaffold } from "../src/ai/workspace-scaffold-route.js";

let dir: string, store: WorkspaceStore, record: WorkspaceRecord;
const basis = { problemId: "p", problemRevision: 0, submissionId: "e", responseId: "r" };
const line = { kind: "line" as const, whole: "1", unit: "升", partitions: 2, meaning: "一条线是一升", sourceQuote: "这条线表示一升果汁" };
const understanding = { whole: line.whole, unit: line.unit, meaning: line.meaning, sourceQuote: line.sourceQuote };
const offer = { type: "offer" as const, offerId: "o", basis, understanding };
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ai-dtl-scaffold-")); store = new WorkspaceStore({ directory: dir });
  record = { schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0, phase: "exploring",
    problem: { problemId: "p", source: "curated", challengeId: "c", packVersion: "v1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" }, statement: { text: "一升果汁6.8元，半升多少钱？", confirmed: true, revision: 0 } },
    childInkBase64: "aW5r", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
  await store.save(record, null);
  const previewId = await store.saveMedia("s", "preview", "preview", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64"));
  record = { ...record, eventId: "evidence", revision: 1,
    submissions: [{ ...basis, boardRevision: 0, previewId, explanation: line.sourceQuote }].map(({ responseId, ...e }) => e),
    feedback: [{ responseId: "r", turnId: "t", summary: "需要辅助线段吗？", contested: false }] };
  expect((await store.save(record, 0)).ok).toBe(true);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("同意后生成、操作、隐藏完整落盘，原稿不变，普通保存与重启不擦掉提示", async () => {
  expect((await store.changeScaffold("s", "offer-event", 0, offer)).revision).toBe(1);
  await store.changeScaffold("s", "consent-event", 1, { type: "consent", offerId: "o" });
  await store.changeScaffold("s", "generate-event", 2, { type: "generate", offerId: "o", line });
  await store.changeScaffold("s", "select-event", 3, { type: "select", offerId: "o", selectedParts: [0] });
  await store.changeScaffold("s", "hide-event", 4, { type: "hide", offerId: "o" });
  expect(await store.load("s")).toEqual({ status: "ok", record });
  await store.save({ ...record, eventId: "ordinary-save", revision: 2 }, 1);
  const reloaded = new WorkspaceStore({ directory: dir });
  expect((await reloaded.loadScaffold("s")).items[0]).toMatchObject({ status: "hidden", selectedParts: [0], line });
  expect((await reloaded.changeScaffold("s", "hide-event", 4, { type: "hide", offerId: "o" })).revision).toBe(5);
  await expect(reloaded.changeScaffold("s", "hide-event", 4, { type: "select", offerId: "o", selectedParts: [1] })).rejects.toThrow("eventConflict");
});

test("换题或纠正原反馈将同意原子失效，旧生成不得复活", async () => {
  await store.changeScaffold("s", "offer-event", 0, offer);
  await store.changeScaffold("s", "consent-event", 1, { type: "consent", offerId: "o" });
  await store.save({ ...record, eventId: "correct", revision: 2, feedback: record.feedback.map(f => ({ ...f, contested: true })) }, 1);
  expect((await store.loadScaffold("s")).items[0]?.status).toBe("invalidated");
  await expect(store.changeScaffold("s", "late", 2, { type: "generate", offerId: "o", line })).rejects.toThrow("staleRevision");
  await expect(store.changeScaffold("s", "late2", 3, { type: "generate", offerId: "o", line })).rejects.toThrow();
});

test("不信任伪造证据或来源；并发状态转换不能覆盖；墓碑阻止迟到生成", async () => {
  await expect(store.changeScaffold("s", "fake", 0, { ...offer, basis: { ...basis, submissionId: "other" } })).rejects.toThrow("staleBasis");
  await expect(store.changeScaffold("s", "fake2", 0, { ...offer, understanding: { ...understanding, sourceQuote: "伪造孩子说过" } })).rejects.toThrow("missingSource");
  await store.changeScaffold("s", "offer-event", 0, offer);
  const results = await Promise.allSettled([
    store.changeScaffold("s", "agree", 1, { type: "consent", offerId: "o" }),
    store.changeScaffold("s", "decline", 1, { type: "invalidate", offerId: "o" }),
  ]);
  expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
  await store.delete("s");
  await expect(store.changeScaffold("s", "late", 2, { type: "generate", offerId: "o", line })).rejects.toThrow("missing");
});

test("HTTP 不接受伪造提案，邀请不生成图，明确同意后才调用生成并幂等重试", async () => {
  let generated = 0;
  const service = new WorkspaceScaffoldService(store, { understand: async () => understanding, generate: async () => { generated++; return line; } });
  const app = Fastify(); registerWorkspaceScaffold(app, store, service);
  try {
    expect((await app.inject({ method: "POST", url: "/workspace/s/scaffold", payload: { eventId: "fake", expectedRevision: 0, action: offer } })).statusCode).toBe(400);
    const offered = await service.offerAfterHelp("s", "e", "r");
    expect(generated).toBe(0);
    const offerId = offered.items[0]!.offerId;
    const payload = { eventId: "yes", expectedRevision: offered.revision, action: { type: "consent", offerId } };
    const first = await app.inject({ method: "POST", url: "/workspace/s/scaffold", payload });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().items[0].status).toBe("visible");
    expect((await app.inject({ method: "POST", url: "/workspace/s/scaffold", payload })).statusCode).toBe(200);
    expect(generated).toBe(1);
    expect((await app.inject({ method: "GET", url: "/workspace/s/scaffold" })).headers["cache-control"]).toBe("no-store");
  } finally { await app.close(); }
});

test("生成期间纠正可立即生效，不等模型；迟到结果被拒绝", async () => {
  let release!: (value: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const service = new WorkspaceScaffoldService(store, { understand: async () => understanding,
    generate: async () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  const offered = await service.offerAfterHelp("s", "e", "r");
  const offerId = offered.items[0]!.offerId;
  const pending = service.act("s", { eventId: "yes", expectedRevision: 1, action: { type: "consent", offerId } });
  const rejection = expect(pending).rejects.toThrow("scaffoldCancelled");
  await started;
  const invalidated = await service.act("s", { eventId: "no", expectedRevision: 2, action: { type: "invalidate", offerId } });
  expect(invalidated.items[0]?.status).toBe("invalidated");
  release(line); await rejection;
  expect((await store.loadScaffold("s")).items[0]?.status).toBe("invalidated");
  service.close();
});

test("同一同意同时重发也只能占用一次模型生成", async () => {
  let calls = 0;
  const service = new WorkspaceScaffoldService(store, { understand: async () => understanding,
    generate: async () => { calls++; await new Promise(r => setTimeout(r, 20)); return line; } });
  const offered = await service.offerAfterHelp("s", "e", "r");
  const payload = { eventId: "yes", expectedRevision: 1, action: { type: "consent", offerId: offered.items[0]!.offerId } };
  const results = await Promise.allSettled([service.act("s", payload), service.act("s", payload)]);
  expect(calls).toBe(1);
  expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
  service.close();
});
