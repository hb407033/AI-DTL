import { expect, test, vi } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";
import type { TeachingInput } from "../src/ai/workspace-teaching-decision.js";

test.each([
  { failure: "decisionNeedsReview", interruptDuringRecovery: false },
  { failure: "providerTimeout", interruptDuringRecovery: false },
  { failure: "speechMismatch", interruptDuringRecovery: false },
  { failure: "decisionNeedsReview", interruptDuringRecovery: true },
])("$failure 只终结本轮，同一连接同一道题可继续（恢复中打断=$interruptDuringRecovery）", async ({ failure, interruptDuringRecovery }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-recover-turn-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米彩带2.4元，买0.3米多少钱？", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  const app = Fastify(); await app.register(websocket);
  let gateNextLoad = false;
  let release!: () => void, recoveryLoading!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const loading = new Promise<void>(resolve => { recoveryLoading = resolve; });
  const originalLoad = store.load.bind(store);
  const loadSpy = vi.spyOn(store, "load").mockImplementation(async id => {
    if (gateNextLoad) { gateNextLoad = false; recoveryLoading(); await gate; }
    return originalLoad(id);
  });
  let attempts = 0;
  const inputs: TeachingInput[] = [];
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => "每米是什么意思？", close() {},
    respond: async (_pcm, instructions, _image, audio) => { audio(Buffer.from("a")); return instructions.split("只逐字读这句话：")[1]!.trim(); } }), undefined,
    { decide: async input => {
      inputs.push(input); attempts++;
      if (attempts === 1) {
        gateNextLoad = interruptDuringRecovery;
        if (failure === "providerTimeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        throw Error(failure);
      }
      return { problemId: "p", problemRevision: 0, turnId: input.turnId, responseId: input.responseId, child: input.child,
        focus: "clarify", observation: "孩子问每米含义", evidenceIds: [input.turnId], resolved: [], utterance: "每米就是一米的价钱。", method: "ordinary", handoff: false };
    } }, true);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = [];
  ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const send = (event: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...event }));
  const wait = async (type: string, start = 0) => {
    for (let i = 0; i < 150; i++) {
      const found = messages.slice(start).find(m => m.type === type);
      if (found) return found;
      await new Promise(r => setTimeout(r, 10));
    }
    throw Error(`missing ${type}: ${messages.map(m => m.type).join(",")}`);
  };
  const speak = async (index: number, revision: number) => {
    const start = messages.length;
    send({ type: "voiceStart", eventId: `s${index}`, expectedRevision: revision, problemId: "p", turnId: `t${index}` });
    ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: `e${index}`, expectedRevision: revision, problemId: "p", turnId: `t${index}` });
    await wait("transcript", start);
    send({ type: "authorize", action: "clarify", eventId: `r${index}`, expectedRevision: revision, turnId: `t${index}` });
    return start;
  };
  try {
    await new Promise<void>(resolve => ws.once("open", resolve));
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    const start = await speak(0, 0);
    let error: any;
    if (interruptDuringRecovery) {
      await loading;
      send({ type: "interrupt", turnId: "t0" });
      // pong 是同一连接已消费前一条 interrupt 的屏障，不依赖猜测时间窗。
      const pong = new Promise<void>(resolve => ws.once("pong", () => resolve()));
      ws.ping(); await pong;
      release();
      error = await wait("interrupted", start);
      expect(messages.slice(start).filter(m => m.type === "error")).toEqual([]);
    } else {
      error = await wait("error", start);
      expect(error).toMatchObject({ code: failure, recoverable: true, turnId: "t0", responseId: "r0", record: { sessionId: "s", revision: 1 } });
    }
    expect(error.record.feedback).toEqual([{ responseId: "r0", turnId: "t0", summary: "", contested: true }]);
    expect(messages.slice(start).some(m => ["audio", "responseDone"].includes(m.type))).toBe(false);
    expect(await store.loadTeachingDecisions("s")).toEqual([]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    const next = await speak(1, error.record.revision);
    const done = await wait("responseDone", next);
    expect(done).toMatchObject({ turnId: "t1", responseId: "r1", text: "每米就是一米的价钱。" });
    expect(messages.filter(m => m.type === "ready")).toHaveLength(1);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]!.history).toEqual([]);
    expect((await store.loadTeachingDecisions("s"))).toHaveLength(1);
    // 未经授权的原始音频错误不能被回复恢复白名单吞掉。
    const fatalStart = messages.length; ws.send(Buffer.alloc(3));
    const fatal = await wait("error", fatalStart);
    expect(fatal.code).toBe("invalidPCM"); expect(fatal.recoverable).not.toBe(true);
  } finally { release(); loadSpy.mockRestore(); ws.close(); await app.close(); await rm(directory, { recursive: true }); }
});
