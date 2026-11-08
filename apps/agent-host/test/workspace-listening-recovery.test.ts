import { expect, test, vi } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";

test("真实WS与存档连续交付20次老师回复，夹入4次转写失败和2次取消，不重复交付", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-twenty-dialogue-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米彩带2.4元，买0.3米多少钱？", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  const app = Fastify(); await app.register(websocket);
  let attempts = 0, active = -1;
  const fail = new Set([2, 7, 12, 18]), interrupt = new Set([5, 9]);
  registerWorkspaceVoice(app, store, () => ({ close() {}, transcribe: async () => {
    active = attempts++;
    if (fail.has(active)) throw Error("connectionClosed");
    return "每米是什么意思？";
  }, respond: async (_pcm, instructions, _image, audio) => {
    audio(Buffer.alloc(4800)); return instructions.split("只逐字读这句话：")[1]!;
  } }), undefined, { decide: async (input, signal) => {
    if (interrupt.has(active)) await new Promise<void>((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(Error("aborted")), { once: true });
    });
    return { problemId: "p", problemRevision: 0, turnId: input.turnId, responseId: input.responseId, child: input.child,
      focus: "clarify", observation: "孩子询问每米含义", evidenceIds: [input.turnId], resolved: [],
      utterance: "每米就是一米的价钱。", method: "ordinary", handoff: false };
  } }, true);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace?voiceRecovery=1");
  const events: any[] = []; ws.on("message", raw => events.push(JSON.parse(raw.toString())));
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  const wait = async (type: string, start = 0) => {
    for (let n = 0; n < 200; n++) {
      const found = events.slice(start).find(e => e.type === type); if (found) return found;
      await new Promise(r => setTimeout(r, 5));
    }
    throw Error("missing " + type);
  };
  let delivered = 0, revision = 0;
  try {
    await new Promise<void>(r => ws.once("open", r)); send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    for (let i = 0; delivered < 20 && i < 26; i++) {
      const start = events.length;
      send({ type: "voiceStart", eventId: `s${i}`, expectedRevision: revision, problemId: "p", turnId: `t${i}` });
      ws.send(Buffer.alloc(3200));
      send({ type: "voiceEnd", eventId: `e${i}`, expectedRevision: revision, problemId: "p", turnId: `t${i}` });
      if (fail.has(i)) { revision = (await wait("error", start)).record.revision; continue; }
      await wait("transcript", start);
      send({ type: "authorize", action: "clarify", eventId: `r${i}`, expectedRevision: revision, turnId: `t${i}` });
      if (interrupt.has(i)) {
        await wait("thinkingStart", start); send({ type: "interrupt", turnId: `t${i}` });
        await wait("interruptAccepted", start); revision = (await wait("interrupted", start)).record.revision;
        expect(events.slice(start).some(e => ["audio", "responseDone"].includes(e.type))).toBe(false);
      } else {
        const done = await wait("responseDone", start); revision = done.record.revision; delivered++;
        expect(done.text).toBe("每米就是一米的价钱。");
        expect(events.slice(start).filter(e => e.type === "responseDone")).toHaveLength(1);
      }
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }
    expect(delivered).toBe(20); expect(attempts).toBe(26);
    expect(events.filter(e => e.type === "ready")).toHaveLength(1);
    // 运行时历史只投影最近12轮；验收持久化数量必须看隔离存档，而不是把投影当全量。
    const saved = JSON.parse(await readFile(path.join(directory, "s.json"), "utf8"));
    expect(saved.teachingDecisions).toHaveLength(20);
    expect(saved.record.feedback.filter((f: { contested: boolean }) => !f.contested)).toHaveLength(20);
    expect(events.filter(e => e.type === "audio")).toHaveLength(20);
    console.info("voiceContinuityAcceptance", { realWebSocket: true, delivered, attempts, transcriptionFailures: 4, interruptions: 2, modelCalls: 0 });
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("voiceStart仍在读取作品时也能取消，不把正常插话误报staleTurn", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-early-interrupt-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米彩带2.4元，买0.3米多少钱？", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => { throw Error("mustNotCallModel"); });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const events: any[] = []; ws.on("message", raw => events.push(JSON.parse(raw.toString())));
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const original = store.load.bind(store);
  try {
    await new Promise<void>(r => ws.once("open", r)); send({ type: "hello", conversationMode: "dialogue" });
    for (let i = 0; i < 100 && !events.some(e => e.type === "ready"); i++) await new Promise(r => setTimeout(r, 5));
    const spy = vi.spyOn(store, "load").mockImplementationOnce(async id => { await gate; return original(id); });
    send({ type: "voiceStart", eventId: "start", expectedRevision: 0, problemId: "p", turnId: "t" });
    send({ type: "interrupt", turnId: "t" });
    for (let i = 0; i < 100 && !events.some(e => ["error", "interruptAccepted"].includes(e.type)); i++) await new Promise(r => setTimeout(r, 5));
    expect(events.find(e => e.type !== "ready")).toMatchObject({ type: "interruptAccepted", turnId: "t" });
    release();
    for (let i = 0; i < 100 && !events.some(e => e.type === "interrupted"); i++) await new Promise(r => setTimeout(r, 5));
    expect(events.some(e => e.type === "interrupted")).toBe(true);
    expect(events.some(e => e.type === "error")).toBe(false);
    spy.mockRestore();
  } finally { release(); ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test.each([true, false])("20轮连续收音：恢复协议声明=%s，旧版不能收到无法处理的恢复消息", async optIn => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-listening-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米彩带2.4元，买0.3米多少钱？", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  const app = Fastify(); await app.register(websocket);
  let transcriptions = 0, release: (() => void) | undefined;
  registerWorkspaceVoice(app, store, () => ({ close() {}, respond: async () => { throw Error("noTeachingExpected"); },
    transcribe: async () => {
      const index = transcriptions++;
      if ([2, 7, 12, 18].includes(index)) throw Error("connectionClosed");
      if (index === 5) await new Promise<void>(resolve => { release = resolve; });
      return index === 15 ? "等一下。" : "";
    } }));
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace" + (optIn ? "?voiceRecovery=1" : ""));
  const messages: any[] = [];
  ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const send = (event: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...event }));
  const wait = async (type: string, start = 0) => {
    for (let n = 0; n < 100; n++) {
      const found = messages.slice(start).find(e => e.type === type); if (found) return found;
      await new Promise(r => setTimeout(r, 5));
    }
    throw Error("missing " + type);
  };
  try {
    await new Promise<void>(r => ws.once("open", r));
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    for (let i = 0; i < 20; i++) {
      const start = messages.length;
      send({ type: "voiceStart", eventId: `s${i}`, expectedRevision: 0, problemId: "p", turnId: `t${i}` });
      ws.send(Buffer.alloc(3200));
      send({ type: "voiceEnd", eventId: `e${i}`, expectedRevision: 0, problemId: "p", turnId: `t${i}` });
      if ([2, 7, 12, 18].includes(i)) {
        const error = await wait("error", start);
        if (optIn) expect(error).toMatchObject({ recoverable: true, stage: "transcription", turnId: `t${i}`, code: "connectionClosed" });
        else { expect(error.recoverable).toBeUndefined(); expect(error.code).toBe("connectionClosed"); }
      } else if (i === 5) {
        for (let n = 0; n < 100 && !release; n++) await new Promise(r => setTimeout(r, 5));
        send({ type: "interrupt", turnId: `t${i}` });
        expect(await wait("interruptAccepted", start)).toMatchObject({ turnId: `t${i}` });
        expect(messages.slice(start).some(e => e.type === "interrupted")).toBe(false);
        release!(); await wait("interrupted", start);
        expect(messages.slice(start).some(e => e.type === "transcript")).toBe(false);
      } else if (i === 15) {
        const paused = await wait("paused", start);
        expect(paused.resumable === true).toBe(optIn);
      } else await wait("transcript", start);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }
    expect(transcriptions).toBe(20);
    expect(messages.filter(e => e.type === "ready")).toHaveLength(1);
    expect((await store.load("s")).status).toBe("ok");
    expect(await store.loadTeachingDecisions("s")).toEqual([]);
  } finally { release?.(); ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
