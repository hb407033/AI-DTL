import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildLearningTutor } from "../src/ai/learning-tutor.js";
import { loadQwenConfig } from "../src/ai/config.js";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const root = process.env.AI_DTL_PROBE_DIRECTORY!;
if (!root || !path.isAbsolute(root)) throw Error("absoluteProbeDirectoryRequired");
const directory = await fs.mkdtemp(path.join(root, "store-"));
const store = new WorkspaceStore({ directory });
const app = await buildLearningTutor(loadQwenConfig(), { workspaceStore: store });
app.get<{ Params: { index: string } }>("/fixture/audio/:index", async (request, reply) => {
  if (!/^[0-4]$/u.test(request.params.index)) return reply.code(404).send();
  return reply.type("application/octet-stream").send(await fs.readFile(path.join(root, `${request.params.index}.pcm`)));
});
app.get<{ Params: { sessionId: string } }>("/fixture/verdict/:sessionId", async request => {
  const decisions = await store.loadTeachingDecisions(request.params.sessionId);
  // 孩子给出125÷5=205后先核对计算，不再强制先解释商不变。
  const expected = [["transformation", "invariance", "place_value"], ["place_value"], ["place_value"], ["verify"], ["return"], ["return"]];
  return { valid: decisions.length === expected.length && decisions.every((d, index) => expected[index]!.includes(d.focus))
    && decisions.at(-1)?.handoff === true, focuses: decisions.map(d => d.focus) };
});
const serve = process.argv.includes("--serve");
const address = await app.listen({ host: serve ? "0.0.0.0" : "127.0.0.1", port: serve ? 8797 : 0 });
console.log(JSON.stringify({ address, directory }));
if (!serve) {
  const sessionId = randomUUID(), problemId = randomUUID();
  const initial = { schemaVersion: 2, sessionId, eventId: randomUUID(), revision: 0, phase: "exploring",
    problem: { source: "curated", problemId, challengeId: "division-probe", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数除法" },
      statement: { text: "12.5÷0.5，先估一估，再计算，并检验。", revision: 0, confirmed: true } },
    childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
  await store.save(initial, null);
  const preview = await store.saveMedia(sessionId, randomUUID(), "preview", await fs.readFile(path.join(root, "preview.jpg")));
  const corrected = await store.saveMedia(sessionId, randomUUID(), "preview", await fs.readFile(path.join(root, "corrected.jpg")));
  const turns: any[] = []; let revision = 0, failure: string | undefined;
  let ws: any; let messages: any[] = [];
  const send = (event: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId, ...event }));
  async function wait(type: string, start = 0) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const pending = messages.slice(start), error = pending.find(e => e.type === "error");
      if (error) throw Error(error.code);
      const found = pending.find(e => e.type === type); if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error("timeout:" + type);
  }
  async function connect() {
    messages = []; ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
    ws.on("message", (raw: Buffer) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
  }
  try {
    await connect();
    for (let index = -1; index < 5; index++) {
      // 中途真实重连，验证下一轮仍拿到教学工作记忆，而不是重新估大小。
      if (index === 2) { ws.close(); await new Promise<void>(resolve => ws.once("close", resolve)); await connect(); }
      const start = messages.length, turnId = randomUUID(), began = performance.now();
      const evidence = { submissionId: randomUUID(), problemId, problemRevision: 0, boardRevision: index + 1,
        previewId: index >= 2 ? corrected : preview, explanation: "" };
      let transcript: any;
      if (index === -1) send({ type: "startDiscussion", eventId: randomUUID(), expectedRevision: revision, turnId, evidence });
      else {
        const pcm = await fs.readFile(path.join(root, `${index}.pcm`));
        send({ type: "voiceStart", eventId: randomUUID(), expectedRevision: revision, problemId, turnId });
        for (let offset = 0; offset < pcm.length; offset += 3200) ws.send(pcm.subarray(offset, offset + 3200));
        send({ type: "voiceEnd", eventId: randomUUID(), expectedRevision: revision, problemId, turnId });
        transcript = await wait("transcript", start); evidence.explanation = transcript.text;
        send({ type: "authorize", eventId: randomUUID(), expectedRevision: revision, turnId, action: transcript.action, evidence });
      }
      const done = await wait("responseDone", start); revision = done.record.revision;
      const audio = Buffer.concat(messages.slice(start).filter(e => e.type === "audio").map(e => Buffer.from(e.pcm, "base64")));
      await fs.writeFile(path.join(root, `teacher-${index + 1}.pcm`), audio);
      const decision = (await store.loadTeachingDecisions(sessionId)).at(-1);
      const result = { index, child: transcript?.text, teacher: done.text, decision, audioBytes: audio.length, ms: Math.round(performance.now() - began) };
      turns.push(result); console.log(JSON.stringify(result));
      if (!audio.length || !decision || /乘以?2|乘以?二|倒数|掌握/u.test(done.text)) throw Error("teachingBoundary");
    }
    if (turns.at(-1).decision.focus !== "return") throw Error("missingHandoff");
  } catch (error) { failure = (error as Error).message; process.exitCode = 1; }
  finally {
    ws?.terminate(); await app.close();
    await fs.writeFile(path.join(root, "probe-result.json"), JSON.stringify({ sessionId, directory, failure, turns }, null, 2));
    console.log(JSON.stringify({ failure, sessionId, turns: turns.length }));
  }
}
