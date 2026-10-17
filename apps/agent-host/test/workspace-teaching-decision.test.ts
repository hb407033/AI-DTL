import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";
import { validateTeachingDecision, buildDecisionPrompt, mathSpeech, speakDecision, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";

const record: WorkspaceRecord = { schemaVersion: 2, sessionId: "s", eventId: "initial", revision: 0,
  problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
    statement: { text: "12.5÷0.5，先估，再计算。", revision: 0, confirmed: true } },
  phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
const input: TeachingInput = { record, turnId: "t", responseId: "r", permission: "review",
  child: "我把12.5和0.5同时乘10，写成125除以5，算出205。", imageId: "preview", history: [] };
const plan = { focus: "place_value", observation: "孩子给出整数式，但商比被除数还大", evidenceIds: ["t"],
  resolved: [], utterance: "125除以5，每份会比125还大吗？", method: "scale_both", handoff: false };

test("决策读取完整上下文及小数除法课程，不继承错误的小数乘法单元", () => {
  const prompt = buildDecisionPrompt(input);
  expect(prompt).toContain("商不变"); expect(prompt).toContain("小数除法");
  expect(prompt).toContain("125÷5"); expect(prompt).toContain("同一倍数");
  expect(prompt).toContain(input.child); expect(prompt).toContain("未解决");
  expect(validateTeachingDecision(plan, input).focus).toBe("place_value");
});

test("不能把越级乘2、抢答25、掌握标签或不存在的证据交给语音", () => {
  for (const change of [
    { utterance: "除以0.5就是乘2，你试试。" },
    { utterance: "12.5乘2等于25。" },
    { utterance: "答案是25。" },
    { utterance: "你已经掌握了。" },
    { evidenceIds: ["invented"] },
    { method: "reciprocal" },
    { handoff: true },
  ]) expect(() => validateTeachingDecision({ ...plan, ...change }, input)).toThrow();
  expect(validateTeachingDecision({ ...plan, focus: "verify", utterance: "你得到了25，想怎样检验？" },
    { ...input, child: "我重新算出25。", history: [{ ...validateTeachingDecision(plan, input),
      child: "总量和每一组都扩大十倍，能分的组数没变，所以商不变。" }] }).focus).toBe("verify");
});

test("已经解决的理由不机械重问，正确检验后交还独立尝试，不宣布掌握", () => {
  const previous = { ...validateTeachingDecision(plan, input), turnId: "prior", responseId: "prior-r",
    child: "总量和每一组都扩大十倍，能分的组数没变，所以商不变。" };
  expect(() => validateTeachingDecision({ ...plan, resolved: ["invariance"] }, { ...input, history: [previous] })).toThrow();
  const done = validateTeachingDecision({ ...plan, focus: "return", resolved: ["invariance", "place_value", "verify"],
    utterance: "你用乘法核对了结果。接下来自己试一道同类题吧。", handoff: true },
    { ...input, history: [previous], child: "25乘0.5等于12.5，乘回去正好是被除数。" });
  expect(done.handoff).toBe(true);
});

test("模型不能把商不变理由伪造为数位检查完成，也不能换词重复旧问", () => {
  const reasoning = { ...input, history: [validateTeachingDecision(plan, input)],
    child: "总量和每一组都扩大十倍，能分的组数没变，所以商不变。" };
  expect(() => validateTeachingDecision({ ...plan, focus: "verify", resolved: ["place_value"],
    utterance: "转化是对的，这个结果对吗？" }, reasoning)).toThrow();
  const decision = validateTeachingDecision({ ...plan, focus: "place_value", resolved: ["place_value"],
    utterance: "商里的2表示几个十，还是几个百？" }, reasoning);
  expect(decision.resolved).toContain("invariance"); expect(decision.resolved).not.toContain("place_value");
  const explained = { ...input, history: [decision], child: "我中间多写了一个零，商应该是二十五。" };
  expect(() => validateTeachingDecision({ ...plan, focus: "invariance", utterance: "能再说说商为什么不变吗？" }, explained)).toThrow();
});

test("review邀请孩子自行选检验方法，不借检查直接告诉下一步；求助才给一处提示", () => {
  const history = [{ ...validateTeachingDecision(plan, input), child: "总量和每一组都扩大十倍，能分的组数没变，所以商不变。" }];
  const current = { ...input, history, child: "我自己改成二十五了。" };
  const suggested = { ...plan, focus: "verify", utterance: "现在用25乘0.5，看能不能回到12.5？" };
  expect(() => validateTeachingDecision(suggested, current)).toThrow();
  expect(validateTeachingDecision(suggested, { ...current, permission: "hint" }).focus).toBe("verify");
});

test("播报数学读音明确，不把十二点五当日期；拒绝擅自续写后不发任何音频", async () => {
  expect(mathSpeech("12.5÷0.5=125÷5，同时乘10。"))
    .toBe("十二点五除以零点五等于一百二十五除以五，同时乘十。");
  const approved = validateTeachingDecision(plan, input); const emitted: Buffer[] = [];
  const speech = { close() {}, transcribe: async () => "", respond: async (_p: Buffer, instructions: string, image: Buffer | undefined, audio: (b: Buffer) => void) => {
    expect(image).toBeUndefined(); expect(instructions).not.toContain(input.child);
    audio(Buffer.from("bad")); return "答案是25。";
  } };
  await expect(speakDecision(approved, () => speech, b => emitted.push(b))).rejects.toThrow("speechMismatch");
  expect(emitted).toHaveLength(0);
});

test("决策与反馈原子保存，重连恢复；异议/换题排除，删除不留下决策", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dtl-decision-"));
  const store = new WorkspaceStore({ directory });
  try {
    await store.save(record, null);
    const decision = validateTeachingDecision(plan, input);
    expect(await store.save({ ...record, eventId: "invalid", revision: 1 }, 0, decision)).toEqual({ ok: false, reason: "invalidDecision" });
    const next = { ...record, eventId: "finished", revision: 1,
      feedback: [{ responseId: "r", turnId: "t", summary: decision.utterance, contested: false }] };
    expect((await store.save(next, 0, decision)).ok).toBe(true);
    const reopened = new WorkspaceStore({ directory });
    expect(await reopened.loadTeachingDecisions("s")).toHaveLength(1);
    expect((await reopened.save(next, 0, decision)).ok).toBe(true);
    expect(await reopened.loadTeachingDecisions("s")).toHaveLength(1);
    await reopened.save({ ...next, eventId: "correct", revision: 2, feedback: [{ ...next.feedback[0]!, contested: true }] }, 1);
    expect(await reopened.loadTeachingDecisions("s")).toHaveLength(0);
    await reopened.delete("s");
    await expect(reopened.loadTeachingDecisions("s")).rejects.toThrow("missing");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("实际WS路由先决策再纯播报；重连接续焦点，重放不再次调用，语音无权自由解题", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dtl-decision-ws-"));
  const store = new WorkspaceStore({ directory }); await store.save(record, null);
  const previewId = await store.saveMedia("s", "preview", "preview", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64"));
  let planned = 0, spoken = 0; const histories: number[] = [];
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ close() {}, transcribe: async () => "总量和每一组都扩大十倍，能分的组数没变，所以商不变。",
    respond: async (pcm, instructions, image, audio) => {
      spoken++; expect(image).toBeUndefined(); expect(pcm.equals(Buffer.alloc(6400))).toBe(true);
      expect(instructions).not.toContain("两个数扩大同样倍数");
      audio(Buffer.from("approved")); return instructions.split("只逐字读这句话：")[1]!;
    } }), undefined, { decide: async input => {
      planned++; histories.push(input.history.length);
      return validateTeachingDecision({ ...plan, evidenceIds: [input.turnId],
        ...(planned > 1 ? { focus: "place_value", resolved: ["invariance"], utterance: "你解释了商不变，试着算125÷5，说说商的数位。" }
          // 开场不预设“扩大”等算法（openingPrescribesStructure），这里只测路由。
          : { focus: "invariance", utterance: input.child.trim() ? "两个数同时扩大时，分的组数怎样变化？" : "这道题你准备怎么想？" }) }, input);
    } });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  let ws: WebSocket; let messages: any[] = [];
  const send = (event: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...event }));
  const wait = async (type: string, start = 0) => {
    for (let count = 0; count < 100; count++) {
      const events = messages.slice(start); const error = events.find(e => e.type === "error"); if (error) throw Error(error.code);
      const event = events.find(e => e.type === type); if (event) return event;
      await new Promise(r => setTimeout(r, 10));
    }
    throw Error("missing:" + type);
  };
  const connect = async () => {
    messages = []; ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
    ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>(resolve => ws.once("open", resolve));
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
  };
  try {
    await connect();
    const opening = { type: "startDiscussion", eventId: "r0", turnId: "t0", expectedRevision: 0,
      evidence: { submissionId: "pv0", problemId: "p", problemRevision: 0, boardRevision: 0, previewId, explanation: "" } };
    send(opening); const opened = await wait("responseDone");
    expect(messages.filter(e => e.type === "audio")).toHaveLength(1);
    ws!.close(); await new Promise<void>(resolve => ws!.once("close", () => resolve())); await connect();
    send(opening); await wait("responseDone"); expect(planned).toBe(1); expect(spoken).toBe(1);
    const start = messages.length;
    send({ type: "voiceStart", eventId: "vs", turnId: "t1", problemId: "p", expectedRevision: opened.record.revision });
    ws!.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "ve", turnId: "t1", problemId: "p", expectedRevision: opened.record.revision });
    await wait("transcript", start);
    send({ type: "authorize", eventId: "r1", turnId: "t1", expectedRevision: opened.record.revision, action: "review",
      evidence: { ...opening.evidence, submissionId: "pv1" } });
    await wait("responseDone", start);
    expect(histories).toEqual([0, 1]); expect(spoken).toBe(2);
    expect((await store.loadTeachingDecisions("s")).map(d => d.focus)).toEqual(["invariance", "place_value"]);
  } finally { ws!?.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

// 2026-10-16 真机：决策层在最后一次修复后按软门禁放行的回复，被路由复检（未带软门禁标记）再次拒绝，孩子得不到回应。
test("决策层按软门禁放行的回复，路由复检不再作废，照常播报", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dtl-soft-route-"));
  const store = new WorkspaceStore({ directory }); await store.save(record, null);
  const previewId = await store.saveMedia("s", "preview", "preview", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64"));
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ close() {}, transcribe: async () => "",
    respond: async (_pcm, instructions, _image, audio) => { audio(Buffer.from("approved")); return instructions.split("只逐字读这句话：")[1]!; } }),
    undefined, { decide: async input => validateTeachingDecision({ ...plan, focus: "invariance", evidenceIds: [input.turnId],
      utterance: "这道题可以先把两个数都乘十试试吗？" }, input, { softGates: true }) });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const messages: any[] = []; const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const send = (event: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...event }));
  const wait = async (type: string) => {
    for (let count = 0; count < 200; count++) {
      const error = messages.find(e => e.type === "error"); if (error) throw Error(error.code);
      if (messages.some(e => e.type === type)) return; await new Promise(r => setTimeout(r, 10));
    }
    throw Error("missing:" + type);
  };
  try {
    await new Promise<void>(resolve => ws.once("open", resolve));
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    send({ type: "startDiscussion", eventId: "r0", turnId: "t0", expectedRevision: 0,
      evidence: { submissionId: "pv0", problemId: "p", problemRevision: 0, boardRevision: 0, previewId, explanation: "" } });
    await wait("responseDone");
    expect(messages.filter(e => e.type === "audio")).toHaveLength(1);
  } finally { ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
