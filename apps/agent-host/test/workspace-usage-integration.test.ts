import { expect, test } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";
import { appendUsageJsonl } from "../src/ai/workspace-usage.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64");

test("实际路由 usage.jsonl：非空 sessionId/turnId/callId 关联，缺 usage≠0", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-usage-int-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米2.4元，0.3米多少钱", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  const usageJsonl = path.join(directory, "usage.jsonl");
  const app = Fastify(); await app.register(websocket);
  // mock provider：接收路由传入的 context，发 onUsage 写 JSONL（模拟真实 provider 行为）
  registerWorkspaceVoice(app, store, () => {
    return {
      transcribe: async (_pcm, _signal, ctx) => {
        if (ctx) await appendUsageJsonl(usageJsonl, { sessionId: ctx.sessionId, turnId: ctx.turnId, callId: randomUUID(),
          purpose: "transcription", model: "test-model", status: "completed", usage: null, estimatedCostCny: null });
        return "我觉得是7.2";
      },
      respond: async (_pcm, _instructions, _image, audio, _signal, ctx) => {
        audio(Buffer.from("a"));
        if (ctx) await appendUsageJsonl(usageJsonl, { sessionId: ctx.sessionId, turnId: ctx.turnId, callId: randomUUID(),
          responseId: randomUUID(), purpose: "teaching", model: "test-model", status: "completed",
          usage: { input_tokens: 10, output_tokens: 5 }, estimatedCostCny: null });
        return "你是怎么想的？";
      },
      close() {},
    };
  });
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
    send({ type: "voiceStart", eventId: "s0", expectedRevision: 0, problemId: "p", turnId: "t0" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "e0", expectedRevision: 0, problemId: "p", turnId: "t0" });
    await wait("transcript");
    send({ type: "authorize", eventId: "auth0", expectedRevision: 0, turnId: "t0", action: "review",
      evidence: { submissionId: "sub0", problemId: "p", problemRevision: 0, boardRevision: 0,
        previewId: await store.saveMedia("s", "pv0", "preview", PNG), explanation: "我画了线" } });
    await wait("responseDone");
    // 读 JSONL：每行非空关联
    const content = await readFile(usageJsonl, "utf8");
    const lines = content.trim().split("\n").map(l => JSON.parse(l));
    expect(lines.length).toBeGreaterThanOrEqual(2); // 至少 transcription + teaching
    for (const line of lines) {
      expect(line.sessionId).toBe("s"); // 非空，关联到真实 session
      expect(line.turnId).toBe("t0"); // 非空，关联到真实 turn
      expect(line.callId).toBeTruthy(); // 非空 callId
      expect(line.model).toBe("test-model");
    }
    const teaching = lines.find((l: any) => l.purpose === "teaching");
    expect(teaching.usage).toEqual({ input_tokens: 10, output_tokens: 5 }); // 有 usage
    const transcription = lines.find((l: any) => l.purpose === "transcription");
    expect(transcription.usage).toBeNull(); // ASR-only usage=null，不记 0
    expect(transcription.estimatedCostCny).toBeNull(); // 收费未知 null
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
