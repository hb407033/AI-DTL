import { expect, test, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";
import type { TeachingDecision, TeachingDecisionProvider, TeachingInput } from "../src/ai/workspace-teaching-decision.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQBJZv0AAAAASUVORK5CYII=", "base64");

function makeDecision(input: TeachingInput): TeachingDecision {
  return {
    problemId: input.record.problem!.problemId, problemRevision: input.record.problem!.statement.revision,
    turnId: input.turnId, responseId: input.responseId, child: input.child.slice(0, 1000),
    focus: "clarify", observation: "孩子问含义", evidenceIds: [input.turnId],
    resolved: [], utterance: "每米就是一米的价钱。", method: "ordinary", handoff: false,
  };
}

async function setup(thinkingMode: boolean, decideImpl?: (input: TeachingInput, signal?: AbortSignal, onDraft?: (d: TeachingDecision) => void) => Promise<TeachingDecision>,
  onSpeech?: (instructions: string, image: Buffer | undefined) => void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-thinking-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
    statement: { text: "每米彩带2.4元，买0.3米多少钱？", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  const previewId = await store.saveMedia("s", "pv0", "preview", PNG);
  const app = Fastify(); await app.register(websocket);
  const provider: TeachingDecisionProvider = { decide: decideImpl ?? (async (input) => makeDecision(input)) };
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => "每米是什么意思？", close() {},
    respond: async (_p, instructions, _img, audio) => {
      onSpeech?.(instructions, _img);
      const match = instructions.match(/只逐字读这句话：(.+)/s);
      const text = match ? match[1]!.trim() : "每米就是一米的价钱。";
      audio(Buffer.from(text)); return text;
    } }),
    undefined, provider, thinkingMode);
  return { directory, app, store, previewId };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

async function authorizeReview(connection: Awaited<ReturnType<typeof connect>>, previewId: string) {
  const { ws, send, wait } = connection;
  send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
  send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
  send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" }); await wait("transcript");
  send({ type: "authorize", action: "review", eventId: "e1", expectedRevision: 0, turnId: "t0",
    evidence: { submissionId: "sub0", problemId: "p", problemRevision: 0, boardRevision: 0, previewId, explanation: "我画了线" } });
}

test("主动取消立即终结思考一次，忽略不响应 abort 的迟到决策", async () => {
  const release = deferred<void>();
  const { directory, app, store, previewId } = await setup(true, async input => { await release.promise; return makeDecision(input); });
  const connection = await connect(app);
  try {
    await authorizeReview(connection, previewId);
    await connection.wait("thinkingStart");
    connection.send({ type: "interrupt", turnId: "t0" });
    const cancelled = await connection.wait("thinkingCancel");
    expect(cancelled).toMatchObject({ turnId: "t0", responseId: "e1" });
    release.resolve(); await connection.wait("interrupted");
    expect(connection.messages.filter(m => m.type === "thinkingCancel")).toHaveLength(1);
    expect(connection.messages.some(m => ["thinkingEnd", "audio", "responseDone"].includes(m.type))).toBe(false);
    expect(await store.loadTeachingDecisions("s")).toHaveLength(0);
  } finally { release.resolve(); connection.ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});

test("取消发生在播报后重读作品期间，不能保存有效反馈或决策", async () => {
  const paused = deferred<void>(), release = deferred<void>(), cancelled = deferred<void>();
  let holdNextLoad = false;
  const { directory, app, store, previewId } = await setup(true, async (input, signal) => {
    signal?.addEventListener("abort", () => cancelled.resolve(), { once: true }); return makeDecision(input);
  }, () => { holdNextLoad = true; });
  const originalLoad = store.load.bind(store);
  const spy = vi.spyOn(store, "load").mockImplementation(async id => {
    if (holdNextLoad) { holdNextLoad = false; paused.resolve(); await release.promise; }
    return originalLoad(id);
  });
  const connection = await connect(app);
  try {
    await authorizeReview(connection, previewId); await paused.promise;
    connection.send({ type: "interrupt", turnId: "t0" });
    await cancelled.promise;
    release.resolve(); await connection.wait("interrupted");
    const loaded = await store.load("s");
    expect(loaded.status).toBe("ok");
    if (loaded.status === "ok") expect(loaded.record.feedback.every(f => f.contested && !f.summary)).toBe(true);
    expect(await store.loadTeachingDecisions("s")).toHaveLength(0);
    expect(connection.messages.some(m => ["audio", "responseDone"].includes(m.type))).toBe(false);
  } finally { release.resolve(); spy.mockRestore(); connection.ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});

test("真实路由保存内部决策摘要，但私有标记不进入客户端载荷和播报", async () => {
  const marker = "PRIVATE_ANALYSIS_SENTINEL";
  const speech: string[] = [];
  const { directory, app, store, previewId } = await setup(true, async input => ({ ...makeDecision(input), analysis: marker }),
    (instructions, image) => { speech.push(instructions); expect(image).toBeUndefined(); });
  const connection = await connect(app);
  try {
    await authorizeReview(connection, previewId); await connection.wait("responseDone");
    expect((await store.loadTeachingDecisions("s"))[0]?.analysis).toBe(marker);
    expect(speech).toHaveLength(1);
    expect(speech.join("\n")).not.toContain(marker);
    expect(JSON.stringify(connection.messages)).not.toContain(marker);
    expect(JSON.stringify((await store.load("s")))).not.toContain(marker);
  } finally { connection.ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});

async function connect(app: FastifyInstance) {
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string, start = 0) => {
    for (let i = 0; i < 100; i++) { const m = messages.slice(start).find(m => m.type === type); if (m) return m; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}: ${JSON.stringify(messages.map(m => m.type))}`);
  };
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  await new Promise<void>(r => ws.once("open", r));
  return { ws, messages, wait, send };
}

test("thinkingMode 发出 thinkingStart 和 thinkingEnd 事件", async () => {
  const { directory, app, previewId } = await setup(true);
  const { ws, messages, wait, send } = await connect(app);
  try {
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" });
    await wait("transcript");
    const start = messages.length;
    send({ type: "authorize", action: "review", eventId: "e1", expectedRevision: 0, turnId: "t0",
      evidence: { submissionId: "sub0", problemId: "p", problemRevision: 0, boardRevision: 0, previewId, explanation: "我画了线" } });
    await wait("thinkingStart", start);
    await wait("thinkingEnd", start);
    await wait("responseDone", start);
    const types = messages.slice(start).map(m => m.type);
    expect(types.indexOf("thinkingStart")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("thinkingEnd")).toBeGreaterThan(types.indexOf("thinkingStart"));
  } finally { ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});

test("开场把本轮冻结的过程事实交给决策层，不伪造开场孩子表达", async () => {
  const inputs: TeachingInput[] = [];
  const { directory, app, previewId } = await setup(true, async input => { inputs.push(input); return {
    ...makeDecision(input), utterance: "你想先从哪里试试？", evidenceIds: [input.turnId],
  }; });
  const connection = await connect(app);
  const facts = { eraseCount: 1, longestPauseMs: 2400, strokeOrder: ["erase:st-a", "stroke:st-b"] };
  try {
    connection.send({ type: "hello", conversationMode: "dialogue" }); await connection.wait("ready");
    connection.send({ type: "startDiscussion", eventId: "opening", expectedRevision: 0, turnId: "opening-turn",
      evidence: { submissionId: "opening-sub", problemId: "p", problemRevision: 0, boardRevision: 0,
        previewId, explanation: "", processSignal: facts } });
    await connection.wait("responseDone");
    expect(inputs[0]?.processSignal).toEqual(facts);
    expect(inputs[0]?.child).toBe("");
  } finally { connection.ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});

test("thinkingMode 决策失败时发出 thinkingCancel", async () => {
  const { directory, app, previewId } = await setup(true, async () => { throw Error("decisionNeedsReview"); });
  const { ws, messages, wait, send } = await connect(app);
  try {
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" });
    await wait("transcript");
    const start = messages.length;
    send({ type: "authorize", action: "review", eventId: "e1", expectedRevision: 0, turnId: "t0",
      evidence: { submissionId: "sub0", problemId: "p", problemRevision: 0, boardRevision: 0, previewId, explanation: "我画了线" } });
    await wait("thinkingStart", start);
    await wait("thinkingCancel", start);
  } finally { ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});

test("非 thinkingMode 不发出思考态事件", async () => {
  const { directory, app, previewId } = await setup(false);
  const { ws, messages, wait, send } = await connect(app);
  try {
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" });
    await wait("transcript");
    const start = messages.length;
    send({ type: "authorize", action: "review", eventId: "e1", expectedRevision: 0, turnId: "t0",
      evidence: { submissionId: "sub0", problemId: "p", problemRevision: 0, boardRevision: 0, previewId, explanation: "我画了线" } });
    await wait("responseDone", start);
    expect(messages.slice(start).some(m => m.type === "thinkingStart")).toBe(false);
  } finally { ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});

test("复核期间提前合成草稿语音；终稿与草稿相同则复用，只合成一次", async () => {
  const speechStarted = deferred<void>();
  const spoken: string[] = [];
  const { directory, app, previewId } = await setup(false, async (input, _signal, onDraft) => {
    const draft = makeDecision(input);
    onDraft?.(draft);
    await speechStarted.promise; // 模拟语义复核耗时：复核结束前语音已开始合成
    return draft;
  }, instructions => { spoken.push(instructions); speechStarted.resolve(); });
  const connection = await connect(app);
  try {
    const start = connection.messages.length;
    await authorizeReview(connection, previewId);
    await connection.wait("responseDone", start);
    const audio = connection.messages.slice(start).filter(m => m.type === "audio");
    expect(audio.map(m => Buffer.from(m.pcm, "base64").toString())).toEqual(["每米就是一米的价钱。"]);
    expect(spoken).toHaveLength(1);
  } finally { connection.ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});

test("复核后终稿改了，丢弃草稿语音，只播终稿", async () => {
  const speechStarted = deferred<void>();
  const spoken: string[] = [];
  const { directory, app, previewId } = await setup(false, async (input, _signal, onDraft) => {
    onDraft?.({ ...makeDecision(input), utterance: "草稿这句不该播出来。" });
    await speechStarted.promise;
    return makeDecision(input);
  }, instructions => { spoken.push(instructions); speechStarted.resolve(); });
  const connection = await connect(app);
  try {
    const start = connection.messages.length;
    await authorizeReview(connection, previewId);
    await connection.wait("responseDone", start);
    const audio = connection.messages.slice(start).filter(m => m.type === "audio");
    expect(audio.map(m => Buffer.from(m.pcm, "base64").toString())).toEqual(["每米就是一米的价钱。"]);
    expect(spoken).toHaveLength(2);
  } finally { connection.ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});
