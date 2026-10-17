import { expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";
import { WorkspaceScaffoldService } from "../src/ai/workspace-scaffold-route.js";
import { projectThinkingMoveMemory, validThinkingMoveMemoryReference } from "../src/learning/families/thinking-move-ledger.js";
import { validateTeachingDecision } from "../src/ai/workspace-teaching-decision.js";
import type { TeachingDecision, TeachingInput } from "../src/ai/workspace-teaching-decision.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQBJZv0AAAAASUVORK5CYII=", "base64");
function workspace(sessionId = "s", statement = "2.4×0.3") : WorkspaceRecord {
  return { schemaVersion: 2, sessionId, eventId: "initial", revision: 0,
    problem: { source: "curated", problemId: `p-${sessionId}`, challengeId: "c", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: statement, revision: 0, confirmed: true } }, phase: "exploring",
    childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
}
function decision(record: WorkspaceRecord, turnId: string, patch: Partial<TeachingDecision> = {}): TeachingDecision {
  return { problemId: record.problem!.problemId, problemRevision: record.problem!.statement.revision,
    turnId, responseId: `r-${turnId}`, child: "我先画一条线表示长度。", focus: "verify", observation: "孩子说明画线的含义",
    evidenceIds: [turnId], resolved: [], utterance: "这条线表示什么？", method: "ordinary", handoff: false, ...patch };
}
async function persist(store: WorkspaceStore, record: WorkspaceRecord, d: TeachingDecision) {
  const next = { ...record, eventId: `e-${d.turnId}`, revision: record.revision + 1,
    feedback: [...record.feedback, { responseId: d.responseId, turnId: d.turnId, summary: d.utterance, contested: false }] };
  expect(await store.save(next, record.revision, d)).toMatchObject({ ok: true });
  return next;
}

test.each(["我不会画。", "我不想画，也还没做。", "我还没画线。", "我还没做。"])("投影防御历史误填childMove，负证据不能提升撤手等级：%s", child => {
  const record = workspace();
  const prior = decision(record, "prior", { move: "represent", utterance: "你想怎么表示这个数量？" });
  const declined = decision(record, "declined", { child, childMove: { move: "represent", evidenceId: "declined" } });
  record.feedback = [prior, declined].map(d => ({ turnId: d.turnId, responseId: d.responseId, summary: d.utterance, contested: false }));
  expect(projectThinkingMoveMemory(record, [prior, declined])).toEqual([]);
});

test("投影允许同轮先表示不会、随后具体描述已经做出的动作", () => {
  const record = workspace();
  const prior = decision(record, "prior", { move: "represent", utterance: "你想怎么表示这个数量？" });
  const performed = decision(record, "performed", { child: "我不会画，但我已经画了一条线表示小路。",
    childMove: { move: "represent", evidenceId: "performed" } });
  record.feedback = [prior, performed].map(d => ({ turnId: d.turnId, responseId: d.responseId, summary: d.utterance, contested: false }));
  expect(projectThinkingMoveMemory(record, [prior, performed])).toEqual([
    { move: "represent", withdrawalLevel: 2, evidenceId: "performed", turnId: "performed", sessionId: "s" },
  ]);
});

test("跨作品、重开宿主只召回有效 childMove，异议和删除即时撤销引用", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-memory-"));
  try {
    let store = new WorkspaceStore({ directory });
    let first = workspace("a"), second = workspace("b");
    await store.save(first, null); await store.save(second, null);
    first = await persist(store, first, decision(first, "a-turn", { childMove: { move: "represent", evidenceId: "a-turn" } }));
    second = await persist(store, second, decision(second, "b-turn", { child: "不知道", move: "represent" }));
    store = new WorkspaceStore({ directory });
    let summary = await store.loadThinkingMoveSummary();
    expect(summary).toEqual([{ move: "represent", withdrawalLevel: 3, sessionId: "a", turnId: "a-turn", evidenceId: "a-turn" }]);
    expect(validThinkingMoveMemoryReference(summary, "a-turn", "represent")).toBe(true);
    expect(validThinkingMoveMemoryReference(summary, "b-turn")).toBe(false);
    first = { ...first, eventId: "contest", revision: first.revision + 1,
      feedback: first.feedback.map(f => ({ ...f, contested: true })) };
    expect(await store.save(first, first.revision - 1)).toMatchObject({ ok: true });
    expect(await store.loadThinkingMoveSummary()).toEqual([]);
    first = await persist(store, first, decision(first, "a-new", { childMove: { move: "represent", evidenceId: "a-new" } }));
    await store.delete("a");
    summary = await store.loadThinkingMoveSummary();
    expect(summary).toEqual([]);
    expect(validThinkingMoveMemoryReference(summary, "a-new")).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("具体指导为1、泛化邀请后为2，拒绝提示与无来源证据不增加等级", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-memory-grades-"));
  try {
    const store = new WorkspaceStore({ directory });
    let record = workspace(); await store.save(record, null);
    record = await persist(store, record, decision(record, "teacher", { child: "帮帮我", move: "represent", utterance: "先画一条线，再分成十份。" }));
    record = await persist(store, record, decision(record, "prompted", { childMove: { move: "represent", evidenceId: "prompted" } }));
    expect((await store.loadThinkingMoveSummary())[0]?.withdrawalLevel).toBe(1);
    record = await persist(store, record, decision(record, "declined", { child: "我不想画", move: "represent" }));
    expect((await store.loadThinkingMoveSummary())[0]?.withdrawalLevel).toBe(1);
    record = await persist(store, record, decision(record, "general", { child: "接着呢", move: "look_back", utterance: "你想用什么办法检验？" }));
    record = await persist(store, record, decision(record, "check", { child: "我把结果乘回去核对了。", childMove: { move: "look_back", evidenceId: "check" } }));
    expect((await store.loadThinkingMoveSummary()).find(r => r.move === "look_back")?.withdrawalLevel).toBe(2);
    record = await persist(store, record, decision(record, "fake", { childMove: { move: "justify", evidenceId: "missing-image" } }));
    expect((await store.loadThinkingMoveSummary()).some(r => r.move === "justify")).toBe(false);
    record = { ...record, eventId: "correct-problem", revision: record.revision + 1,
      problem: { ...record.problem!, statement: { ...record.problem!.statement, revision: 1 } } };
    await store.save(record, record.revision - 1);
    expect(await store.loadThinkingMoveSummary()).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("投影读取全部分页和12轮以外的有效证据，跳过坏档", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-memory-pages-"));
  try {
    const store = new WorkspaceStore({ directory });
    for (let i = 0; i < 52; i++) await store.save(workspace(`s-${String(i).padStart(2, "0")}`), null);
    let record = workspace("s-51");
    record = await persist(store, record, decision(record, "old-evidence", { childMove: { move: "represent", evidenceId: "old-evidence" } }));
    for (let i = 0; i < 13; i++) record = await persist(store, record, decision(record, `later-${i}`, { child: "我不想画" }));
    await writeFile(path.join(directory, "corrupt.json"), "{}");
    expect(await store.loadThinkingMoveSummary()).toContainEqual(expect.objectContaining({ sessionId: "s-51", evidenceId: "old-evidence" }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("先前具体指导发生异议，不把其后的动作重新判作自发", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-memory-correction-"));
  try {
    const store = new WorkspaceStore({ directory });
    let record = workspace(); await store.save(record, null);
    record = await persist(store, record, decision(record, "instruct", { child: "帮帮我", move: "represent", utterance: "先画一条线。" }));
    record = await persist(store, record, decision(record, "draw", { childMove: { move: "represent", evidenceId: "draw" } }));
    record = { ...record, revision: record.revision + 1, eventId: "contest-teacher",
      feedback: record.feedback.map(f => f.responseId === "r-instruct" ? { ...f, contested: true } : f) };
    await store.save(record, record.revision - 1);
    expect((await store.loadThinkingMoveSummary())[0]?.withdrawalLevel).toBe(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("真实本轮图片 childMove 可以进入账本，无需把图片再复制到通用 evidenceIds", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-memory-image-"));
  try {
    const store = new WorkspaceStore({ directory });
    let record = workspace(); await store.save(record, null);
    const previewId = await store.saveMedia("s", "picture", "preview", PNG);
    record = { ...record, eventId: "submission", revision: 1, submissions: [{ submissionId: "sub", problemId: "p-s", problemRevision: 0,
      boardRevision: 0, previewId, explanation: "我画了线" }] };
    await store.save(record, 0);
    record = await persist(store, record, decision(record, "picture-turn", { child: "我画了线", childMove: { move: "represent", evidenceId: previewId } }));
    expect(await store.loadThinkingMoveSummary()).toContainEqual(expect.objectContaining({ evidenceId: previewId, withdrawalLevel: 1 }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function routeFixture(options: { statement?: string; move?: TeachingDecision["move"]; request?: boolean; action?: "help" | "review";
  beforeDecision?: (store: WorkspaceStore) => Promise<void>; beforeSpeech?: (store: WorkspaceStore) => Promise<void>;
  recall?: boolean; sameWorkPrior?: boolean; afterHelp?: (signal: AbortSignal) => Promise<unknown> } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ws-memory-route-"));
  const store = new WorkspaceStore({ directory });
  let initial = workspace("s", options.statement); await store.save(initial, null);
  if (options.sameWorkPrior) {
    initial = await persist(store, initial, decision(initial, "prior-turn", { childMove: { move: "represent", evidenceId: "prior-turn" } }));
  } else {
    let prior = workspace("prior"); await store.save(prior, null);
    prior = await persist(store, prior, decision(prior, "prior-turn", { childMove: { move: "represent", evidenceId: "prior-turn" } }));
  }
  const previewId = await store.saveMedia("s", "preview", "preview", PNG);
  let generated = 0, invitations = 0;
  const service = new WorkspaceScaffoldService(store, {
    understand: async () => ({ whole: "1", unit: "米", meaning: "一条线表示一米", sourceQuote: "这条线表示一米" }),
    generate: async () => { generated++; throw Error("generationMustRequireConsent"); },
  });
  const inputs: TeachingInput[] = [];
  const app = Fastify(); await app.register(websocket);
  registerWorkspaceVoice(app, store, () => ({ close() {}, transcribe: async () => options.action === "review" ? "看看我的想法" : "帮帮我",
    respond: async (_pcm, instructions, _image, audio) => { await options.beforeSpeech?.(store); audio(Buffer.from("ok")); return instructions.split("只逐字读这句话：")[1]!; } }),
    async (record, submissionId, responseId, signal) => { invitations++; return options.afterHelp
      ? options.afterHelp(signal) : service.offerAfterHelp(record.sessionId, submissionId, responseId, signal); },
    { decide: async input => { inputs.push(input); await options.beforeDecision?.(store); return decision(input.record, input.turnId, {
      responseId: input.responseId, child: input.child, move: options.move ?? "represent", scaffoldRequest: options.request ?? true,
      utterance: options.recall ? "上次你画过线，这次想怎么试？" : input.permission === "hint" ? "先画一条线，试着表示数量。" : "你想先怎么试？",
      evidenceIds: options.recall ? [input.turnId, "prior-turn"] : [input.turnId] }); } }, true);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace");
  const messages: any[] = []; ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  await new Promise<void>(resolve => ws.once("open", resolve));
  const send = (event: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId: "s", ...event }));
  const wait = async (type: string) => {
    for (let i = 0; i < 100; i++) { const event = messages.find(m => m.type === type); if (event) return event; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`missing ${type}: ${JSON.stringify(messages)}`);
  };
  const run = async (expected = "responseDone") => {
    send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
    send({ type: "voiceStart", eventId: "start", expectedRevision: initial.revision, problemId: "p-s", turnId: "turn" }); ws.send(Buffer.alloc(3200));
    send({ type: "voiceEnd", eventId: "end", expectedRevision: initial.revision, problemId: "p-s", turnId: "turn" }); await wait("transcript");
    send({ type: "authorize", action: options.action ?? "help", eventId: "reply", expectedRevision: initial.revision, turnId: "turn",
      evidence: { submissionId: "submission", problemId: "p-s", problemRevision: 0, boardRevision: 0, previewId, explanation: "这条线表示一米" } });
    await wait(expected);
  };
  return { store, inputs, run, wait, send, messages, counts: () => ({ generated, invitations }),
    close: async () => { ws.close(); service.close(); await app.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("真实决策路由注入跨作品账本，请求图示只发邀请、未同意不生成", async () => {
  const fixture = await routeFixture();
  try {
    await fixture.run();
    expect(fixture.inputs[0]?.ledgerSummary).toContainEqual(expect.objectContaining({ sessionId: "prior", evidenceId: "prior-turn" }));
    const event = await fixture.wait("scaffold");
    expect(event.scaffold.items[0]?.status).toBe("offered");
    expect(fixture.counts()).toEqual({ generated: 0, invitations: 1 });
    expect((await fixture.store.loadScaffold("s")).items[0]?.status).toBe("offered");
  } finally { await fixture.close(); }
});

test("决策等待期间删除历史作品，返回后校验输入重新读取有效账本", async () => {
  const fixture = await routeFixture({ request: false, beforeDecision: store => store.delete("prior") });
  try { await fixture.run(); expect(fixture.inputs[0]?.ledgerSummary).toEqual([]); }
  finally { await fixture.close(); }
});

test("TTS等待期间删除唤起来源，不播报或保存依赖失效来源的决策", async () => {
  const fixture = await routeFixture({ recall: true, request: false, beforeSpeech: store => store.delete("prior") });
  try {
    await fixture.run("error");
    expect(fixture.messages.some(m => m.type === "audio" || m.type === "responseDone")).toBe(false);
    expect(await fixture.store.loadTeachingDecisions("s")).toEqual([]);
  } finally { await fixture.close(); }
});

test("TTS等待期间同作品旧反馈被异议，过期history也不得绕过唤起校验", async () => {
  const fixture = await routeFixture({ recall: true, sameWorkPrior: true, request: false, beforeSpeech: async store => {
    const loaded = await store.load("s"); if (loaded.status !== "ok") throw Error("fixtureMissing");
    await store.save({ ...loaded.record, eventId: "contest-prior", revision: loaded.record.revision + 1,
      feedback: loaded.record.feedback.map(f => f.turnId === "prior-turn" ? { ...f, contested: true } : f) }, loaded.record.revision);
  } });
  try {
    await fixture.run("error");
    expect(fixture.messages.some(m => m.type === "audio" || m.type === "responseDone")).toBe(false);
    expect(await fixture.store.loadTeachingDecisions("s")).toEqual([]);
  } finally { await fixture.close(); }
});

test.each([
  { statement: "x+2=5" }, { move: "justify" as const }, { action: "review" as const }, { request: false },
])("错误题族、动作、权限或未请求图示时不邀请 %j", async options => {
  const fixture = await routeFixture(options);
  try { await fixture.run(); expect(fixture.counts()).toEqual({ generated: 0, invitations: 0 }); }
  finally { await fixture.close(); }
});

test("邀请异步期间取消，旧回调晚到不得发送 scaffold", async () => {
  let release!: (value: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let capturedSignal: AbortSignal | undefined;
  const fixture = await routeFixture({ afterHelp: async signal => { capturedSignal = signal; entered(); return new Promise(resolve => { release = resolve; }); } });
  try {
    await fixture.run(); await started;
    fixture.send({ type: "interrupt", turnId: "turn" });
    await fixture.wait("thinkingEnd");
    for (let i = 0; i < 100 && !capturedSignal?.aborted; i++) await new Promise(r => setTimeout(r, 5));
    expect(capturedSignal?.aborted).toBe(true);
    release({ revision: 1, items: [] }); await fixture.wait("interrupted");
    expect(fixture.messages.some(m => m.type === "scaffold")).toBe(false);
  } finally { release?.({}); await fixture.close(); }
});

test("同作品真实历史表达的普通回顾不要求另有思维动作账本", () => {
  const record = workspace();
  const prior = decision(record, "old-turn", { child: "这条线表示一米。", utterance: "这条线表示一米。" });
  const input: TeachingInput = { record, turnId: "current-turn", responseId: "current-response", permission: "review",
    child: "接着看看。", history: [prior] };
  const raw = { ...decision(record, input.turnId), focus: "clarify", evidenceIds: [input.turnId, prior.turnId],
    utterance: "上次你说这条线表示一米，接下来想怎么试？" };
  expect(() => validateTeachingDecision(raw, input)).not.toThrow();
});

test("澄清数量词义不被已学动作的撤手门禁误当成解题步骤", () => {
  const record = workspace();
  const input: TeachingInput = { record, turnId: "current-turn", responseId: "current-response", permission: "clarification",
    child: "把整体分成十份是什么意思？", history: [], ledgerSummary: [{ move: "understand", withdrawalLevel: 2,
      evidenceId: "prior-proof", turnId: "prior-turn", sessionId: "prior-work" }] };
  const raw = { ...decision(record, input.turnId), focus: "clarify", move: "understand",
    utterance: "把整体分成十份，就是平均分成十个一样的部分。" };
  expect(() => validateTeachingDecision(raw, input)).not.toThrow();
});

test("review承接孩子已经画出的事实不被误当成替孩子代选下一步", () => {
  const record = workspace();
  const input: TeachingInput = { record, turnId: "current-turn", responseId: "current-response", permission: "review",
    child: "我先画了三段。", history: [], imageId: "current-image", image: PNG,
    ledgerSummary: [{ move: "represent", withdrawalLevel: 2, evidenceId: "prior-proof", turnId: "prior-turn", sessionId: "prior-work" }] };
  const raw = { ...decision(record, input.turnId), focus: "clarify", move: "represent",
    utterance: "你先画了三段，每一段表示什么？" };
  expect(() => validateTeachingDecision(raw, input)).not.toThrow();
});
