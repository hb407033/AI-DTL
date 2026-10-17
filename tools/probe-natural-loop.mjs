// 合成输入 + 真实千问 + 真实路由/存储；不替代 iPad 麦克风、扬声器和 Pencil 验收。
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { WorkspaceStore } from "../apps/agent-host/src/learning/workspace-store.ts";
import { registerWorkspaceVoice } from "../apps/agent-host/src/ai/workspace-voice-route.ts";
import { WorkspaceVoiceProvider } from "../apps/agent-host/src/ai/workspace-voice-provider.ts";
import { loadQwenConfig } from "../apps/agent-host/src/ai/config.ts";
const require = createRequire(new URL("../apps/agent-host/package.json", import.meta.url));
const Fastify = require("fastify"), websocket = require("@fastify/websocket"), WebSocket = require("ws");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dtl-real-loop-"));
const store = new WorkspaceStore({ directory });
const sessionId = randomUUID(), problemId = randomUUID();
await store.save({ schemaVersion: 2, sessionId, eventId: randomUUID(), revision: 0,
  problem: { source: "curated", problemId, challengeId: "synthetic-ribbon", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
    statement: { text: "每米彩带2.4元，买0.3米需要多少元？", revision: 0, confirmed: true } },
  phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] },
  submissions: [], feedback: [], openQuestions: [] }, null);
const image = await fs.readFile(new URL("../docs/handoffs/evidence/2026-09-21-natural-loop/6cb4a11f-55b5-4cdc-9980-69ff19bc303e.jpg", import.meta.url));
const withInquiry = process.argv.includes("--with-inquiry");
if (withInquiry) await store.appendInquiry(sessionId, { entryId: randomUUID(), kind: "representation", author: "child",
  text: "我画的长线代表一米彩带，短的部分代表买的0.3米。", evidenceIds: [] }, 0);
const app = Fastify(); await app.register(websocket);
registerWorkspaceVoice(app, store, () => new WorkspaceVoiceProvider(loadQwenConfig()));
const address = await app.listen({ host: "127.0.0.1", port: 0 });
const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
const messages = [], turns = [];
ws.on("message", raw => messages.push({ ...JSON.parse(raw.toString()), receivedMs: performance.now() }));
const send = event => ws.send(JSON.stringify({ schemaVersion: 2, sessionId, ...event }));
async function wait(type, start) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const error = messages.slice(start).find(m => m.type === "error");
    if (error) throw Error(error.code);
    const found = messages.slice(start).find(m => m.type === type); if (found) return found;
    await new Promise(r => setTimeout(r, 10));
  }
  throw Error(`missing ${type}`);
}
let failure;
try {
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  send({ type: "hello" }); await wait("ready", 0);
  let revision = 0;
  for (let index = 0; index < 5; index++) {
    const start = messages.length, started = performance.now(), turnId = randomUUID();
    send({ type: "voiceStart", eventId: randomUUID(), expectedRevision: revision, problemId, turnId });
    const pcm = await fs.readFile(`/tmp/ai-dtl-natural-loop-audio/${index}.pcm`);
    for (let offset = 0; offset < pcm.length; offset += 3200) ws.send(pcm.subarray(offset, offset + 3200));
    send({ type: "voiceEnd", eventId: randomUUID(), expectedRevision: revision, problemId, turnId });
    const transcript = await wait("transcript", start);
    const expected = ["uncertain", "review", "review", "uncertain", "review"][index];
    if (transcript.action !== expected) throw Error(`unexpected action at ${index}`);
    const sample = { index, text: transcript.text, action: transcript.action,
      transcriptMs: Math.round(transcript.receivedMs - started) };
    if (expected === "review") {
      const previewId = await store.saveMedia(sessionId, randomUUID(), "preview", image);
      send({ type: "authorize", eventId: randomUUID(), expectedRevision: revision, turnId, action: "review",
        evidence: { submissionId: randomUUID(), problemId, problemRevision: 0, boardRevision: 0, previewId, explanation: transcript.text } });
      const done = await wait("responseDone", start);
      revision = done.record.revision;
      const audio = messages.slice(start).filter(m => m.type === "audio");
      if (!audio.length || !done.text) throw Error("missing audio/text");
      Object.assign(sample, { teacher: done.text, firstAudioMs: Math.round(audio[0].receivedMs - started),
        totalMs: Math.round(done.receivedMs - started), audioBytes: audio.reduce((sum, m) => sum + Buffer.from(m.pcm, "base64").length, 0) });
    }
    turns.push(sample);
  }
} catch (error) { failure = error.message; }
finally {
  ws.terminate(); await app.close();
  const result = { directory, sessionId, withInquiry, failure, turns, stored: await store.load(sessionId), inquiry: await store.loadInquiry(sessionId) };
  await fs.writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
if (failure) process.exitCode = 1;
