import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { inquiryEntrySchema } from "@ai-scholar/session-contracts";
import Fastify from "fastify";
import { registerWorkspaceRoutes } from "../src/ai/workspace-route.js";
import { inquiryForTeaching } from "../src/ai/workspace-teaching-context.js";

test("检验推翻猜想后迁移失败再修订：保留两次尝试，教学只接最新解释，不能自动宣布掌握", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inquiry-transfer-"));
  const store = new WorkspaceStore({ directory });
  const app = Fastify(); registerWorkspaceRoutes(app, store);
  try {
    const record = (await app.inject({ method: "POST", url: "/workspace/sessions" })).json();
    const url = `/workspace/${record.sessionId}/inquiry`;
    const entries = [
      { entryId: "guess", kind: "conjecture", text: "乘法总会让价格变大。" },
      { entryId: "model", kind: "representation", text: "把一升画成一个整体，两个半升合起来是一升。" },
      { entryId: "method", kind: "strategy", text: "数量减半时，把一升的6.8元分成相等两份。" },
      { entryId: "check", kind: "verification", text: "3.4加3.4等于6.8，能还原一升，半升价格反而更小。" },
      { entryId: "revised-guess", kind: "conjecture", text: "原猜想不对：正数乘小于一的正数会变小。", revises: "guess" },
      { entryId: "transfer-failed", kind: "transfer", text: "换成买彩带时我把半米看成了两米。", transfer: {
        context: "彩带每米8元，买半米。", method: "算成8乘2。", check: "16元超过一米价格，和只买半米矛盾。", outcome: "没成功，重新检查数量。" } },
      { entryId: "transfer-revised", kind: "transfer", text: "半米是半个整体，不是两个整体。", revises: "transfer-failed", transfer: {
        context: "彩带每米8元，买半米。", method: "把8元分成相等两份。", check: "4元加4元是8元，两个半米是一米。", outcome: "这次得到4元，与整米价格一致。" } },
      { entryId: "reflection", kind: "reflection", text: "可以检查两份能否还原整体，不只记答案。下次先确认数量表示几个整体。" },
    ];
    for (const [index, entry] of entries.entries()) {
      const response = await app.inject({ method: "POST", url, payload: { expectedRevision: index, entry: { ...entry, author: "child", evidenceIds: [] } } });
      expect(response.statusCode, response.body).toBe(201);
    }
    const reopened = await new WorkspaceStore({ directory }).loadInquiry(record.sessionId);
    expect(reopened.entries).toHaveLength(8);
    expect(reopened.entries.find(e => e.entryId === "guess")?.text).toBe("乘法总会让价格变大。");
    expect(reopened.entries.find(e => e.entryId === "transfer-failed")?.transfer?.outcome).toContain("没成功");
    expect(reopened.entries.find(e => e.entryId === "transfer-revised")?.revises).toBe("transfer-failed");
    const teaching = inquiryForTeaching(reopened);
    expect(teaching.map(e => e.entryId)).not.toContain("guess");
    expect(teaching.map(e => e.entryId)).not.toContain("transfer-failed");
    expect(teaching.find(e => e.entryId === "revised-guess")?.text).toBe("原猜想不对：正数乘小于一的正数会变小。");
    expect(teaching.find(e => e.entryId === "transfer-revised")?.transfer?.check).toContain("两个半米是一米");
    const unchanged = await store.load(record.sessionId);
    expect(unchanged).toMatchObject({ status: "ok", record: { revision: 0, phase: "confirming", feedback: [] } });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("完整探究表达经过真实 HTTP 持久化，迁移失败也是可回看的作品而非掌握", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inquiry-http-"));
  const store = new WorkspaceStore({ directory });
  const app = Fastify(); registerWorkspaceRoutes(app, store);
  try {
    const record = (await app.inject({ method: "POST", url: "/workspace/sessions" })).json();
    const url = `/workspace/${record.sessionId}/inquiry`;
    expect((await app.inject({ method: "GET", url })).json()).toEqual({ revision: 0, entries: [] });
    const kinds = ["observation", "question", "conjecture", "representation", "strategy", "verification", "transfer", "reflection"];
    for (let n = 0; n < kinds.length; n++) {
      const entry = { entryId: `e-${n}`, kind: kinds[n], author: "child", text: `我的${kinds[n]}记录`, evidenceIds: [],
        ...(kinds[n] === "transfer" ? { transfer: { context: "按升买果汁", method: "找单位价格", check: "反向核对", outcome: "发现不一致，准备修正" } } : {}) };
      const response = await app.inject({ method: "POST", url, payload: { expectedRevision: n, entry } });
      expect(response.statusCode, response.body).toBe(201);
    }
    const response = await app.inject({ method: "POST", url, payload: { expectedRevision: 8,
      entry: { entryId: "revision", kind: "conjecture", author: "child", text: "我的猜想需要增加条件", evidenceIds: [], revises: "e-2" } } });
    expect(response.statusCode).toBe(201);
    const journal = await new WorkspaceStore({ directory }).loadInquiry(record.sessionId);
    expect(journal.entries).toHaveLength(9);
    expect(journal.entries[2]?.text).toBe("我的conjecture记录");
    expect(journal.entries[8]?.revises).toBe("e-2");
    expect((await store.load(record.sessionId))).toMatchObject({ status: "ok", record: { phase: "confirming" } });
    expect((await app.inject({ method: "POST", url, payload: { expectedRevision: 0, entry: { entryId: "late", kind: "question", author: "child", text: "旧版本", evidenceIds: [] } } })).statusCode).toBe(409);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("迁移不是掌握标签，必须保留新情境、方法、检验和实际结果", () => {
  const entry = { entryId: "a", kind: "transfer", author: "child", text: "换到果汁价格试试", evidenceIds: [] };
  expect(inquiryEntrySchema.safeParse(entry).success).toBe(false);
  expect(inquiryEntrySchema.safeParse({ ...entry, transfer: { context: "果汁按升计价", method: "先找一份", check: "反算原价", outcome: "结果不一致，想再检查" } }).success).toBe(true);
  expect(inquiryEntrySchema.safeParse({ ...entry, kind: "reflection", author: "agent" }).success).toBe(false);
});

test("历程追加、幂等、修订留旧稿，旧画布保存不会抹掉历程", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inquiry-journal-"));
  const store = new WorkspaceStore({ directory });
  const record = { schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: null, phase: "confirming", childInkBase64: "", board: { revision: 0, rectangles: [] },
    submissions: [], feedback: [], openQuestions: [] };
  const first = { entryId: "first", kind: "question", author: "child", text: "价格和长度有什么关系？", evidenceIds: [] };
  try {
    await store.save(record, null);
    expect(await store.loadInquiry("s")).toEqual({ revision: 0, entries: [] });
    expect((await store.appendInquiry("s", first, 0)).revision).toBe(1);
    expect((await store.appendInquiry("s", first, 0)).entries).toHaveLength(1);
    await expect(store.appendInquiry("s", { ...first, text: "不同请求" }, 1)).rejects.toThrow("eventConflict");
    await expect(store.appendInquiry("s", { ...first, entryId: "stale" }, 0)).rejects.toThrow("staleRevision");
    const revised = { ...first, entryId: "second", revises: "first", text: "每米价格不变，长度变成三成，总价会怎样？" };
    await store.appendInquiry("s", revised, 1);
    await store.save({ ...record, revision: 1, eventId: "ink-save" }, 0);
    const loaded = await new WorkspaceStore({ directory }).loadInquiry("s");
    expect(loaded.entries.map(e => e.text)).toEqual([first.text, revised.text]);
    await expect(store.appendInquiry("s", { ...first, entryId: "wrong", revises: "missing" }, 2)).rejects.toThrow("missingRevisionTarget");
    await expect(store.appendInquiry("s", { ...first, entryId: "wrong", evidenceIds: ["invented"] }, 2)).rejects.toThrow("missingEvidence");
    const concurrent = await Promise.allSettled(["a", "b"].map(entryId => store.appendInquiry("s", { ...first, entryId }, 2)));
    expect(concurrent.filter(r => r.status === "fulfilled")).toHaveLength(1);
    await store.delete("s");
    await expect(store.loadInquiry("s")).rejects.toThrow("missing");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
