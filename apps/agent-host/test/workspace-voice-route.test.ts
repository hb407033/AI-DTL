import { expect, test } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";

test.each(["missing", "deleted", "corrupt"])("旧作品续聊：%s 明确报告存档问题，不调用模型或复活记录", async status => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-missing-"));
  const store = new WorkspaceStore({ directory });
  if (status === "deleted") await store.delete("old-work");
  if (status === "corrupt") await writeFile(path.join(directory, "old-work.json"), "broken-json");
  const files = await readdir(directory);
  let acquired = false;
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => { acquired = true; throw Error("mustNotAcquire"); });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  try {
    await new Promise<void>(resolve => ws.once("open", resolve));
    const response = new Promise<any>(resolve => ws.once("message", raw => resolve(JSON.parse(raw.toString()))));
    ws.send(JSON.stringify({ schemaVersion: 2, type: "hello", sessionId: "old-work", conversationMode: "dialogue" }));
    expect(await response).toMatchObject({ type: "error", code: status === "corrupt" ? "recordCorrupt" : "recordMissing" });
    expect(acquired).toBe(false);
    expect(await readdir(directory)).toEqual(files);
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("同一学习连接五轮：表达不教学，授权才回复，纠正落盘且重复授权不重播", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-voice-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米彩带2.4元，买0.3米多少钱？", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  const previousPreview = await store.saveMedia("s", "previous-preview", "preview", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64"));
  const initial = await store.load("s");
  if (initial.status !== "ok") throw Error("fixture missing");
  const seeded = await store.save({ ...initial.record, eventId: "seed", revision: 1, submissions: [
    { submissionId: "previous", problemId: "p", problemRevision: 0, boardRevision: 0, previewId: previousPreview, explanation: "我把一米分成十份" },
  ] }, 0);
  expect(seeded.ok).toBe(true);
  let replies = 0;
  await store.appendInquiry("s", { entryId: "child-question", kind: "question", author: "child",
    text: "为什么买不到一米也能算钱？", evidenceIds: [] }, 0);
  let teachingInstructions = "";
  let scaffoldOffers = 0;
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => "我先想想", close() {},
    respond: async (_pcm, instructions, _image, audio) => { teachingInstructions = instructions; replies++; audio(Buffer.from("audio")); return "每米就是一米的价格。"; } }),
    async (record, submissionId, responseId) => {
      scaffoldOffers++;
      expect(record.feedback.at(-1)?.responseId).toBe(responseId);
      expect(record.submissions.at(-1)?.submissionId).toBe(submissionId);
      return { revision: 1, items: [] };
    });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  let ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = [];
  ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string, after = 0) => {
    for (let n = 0; n < 100; n++) { const found = messages.slice(after).find(e => e.type === type); if (found) return found; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}: ${JSON.stringify(messages)}`);
  };
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  try {
    await new Promise<void>(r => ws.once("open", r)); send({ type: "hello" }); await wait("ready");
    for (let n = 0; n < 5; n++) {
      const start = messages.length;
      send({ type: "voiceStart", eventId: `start-${n}`, expectedRevision: 1, problemId: "p", turnId: `t-${n}` });
      ws.send(Buffer.alloc(3200));
      send({ type: "voiceEnd", eventId: `end-${n}`, expectedRevision: 1, problemId: "p", turnId: `t-${n}` });
      expect((await wait("transcript", start)).action).toBe("uncertain");
    }
    expect(replies).toBe(0);
    const command = { type: "authorize", eventId: "auth", expectedRevision: 1, turnId: "t-4", action: "clarify" };
    send(command); const done = await wait("responseDone");
    expect(done.record.feedback[0].contested).toBe(false);
    expect(done.record.revision).toBe(3);
    const context = JSON.parse(teachingInstructions.split("\n").at(-1)!);
    expect(context.childExpressions).toHaveLength(5);
    expect(context.teacherScaffolds).toEqual([]);
    expect(context.previousWork).toEqual([{ submissionId: "previous", explanation: "我把一米分成十份", source: "previous-submission" }]);
    expect(teachingInstructions).toContain("不代表本轮新表达");
    expect(context.childInquiry).toEqual([{ entryId: "child-question", kind: "question", text: "为什么买不到一米也能算钱？", evidenceIds: [] }]);
    expect(context.childExpressions[0]).toEqual({ turnId: "t-0", text: "我先想想" });
    send(command); await new Promise(r => setTimeout(r, 30)); expect(replies).toBe(1);
    // 恢复连接没有任何新语音，也必须能否认已经保存的反馈。
    ws.close(); await new Promise<void>(r => ws.once("close", () => r()));
    const restoredStart = messages.length;
    ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
    ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>(r => ws.once("open", r)); send({ type: "hello" }); await wait("ready", restoredStart);
    send({ type: "authorize", eventId: "correct", expectedRevision: 3, turnId: "t-4", action: "correct" });
    const corrected = await wait("corrected");
    expect(corrected.record.feedback[0].contested).toBe(true);
    const stored = await store.load("s"); expect(stored.status === "ok" && stored.record.feedback[0]?.contested).toBe(true);
    const invalidStart = messages.length;
    send({ type: "authorize", eventId: "without-evidence", expectedRevision: 4, turnId: "t-4", action: "help" });
    expect((await wait("error", invalidStart)).code).toBe("invalidCommand");
    expect(replies).toBe(1);
    expect(scaffoldOffers).toBe(0);
    const previewId = await store.saveMedia("s", "scaffold-preview", "preview", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64"));
    const helpStart = messages.length;
    send({ type: "voiceStart", eventId: "start-help", expectedRevision: 4, problemId: "p", turnId: "help-turn" });
    ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "end-help", expectedRevision: 4, problemId: "p", turnId: "help-turn" });
    await wait("transcript", helpStart);
    send({ type: "authorize", eventId: "help-authorized", expectedRevision: 4, turnId: "help-turn", action: "help",
      evidence: { submissionId: "help-evidence", problemId: "p", problemRevision: 0, boardRevision: 0, previewId, explanation: "这条线是一米" } });
    await wait("scaffold", helpStart);
    expect(JSON.parse(teachingInstructions.split("\n").at(-1)!).previousWork.map((s: any) => s.submissionId)).toEqual(["previous"]);
    expect(scaffoldOffers).toBe(1);
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("教学中打断不被长响应队列阻塞，纠正后迟到音频被丢弃", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-interrupt-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米2.4元", revision: 0, confirmed: true } }, phase: "exploring", childInkBase64: "",
    board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  let late: ((b: Buffer) => void) | undefined;
  let interrupted = false;
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ transcribe: async () => "每米是什么意思", close() {},
    respond: async (_pcm, _instructions, _image, audio, signal) => {
      late = audio;
      return new Promise<string>((_resolve, reject) => signal?.addEventListener("abort", () => {
        setTimeout(() => { interrupted = true; reject(Error("aborted")); }, 40);
      }, { once: true }));
    } }));
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string) => {
    for (let n = 0; n < 100; n++) { const e = messages.find(x => x.type === type); if (e) return e; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}`);
  };
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  try {
    await new Promise<void>(r => ws.once("open", r)); send({ type: "hello" }); await wait("ready");
    send({ type: "voiceStart", eventId: "start", expectedRevision: 0, problemId: "p", turnId: "t" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "end", expectedRevision: 0, problemId: "p", turnId: "t" }); await wait("transcript");
    send({ type: "authorize", eventId: "auth", expectedRevision: 0, turnId: "t", action: "clarify" }); await wait("responseStart");
    send({ type: "interrupt", turnId: "t" }); await wait("interrupted");
    expect(interrupted, "打断回执必须等待旧操作收尾，之后客户端才能安全保存").toBe(true);
    send({ type: "authorize", eventId: "correct", expectedRevision: 1, turnId: "t", action: "correct" });
    const corrected = await wait("corrected");
    expect(interrupted).toBe(true); expect(corrected.record.feedback[0].contested).toBe(true);
    late?.(Buffer.from("late")); await new Promise(r => setTimeout(r, 20));
    expect(messages.some(e => e.type === "audio" || e.type === "responseDone")).toBe(false);
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
