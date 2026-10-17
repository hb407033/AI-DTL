import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";
import { validateTeachingDecision, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";

test("口头纠正后面的解释同轮得到回应；按钮式异议不擅自启动教学", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dtl-correction-reaction-"));
  const store = new WorkspaceStore({ directory });
  await store.save({ schemaVersion: 2, sessionId: "s", eventId: "init", revision: 0,
    problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数除法" },
      statement: { text: "12.5÷0.5", revision: 0, confirmed: true } }, phase: "exploring",
    childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [],
    feedback: [{ responseId: "old", turnId: "old-t", summary: "老师的上轮误解", contested: false }], openQuestions: [] }, null);
  const app = Fastify(); await app.register(websocket);
  const inputs: TeachingInput[] = [];
  registerWorkspaceVoice(app, store, () => ({ close() {},
    transcribe: async () => "你理解错了，我说的是小数十二点五，不是日期。",
    respond: async (_pcm, instructions, _image, audio) => { audio(Buffer.from("speech")); return instructions.split("只逐字读这句话：")[1]!; },
  }), undefined, { decide: async input => {
    inputs.push(input);
    return validateTeachingDecision({ focus: "clarify", observation: "孩子纠正小数与日期的区别", evidenceIds: [input.turnId],
      utterance: "是十二点五这个小数，不是日期。我们按你说的数继续。", method: "scale_both", handoff: false }, input);
  } });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = [];
  ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const send = (event: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...event }));
  async function wait(type: string, start = 0) {
    for (let n = 0; n < 100; n++) {
      const events = messages.slice(start), error = events.find(e => e.type === "error");
      if (error) throw Error(error.code);
      const found = events.find(e => e.type === type); if (found) return found;
      await new Promise(r => setTimeout(r, 10));
    }
    throw Error("missing:" + type);
  }
  try {
    await new Promise<void>(resolve => ws.once("open", resolve));
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    send({ type: "voiceStart", eventId: "start", expectedRevision: 0, problemId: "p", turnId: "t" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "end", expectedRevision: 0, problemId: "p", turnId: "t" });
    expect((await wait("transcript")).action).toBe("correct");
    send({ type: "authorize", eventId: "correction", expectedRevision: 0, turnId: "t", action: "correct" });
    const corrected = await wait("corrected"); expect(corrected.record.feedback[0].contested).toBe(true);
    const done = await wait("responseDone");
    expect(inputs[0]!.child).toContain("不是日期");
    expect(done.record.feedback).toHaveLength(2);
    expect((await store.loadTeachingDecisions("s"))[0]!.child).toContain("不是日期");
    const start = messages.length;
    send({ type: "authorize", eventId: "button-correction", expectedRevision: done.record.revision, turnId: "t", action: "correct" });
    await wait("corrected", start);
    await new Promise(r => setTimeout(r, 30));
    expect(inputs).toHaveLength(1);
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
