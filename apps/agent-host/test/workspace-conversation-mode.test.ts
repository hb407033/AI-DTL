import { expect, test } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-conv-mode-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米彩带2.4元，买0.3米多少钱？", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  return { directory, store };
}

async function harness(store: WorkspaceStore, transcript: () => string) {
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => transcript(), close() {},
    respond: async (_p, _i, _img, audio) => { audio(Buffer.from("a")); return "好的。"; } }));
  return app;
}

test("对话模式：开放表达归 review，明确暂停发 paused 并回独立", async () => {
  const { directory, store } = await setup();
  const queue = ["每米是什么意思？", "我先想一想", "我觉得是7.2。"];
  const app = await harness(store, () => queue.shift()!);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string, start = 0) => {
    for (let i = 0; i < 100; i++) { const m = messages.slice(start).find(m => m.type === type); if (m) return m; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}: ${JSON.stringify(messages)}`);
  };
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  try {
    await new Promise<void>(r => ws.once("open", r));
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    // 第1轮：对话模式开放表达 → review
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" });
    expect((await wait("transcript")).action).toBe("review");
    // 第2轮：明确暂停 → paused，无 transcript
    const start1 = messages.length;
    send({ type: "voiceStart", eventId: "s1", expectedRevision: 0, problemId: "p", turnId: "t1" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e1", expectedRevision: 0, problemId: "p", turnId: "t1" });
    await wait("paused", start1);
    expect(messages.slice(start1).some(m => m.type === "transcript")).toBe(false);
    // 第3轮：暂停后回到独立模式 → 开放表达归 uncertain
    const start2 = messages.length;
    send({ type: "voiceStart", eventId: "s2", expectedRevision: 0, problemId: "p", turnId: "t2" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e2", expectedRevision: 0, problemId: "p", turnId: "t2" });
    expect((await wait("transcript", start2)).action).toBe("uncertain");
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("独立模式（默认 hello）：开放表达不自动 review", async () => {
  const { directory, store } = await setup();
  const app = await harness(store, () => "我觉得是7.2。");
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string) => {
    for (let i = 0; i < 100; i++) { const m = messages.find(m => m.type === type); if (m) return m; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}`);
  };
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  try {
    await new Promise<void>(r => ws.once("open", r));
    send({ type: "hello" }); await wait("ready");
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" });
    expect((await wait("transcript")).action).toBe("uncertain");
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
