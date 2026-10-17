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
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-dialogue-5round-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米彩带2.4元，买0.3米多少钱？", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  return { directory, store };
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64");

test("dialogue 五轮开放交流：一次 hello、每轮 review 不升提示、无重复连接、新表达与证据正确", async () => {
  const { directory, store } = await setup();
  const transcripts = ["这里的每米是什么意思？", "我觉得是7.2", "我画了一条线表示彩带", "先算24乘0.3", "所以是7.2元"];
  let respondCalls = 0; const prompts: string[] = [];
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => transcripts.shift()!, close() {},
    respond: async (_pcm, instructions, _image, audio) => { prompts.push(instructions); respondCalls++; audio(Buffer.from("a")); return "你说得有道理，继续试试。"; } }));
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string, start = 0) => {
    for (let i = 0; i < 100; i++) { const m = messages.slice(start).find(m => m.type === type); if (m) return m; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}: ${JSON.stringify(messages.slice(start))}`);
  };
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  try {
    await new Promise<void>(r => ws.once("open", r));
    // 一次 hello 开启 dialogue，无需固定"看看我的想法"口令
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    let revision = 0;
    for (let n = 0; n < 5; n++) {
      const start = messages.length;
      send({ type: "voiceStart", eventId: `s${n}`, expectedRevision: revision, problemId: "p", turnId: `t${n}` });
      ws.send(Buffer.alloc(3200));
      send({ type: "voiceEnd", eventId: `e${n}`, expectedRevision: revision, problemId: "p", turnId: `t${n}` });
      const transcript = await wait("transcript", start);
      expect(transcript.action, `round ${n} 应归 review`).toBe("review");
      expect(transcript.continuation, `round ${n} dialogue 不套用 OneAnswerFollowup`).toBe(false);
      const previewId = await store.saveMedia("s", `pv${n}`, "preview", PNG);
      send({ type: "authorize", eventId: `auth${n}`, expectedRevision: revision, turnId: `t${n}`, action: "review",
        evidence: { submissionId: `sub${n}`, problemId: "p", problemRevision: 0, boardRevision: n, previewId, explanation: transcript.text } });
      const done = await wait("responseDone", start);
      revision = done.record.revision;
      // 每轮新证据落盘
      expect(done.record.submissions.some((s: any) => s.submissionId === `sub${n}`)).toBe(true);
    }
    expect(respondCalls).toBe(5); // 每轮一次教学调用，无重复连接
    // dialogue 不使用 OneAnswerFollowup 收尾指令（"不再追问"仅出现在 continuation 分支）
    expect(prompts.every(p => !p.includes("不再追问"))).toBe(true);
    // 五轮均在同一连接（一次 hello）
    expect(messages.filter(m => m.type === "ready")).toHaveLength(1);
    const stored = await store.load("s");
    expect(stored.status === "ok" && stored.record.submissions).toHaveLength(5);
    expect(stored.status === "ok" && stored.record.feedback.filter((f: any) => !f.contested)).toHaveLength(5);
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("dialogue 边界：打断取消当前响应", async () => {
  const { directory, store } = await setup();
  let interrupted = false;
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => "我觉得是7.2", close() {},
    respond: async (_pcm, _i, _img, audio, signal) => { audio(Buffer.from("a"));
      return new Promise<string>((_resolve, reject) => signal?.addEventListener("abort", () => { interrupted = true; reject(Error("aborted")); }, { once: true })); } }));
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string, start = 0) => {
    for (let i = 0; i < 100; i++) { const m = messages.slice(start).find(m => m.type === type); if (m) return m; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}`);
  };
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  try {
    await new Promise<void>(r => ws.once("open", r));
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" }); await wait("transcript");
    send({ type: "authorize", eventId: "auth0", expectedRevision: 0, turnId: "t0", action: "review",
      evidence: { submissionId: "sub0", problemId: "p", problemRevision: 0, boardRevision: 0, previewId: await store.saveMedia("s", "pv0", "preview", PNG), explanation: "我画了线" } });
    await wait("responseStart");
    send({ type: "interrupt", turnId: "t0" }); await wait("interrupted");
    expect(interrupted).toBe(true);
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("dialogue 边界：题意版本变更后对话授权失效，回到独立", async () => {
  const { directory, store } = await setup();
  const transcripts = ["我觉得是7.2", "我换了个想法"];
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => transcripts.shift()!, close() {},
    respond: async (_pcm, _i, _img, audio) => { audio(Buffer.from("a")); return "继续试试。"; } }));
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string, start = 0) => {
    for (let i = 0; i < 100; i++) { const m = messages.slice(start).find(m => m.type === type); if (m) return m; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}: ${JSON.stringify(messages.slice(start))}`);
  };
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  try {
    await new Promise<void>(r => ws.once("open", r));
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    // 第1轮 dialogue → review
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" });
    expect((await wait("transcript")).action).toBe("review");
    // 题意版本变更：更新 store 中的 statement.revision
    const loaded = await store.load("s");
    if (loaded.status !== "ok") throw Error("load");
    const updated = await store.save({ ...loaded.record, eventId: "reconfirm", revision: loaded.record.revision + 1,
      problem: { ...loaded.record.problem!, statement: { ...loaded.record.problem!.statement, revision: 1, confirmed: true } } }, loaded.record.revision);
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw Error("save failed");
    const newRevision = updated.revision;
    // 第2轮：题意版本变更后对话授权失效 → independent → uncertain
    const start1 = messages.length;
    send({ type: "voiceStart", eventId: "s1", expectedRevision: newRevision, problemId: "p", turnId: "t1" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e1", expectedRevision: newRevision, problemId: "p", turnId: "t1" });
    expect((await wait("transcript", start1)).action).toBe("uncertain");
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
