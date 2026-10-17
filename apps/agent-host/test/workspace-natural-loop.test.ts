import { expect, test } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";

test.each([false, true])("真实路由：自然接续收尾检查，重试仍无效=%s", async (rejectBoth) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "natural-loop-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "每米2.4元，0.3米多少钱", revision: 0, confirmed: true } },
    phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  const previewId = await store.saveMedia("s", "media", "preview", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZa8AAAAASUVORK5CYII=", "base64"));
  const spoken = ["我想用线表示彩带", "看看我的想法", "这条线是一米", "我算出7.2", "看看我的想法"];
  let calls = 0; const prompts: string[] = [];
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => {
    let transcribed = false;
    return { transcribe: async () => { transcribed = true; return spoken.shift()!; }, close() {},
    respond: async (_pcm, instructions, _image, audio) => {
      expect(transcribed, "教师调用不携带内部转写响应和旧图像会话").toBe(false);
      prompts.push(instructions); calls++; audio(Buffer.from(`audio${calls}`));
      if (calls === 3) {
        expect(_pcm.every(byte => byte === 0)).toBe(true);
        expect(instructions).toContain("只逐字朗读");
        return rejectBoth ? "那下一步怎么算呢？" : "我听到了，接着按你的想法试试吧。";
      }
      if (calls >= 4) {
        expect(_pcm.every(byte => byte === 0), "播报选定问题不再次回答原录音").toBe(true);
        expect(_image).toBeUndefined();
        expect(instructions).toContain("你是怎么得到这个结果的？");
        return calls === 4 ? "题目中的2.4怎么来的？" : "你是怎么得到这个结果的？";
      }
      return calls === 1 ? "线代表多长？" : calls === 2 || rejectBoth ? "那下一步怎么算呢？" : "你说明了一米，可以继续自己的尝试。";
    } };
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string, start: number) => {
    for (let i = 0; i < 100; i++) { const m = messages.slice(start).find(m => m.type === type); if (m) return m; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}: ${JSON.stringify(messages.slice(start))}`);
  };
  const send = (event: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...event }));
  try {
    await new Promise<void>(r => ws.once("open", r)); send({ type: "hello" }); await wait("ready", 0);
    let revision = 0;
    for (let n = 0; n < 5; n++) {
      const start = messages.length;
      send({ type: "voiceStart", eventId: `start${n}`, expectedRevision: revision, problemId: "p", turnId: `t${n}` });
      ws.send(Buffer.alloc(3200));
      send({ type: "voiceEnd", eventId: `end${n}`, expectedRevision: revision, problemId: "p", turnId: `t${n}` });
      const transcript = await wait("transcript", start);
      expect(transcript.action).toBe([1, 2, 4].includes(n) ? "review" : "uncertain");
      expect(transcript.continuation).toBe(n === 2);
      if (transcript.action === "review") {
        send({ type: "authorize", eventId: `auth${n}`, expectedRevision: revision, turnId: `t${n}`, action: "review",
          evidence: { submissionId: `sub${n}`, problemId: "p", problemRevision: 0, boardRevision: n, previewId, explanation: transcript.text } });
        if (n === 2 && rejectBoth) {
          expect((await wait("error", start)).code).toBe("replyNeedsReview");
          break;
        }
        revision = (await wait("responseDone", start)).record.revision;
      }
    }
    expect(calls).toBe(rejectBoth ? 3 : 5);
    expect(messages.filter(m => m.type === "audio").map(m => Buffer.from(m.pcm, "base64").toString())).toEqual(rejectBoth ? ["audio1"] : ["audio1", "audio3", "audio5"]);
    expect(prompts[1]).toContain("不再追问");
    expect(prompts[0]).toContain("不要把孩子已经说出的关系改成‘对吗’让他重复确认");
    expect(prompts[0]).toContain("孩子已给出计算结果时，只选‘这个结果的理由’或‘如何检验结果’");
    expect(prompts[1]).toContain("这条线是一米");
    expect(JSON.parse(prompts[0]!.split("\n").at(-1)!).latestExpression.text).toBe("我想用线表示彩带");
    expect(JSON.parse(prompts[1]!.split("\n").at(-1)!).latestExpression.text).toBe("这条线是一米");
    const stored = await store.load("s");
    expect(stored.status === "ok" && stored.record.submissions[1]?.explanation).toContain("这条线是一米");
    expect(stored.status === "ok" && stored.record.submissions[1]?.explanation).toContain("我想用线表示彩带");
    expect(stored.status === "ok" && stored.record.feedback[1]?.contested).toBe(rejectBoth);
    if (!rejectBoth) {
      expect(stored.status === "ok" && stored.record.feedback[2]?.summary).toBe("你是怎么得到这个结果的？");
      expect(stored.status === "ok" && stored.record.submissions[2]?.explanation).toContain("我算出7.2");
    }
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
