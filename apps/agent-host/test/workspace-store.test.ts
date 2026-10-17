import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "ai-dtl-v2-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
export const record = (): WorkspaceRecord => ({ schemaVersion: 2, sessionId: "s-1", eventId: "e-0", revision: 0,
  problem: null, phase: "confirming", childInkBase64: "", board: { revision: 0, rectangles: [] },
  submissions: [], feedback: [], openQuestions: [] });
test("保存可完整恢复，重放在宿主重启后仍幂等", async () => {
  const store = new WorkspaceStore({ directory });
  expect(await store.save(record(), null)).toEqual({ ok: true, revision: 0 });
  const updated = { ...record(), eventId: "e-1", revision: 1, childInkBase64: "aW5r" };
  expect(await store.save(updated, 0)).toEqual({ ok: true, revision: 1 });
  const reloaded = new WorkspaceStore({ directory });
  expect(await reloaded.save(record(), null)).toEqual({ ok: true, revision: 0 });
  expect(await reloaded.load("s-1")).toEqual({ status: "ok", record: updated });
  expect(await reloaded.save({ ...record(), childInkBase64: "YQ==" }, null)).toMatchObject({ ok: false, reason: "eventConflict" });
});
test("同 revision 并发写入只有一个成功", async () => {
  const store = new WorkspaceStore({ directory });
  await store.save(record(), null);
  const results = await Promise.all(["a", "b"].map(eventId => store.save({ ...record(), eventId, revision: 1 }, 0)));
  expect(results.filter(r => r.ok)).toHaveLength(1);
});
test("跨 store 实例并发也不覆盖同目录数据", async () => {
  const a = new WorkspaceStore({ directory }), b = new WorkspaceStore({ directory });
  await a.save(record(), null);
  const results = await Promise.all([a.save({ ...record(), eventId: "a", revision: 1 }, 0), b.save({ ...record(), eventId: "b", revision: 1 }, 0)]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
});
test("取消排队保存不会越过会话写锁提交，旧 save 调用保持兼容", async () => {
  const store = new WorkspaceStore({ directory });
  await store.save(record(), null);
  let entered!: () => void, release!: () => void;
  const locked = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  // 控制真实会话队列的前一写者，复现等待锁期间取消。
  const holder = (store as unknown as { serial(id: string, work: () => Promise<void>): Promise<void> })
    .serial("s-1", async () => { entered(); await gate; });
  await locked;
  const controller = new AbortController();
  const pending = store.save({ ...record(), eventId: "cancelled", revision: 1 }, 0, undefined, { signal: controller.signal });
  controller.abort(); release(); await holder;
  expect(await pending).toEqual({ ok: false, reason: "aborted" });
  expect(await store.load("s-1")).toEqual({ status: "ok", record: record() });
  expect(await store.save({ ...record(), eventId: "valid", revision: 1 }, 0)).toEqual({ ok: true, revision: 1 });
});
test("墓碑阻止保存和媒体迟到复活", async () => {
  const store = new WorkspaceStore({ directory });
  await store.save(record(), null); await store.delete("s-1");
  expect(await store.save(record(), null)).toMatchObject({ ok: false, reason: "deleted" });
  expect(await store.load("s-1")).toEqual({ status: "missing" });
  await expect(store.saveMedia("s-1", "photo-e", "problemPhoto", png)).rejects.toThrow("deleted");
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN0AAAAASUVORK5CYII=", "base64");
test("媒体限会话访问且 eventId 重试不重复创建", async () => {
  const store = new WorkspaceStore({ directory }); await store.save(record(), null);
  const id = await store.saveMedia("s-1", "photo-e", "problemPhoto", png);
  expect(await store.saveMedia("s-1", "photo-e", "problemPhoto", png)).toBe(id);
  expect((await store.loadMedia("s-1", id))?.data).toEqual(png);
  expect(await store.loadMedia("other", id)).toBeNull();
  await expect(store.saveMedia("s-1", "photo-e", "preview", png)).rejects.toThrow("eventConflict");
  await expect(store.load("../bad")).rejects.toThrow("invalidId");
  await expect(store.saveMedia("s-1", "bad", "preview", Buffer.from("not-an-image"))).rejects.toThrow("invalidImage");
});
test("损坏文件不覆盖，不接受越级 revision", async () => {
  const store = new WorkspaceStore({ directory }); await store.save(record(), null);
  expect(await store.save({ ...record(), eventId: "jump", revision: 3 }, 0)).toMatchObject({ ok: false, reason: "staleRevision" });
  await writeFile(path.join(directory, "s-1.json"), "broken");
  expect(await store.save({ ...record(), eventId: "e-1", revision: 1 }, 0)).toMatchObject({ ok: false, reason: "corruptExisting" });
});
