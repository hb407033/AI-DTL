import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { expect, test } from "vitest";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { applyWorkspaceSync, registerWorkspaceSync } from "../src/ai/workspace-sync-route.js";

const id = "sync-work";
const record: WorkspaceRecord = {
  schemaVersion: 2, sessionId: id, eventId: "initial", revision: 0,
  problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "植树问题" },
    statement: { text: "60米小路每隔5米栽一棵，两端都栽，一共多少棵？", revision: 0, confirmed: true } },
  phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [],
};
const decision = (suffix: string, utterance: string) => ({
  problemId: "p", problemRevision: 0, turnId: `t${suffix}`, responseId: `r${suffix}`,
  child: "我不会区分间隔和树", focus: "clarify" as const, observation: "孩子求助",
  evidenceIds: [`t${suffix}`], resolved: [] as string[], utterance, method: "ordinary" as const, handoff: false,
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64");

function batch(extra: Record<string, unknown> = {}) {
  const first = decision("1", "先只画一段短路，数数有几棵。");
  const second = decision("2", "两端各有一棵，中间还有几段？");
  return {
    batchId: "batch-1",
    record: { ...record, revision: 2, eventId: "final", feedback: [
      { responseId: first.responseId, turnId: first.turnId, summary: first.utterance, contested: false },
      { responseId: second.responseId, turnId: second.turnId, summary: second.utterance, contested: false },
    ] },
    expectedRevision: 0,
    decisions: [first, second],
    turns: [
      { turnId: "t1", transcript: "帮我看看", kind: "help", utterance: first.utterance, played: true, path: "fast" },
      { turnId: "t2", transcript: "有几段", kind: "question", utterance: second.utterance, played: false, path: "slow" },
    ],
    usage: [{
      sessionId: id, turnId: "t1", callId: "call-1", purpose: "teaching", model: "qwen3.8-omni-flash-realtime",
      status: "completed", usage: { input_tokens: 12, output_tokens: 4 }, estimatedCostCny: null, latencyMs: 800, path: "fast",
    }],
    ...extra,
  };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sync-batch-"));
  const store = new WorkspaceStore({ directory });
  await store.save(record, null);
  const usageFile = path.join(directory, "usage.jsonl");
  const app = Fastify({ logger: false });
  registerWorkspaceSync(app, store, usageFile);
  return { directory, store, app, usageFile };
}

test("同一 batchId 重放只应用一次", async () => {
  const { directory, store, app } = await fixture();
  try {
    const payload = batch();
    const first = await app.inject({ method: "POST", url: `/workspace/${id}/sync`, payload });
    const second = await app.inject({ method: "POST", url: `/workspace/${id}/sync`, payload });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ applied: true, revision: 2 });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ applied: false, duplicate: true });
    expect(await store.loadTeachingDecisions(id)).toHaveLength(2);
    const turns = (await readFile(path.join(directory, `${id}-turns.jsonl`), "utf8")).trim().split("\n");
    expect(turns).toHaveLength(2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("版本倒退返回 409 且不写入", async () => {
  const { directory, store, app } = await fixture();
  try {
    const rejected = await app.inject({ method: "POST", url: `/workspace/${id}/sync`, payload: batch({ expectedRevision: 4 }) });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toEqual({ reason: "revisionConflict" });
    await expect(readFile(path.join(directory, `${id}-sync-batches.jsonl`), "utf8")).rejects.toThrow();
    expect(await store.loadTeachingDecisions(id)).toHaveLength(0);
    const accepted = await app.inject({ method: "POST", url: `/workspace/${id}/sync`, payload: batch() });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ applied: true });
    expect(await store.loadTeachingDecisions(id)).toHaveLength(2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("决策与用量落盘且不含录音字段", async () => {
  const { directory, app, usageFile } = await fixture();
  try {
    const rejected = await app.inject({ method: "POST", url: `/workspace/${id}/sync`, payload: batch({ pcm: "AAAA" }) });
    expect(rejected.statusCode).toBe(400);
    await expect(readFile(path.join(directory, `${id}-sync-batches.jsonl`), "utf8")).rejects.toThrow();
    const accepted = await app.inject({ method: "POST", url: `/workspace/${id}/sync`, payload: batch() });
    expect(accepted.statusCode).toBe(200);
    const usage = await readFile(usageFile, "utf8");
    expect(usage).toContain("call-1");
    expect(usage).not.toContain("pcm");
    expect(usage).not.toContain("AAAA");
    const turns = await readFile(path.join(directory, `${id}-turns.jsonl`), "utf8");
    expect(turns).not.toContain("pcm");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("决策写到一半失败不吞批次，重放只补齐一次", async () => {
  const { directory, store, usageFile } = await fixture();
  try {
    const payload = batch();
    const crashed = await applyWorkspaceSync(store, id, payload, { usageFile, failAfterDecisions: 1 });
    expect(crashed).toEqual({ status: 500, body: { reason: "injectedFailure" } });
    expect(await store.readSyncBatch(id, "batch-1")).toBe("pending");
    expect(await store.loadTeachingDecisions(id)).toHaveLength(1);
    await expect(readFile(path.join(directory, `${id}-turns.jsonl`), "utf8")).rejects.toThrow();
    const recovered = await applyWorkspaceSync(store, id, payload, { usageFile });
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ applied: true, revision: 2 });
    expect(await store.readSyncBatch(id, "batch-1")).toBe("applied");
    expect(await store.loadTeachingDecisions(id)).toHaveLength(2);
    expect((await readFile(path.join(directory, `${id}-turns.jsonl`), "utf8")).trim().split("\n")).toHaveLength(2);
    const usageLines = (await readFile(usageFile, "utf8")).trim().split("\n");
    expect(usageLines).toHaveLength(1);
    const again = await applyWorkspaceSync(store, id, payload, { usageFile });
    expect(again.body).toEqual({ applied: false, duplicate: true });
    expect((await readFile(usageFile, "utf8")).trim().split("\n")).toHaveLength(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("相同图片字节返回已有 mediaId", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sync-media-"));
  const store = new WorkspaceStore({ directory });
  await store.save(record, null);
  try {
    const first = await store.saveMedia(id, "photo-a", "preview", png);
    const second = await store.saveMedia(id, "photo-b", "preview", png);
    expect(second).toBe(first);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
