import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceRoutes } from "../src/ai/workspace-route.js";

test("孩子可以独立保存证据而不调用老师，重复提交不重复写，错题版本和缺失快照拒绝", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "independent-evidence-"));
  const store = new WorkspaceStore({ directory });
  const app = Fastify(); registerWorkspaceRoutes(app, store);
  try {
    await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0, phase: "exploring",
      problem: { problemId: "p", source: "curated", challengeId: "c", packVersion: "v1",
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
        statement: { text: "我的问题", confirmed: true, revision: 0 } },
      childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
    const mediaId = await store.saveMedia("s", "image", "preview", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64"));
    const evidence = { submissionId: "e", problemId: "p", problemRevision: 0, boardRevision: 1, previewId: mediaId, explanation: "这是我自己画的表示" };
    const send = (payload: unknown) => app.inject({ method: "POST", url: "/workspace/s/evidence", payload: payload as object });
    expect((await send({ eventId: "wrong", expectedRevision: 0, evidence: { ...evidence, problemRevision: 2 } })).statusCode).toBe(409);
    expect((await send({ eventId: "missing", expectedRevision: 0, evidence: { ...evidence, previewId: "missing" } })).statusCode).toBe(409);
    const body = { eventId: "capture", expectedRevision: 0, evidence };
    const first = await send(body);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().submissions).toEqual([evidence]);
    expect(first.json().feedback).toEqual([]);
    expect((await send(body)).json().revision).toBe(1);
    expect((await send({ ...body, evidence: { ...evidence, explanation: "不同内容" } })).statusCode).toBe(409);
    await store.appendInquiry("s", { entryId: "thought", kind: "representation", author: "child", text: "我的解释", evidenceIds: ["e"] }, 0);
    expect((await store.loadInquiry("s")).entries[0]?.evidenceIds).toEqual(["e"]);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
