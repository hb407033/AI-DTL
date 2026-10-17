import { expect, test } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";

test.each(["dialogue", "independent"] as const)("%s：主动开场有照片、有声音，不伪造孩子的表达；重复不重播", async mode => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-opening-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "2.4 × 0.3 = ?", revision: 0, confirmed: true } }, phase: "exploring",
    childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64");
  const previewId = await store.saveMedia("s", "opening-preview", "preview", png);
  let calls = 0, prompt = "", childText = "我算出7.2";
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({
    transcribe: async () => childText, close() {},
    respond: async (_pcm, instructions, image, audio) => {
      calls++; prompt = instructions;
      if (calls === 1) expect(image).toEqual(png);
      if (calls === 4) { expect(image).toBeUndefined(); expect(_pcm.every(byte => byte === 0)).toBe(true); }
      audio(Buffer.alloc(320, calls === 3 ? 7 : 0));
      if (calls === 3) return "那7.2是怎么来的呢？";
      return instructions.includes("只逐字朗读以下这句话，不添加任何内容：")
        ? instructions.split("只逐字朗读以下这句话，不添加任何内容：")[1]!.split("\n")[0]!
        : "我们先核对一下，你怎样检查这个结果？";
    },
  }));
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (type: string, after = 0) => {
    for (let n = 0; n < 100; n++) { const e = messages.slice(after).find(x => x.type === type); if (e) return e; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}: ${JSON.stringify(messages)}`);
  };
  const send = (e: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...e }));
  const opening = { type: "startDiscussion", turnId: "opening", eventId: "opening-event", expectedRevision: 0,
    evidence: { submissionId: "not-a-child-attempt", problemId: "p", problemRevision: 0, boardRevision: 0, previewId, explanation: "" } };
  try {
    await new Promise<void>(r => ws.once("open", r)); send({ type: "hello", conversationMode: mode }); await wait("ready");
    expect(calls).toBe(0);
    send(opening);
    if (mode === "independent") {
      expect((await wait("error")).code).toBe("notAuthorized"); expect(calls).toBe(0); return;
    }
    const done = await wait("responseDone");
    expect(done.text).toContain("核对"); expect(messages.some(e => e.type === "audio")).toBe(true);
    expect(messages.some(e => e.type === "transcript")).toBe(false);
    expect(done.record.submissions).toEqual([]);
    expect(done.record.feedback).toHaveLength(1);
    expect(prompt).toContain("已写出的解答"); expect(prompt).toContain("不要虚构错误");
    expect(prompt).toContain("多道题"); expect(prompt).toContain("不是孩子的新表达");
    expect(prompt).toContain("不要重读题干");
    send(opening); await new Promise(r => setTimeout(r, 30)); expect(calls).toBe(1);
    const start = messages.length;
    send({ ...opening, eventId: "escalation", expectedRevision: done.record.revision });
    expect((await wait("error", start)).code).toBe("notAuthorized"); expect(calls).toBe(1);
    const next = messages.length;
    send({ type: "voiceStart", eventId: "child-start", expectedRevision: done.record.revision, problemId: "p", turnId: "child-turn" });
    ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "child-end", expectedRevision: done.record.revision, problemId: "p", turnId: "child-turn" });
    expect((await wait("transcript", next)).action).toBe("review");
    send({ type: "authorize", eventId: "child-review", expectedRevision: done.record.revision,
      turnId: "child-turn", action: "review", evidence: { ...opening.evidence, submissionId: "real-child-attempt" } });
    const followed = await wait("responseDone", next);
    expect(followed.record.submissions).toHaveLength(1);
    expect(followed.record.feedback).toHaveLength(2); expect(calls).toBe(2);
    expect(prompt).not.toContain("只逐字朗读以下这句话");
    expect(prompt).toContain("DTL");
    expect(prompt).toContain("重复求助");
    expect(prompt).toContain("不要换词重问上一轮的问题");
    expect(prompt.length).toBeLessThan(6000);
    const context = JSON.parse(prompt.split("\n").at(-1)!);
    expect(context.dialogue).toEqual([{ role: "child", turnId: "child-turn", text: "我算出7.2" }]);
    // 新发现与原图并存时，以新表达为当前焦点，同时保留老师上一问供避免重问。
    childText = "我先把2.4乘3得到7.2，但是0.3比1小，7.2太大了";
    const latest = messages.length;
    send({ type: "voiceStart", eventId: "check-start", expectedRevision: followed.record.revision, problemId: "p", turnId: "check-turn" });
    ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "check-end", expectedRevision: followed.record.revision, problemId: "p", turnId: "check-turn" });
    await wait("transcript", latest);
    send({ type: "authorize", eventId: "check-review", expectedRevision: followed.record.revision,
      turnId: "check-turn", action: "review", evidence: { ...opening.evidence, submissionId: "child-self-check" } });
    await wait("responseDone", latest);
    expect(calls).toBe(4);
    expect(messages.slice(latest).filter(e => e.type === "audio")
      .every(e => !Buffer.from(e.pcm, "base64").equals(Buffer.alloc(320, 7)))).toBe(true);
    const checked = JSON.parse(prompt.split("\n").at(-1)!);
    expect(checked.child).toBe(childText);
    expect(checked.latestExpression.text).toBe(childText);
    expect(checked.dialogue.at(-1)).toMatchObject({ role: "child", turnId: "check-turn", text: childText });
    expect(checked.dialogue.some((entry: any) => entry.role === "teacher" && entry.turnId === "child-turn")).toBe(true);
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
