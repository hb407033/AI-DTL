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
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-conv-correct-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米彩带2.4元，买0.3米多少钱？", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  return { directory, store };
}

test("对话模式纠正：取消旧响应、反馈 contested、拒绝迟到音频、纠正后同题可继续", async () => {
  const { directory, store } = await setup();
  let late: ((b: Buffer) => void) | undefined;
  let respondCalls = 0, closeCalls = 0, interrupted = false;
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => "每米是什么意思", close() { closeCalls++; },
    respond: async (_pcm, _instructions, _image, audio, signal) => {
      respondCalls++; late = audio;
      return new Promise<string>((_resolve, reject) => signal?.addEventListener("abort", () => {
        setTimeout(() => { interrupted = true; reject(Error("aborted")); }, 30);
      }, { once: true }));
    } }));
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
    // 第1轮：开放表达 → review，授权后开始教学
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" });
    expect((await wait("transcript")).action).toBe("review");
    send({ type: "authorize", eventId: "auth0", expectedRevision: 0, turnId: "t0", action: "review",
      evidence: { submissionId: "sub0", problemId: "p", problemRevision: 0, boardRevision: 0,
        previewId: await store.saveMedia("s", "pv0", "preview", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64")),
        explanation: "我画了一条线" } });
    await wait("responseStart");
    expect(respondCalls).toBe(1);
    // 纠正：取消旧响应（provider.close），反馈 contested，迟到音频不播出
    const closeBefore = closeCalls;
    send({ type: "authorize", eventId: "correct", expectedRevision: 1, turnId: "t0", action: "correct" });
    const corrected = await wait("corrected");
    expect(closeCalls).toBeGreaterThan(closeBefore); // 取消旧响应关闭了 provider
    expect(corrected.record.feedback[0].contested).toBe(true);
    late?.(Buffer.from("late")); await new Promise(r => setTimeout(r, 30));
    expect(messages.some(e => e.type === "audio" || e.type === "responseDone")).toBe(false);
    // 纠正后同题 dialogue 可继续：conversationMode 仍为 dialogue，新开放表达 → review
    const start1 = messages.length;
    send({ type: "voiceStart", eventId: "s1", expectedRevision: 2, problemId: "p", turnId: "t1" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e1", expectedRevision: 2, problemId: "p", turnId: "t1" });
    expect((await wait("transcript", start1)).action).toBe("review");
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("对话模式暂停：不调用教学、不自动重开麦，回到独立后开放表达归 uncertain", async () => {
  const { directory, store } = await setup();
  const queue = ["我想想，先别说", "我觉得是7.2"];
  let respondCalls = 0;
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => queue.shift()!, close() {},
    respond: async (_pcm, _instructions, _image, audio) => { respondCalls++; audio(Buffer.from("a")); return "好的。"; } }));
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
    // 暂停 → paused，无 transcript，不调用教学
    const start0 = messages.length;
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" });
    await wait("paused", start0);
    expect(messages.slice(start0).some(m => m.type === "transcript")).toBe(false);
    expect(respondCalls).toBe(0); // 暂停不调用教学
    // 暂停后回到独立模式：开放表达归 uncertain，不自动重开麦/给 review
    const start1 = messages.length;
    send({ type: "voiceStart", eventId: "s1", expectedRevision: 0, problemId: "p", turnId: "t1" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e1", expectedRevision: 0, problemId: "p", turnId: "t1" });
    expect((await wait("transcript", start1)).action).toBe("uncertain");
    expect(respondCalls).toBe(0); // 独立模式开放表达不触发教学
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
