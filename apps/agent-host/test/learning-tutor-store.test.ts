import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { buildLearningTutor } from "../src/ai/learning-tutor.js";
import { FRACTION_PACK_VERSION, getChallenge } from "../src/learning/fraction-pack.js";
import { LearningSessionStore } from "../src/learning/learning-session-store.js";

// 宿主 ↔ Mac 权威存档接线测试：假 Omni 上行协议照旧；store 用临时目录真实落盘。
const childBoard = {
  revision: 3,
  rectangles: [
    { id: "rect-child-1", wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2, 3, 4, 5, 6, 7, 8], owner: "child" },
  ],
};

const dirs: string[] = [];
function tempStore(options: { atomicWrite?: (target: string, contents: string) => Promise<void> } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "learning-tutor-store-"));
  dirs.push(directory);
  return new LearningSessionStore({ directory, ...options });
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

type UpstreamScript = (e: any, ws: WebSocket, received: any[]) => void;

async function harness(opts: { store?: LearningSessionStore; script?: UpstreamScript } = {}) {
  const upstream = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => upstream.once("listening", r));
  const address = upstream.address();
  if (!address || typeof address === "string") throw Error();
  const received: any[] = [];
  let releaseReady: () => void = () => {};
  const readyGate = new Promise<void>((r) => { releaseReady = r; });
  upstream.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString());
      received.push(e);
      if (e.type === "input_audio_buffer.commit") ws.send(JSON.stringify({ type: "input_audio_buffer.committed" }));
      if (e.type === "session.update") void readyGate.then(() => ws.send(JSON.stringify({ type: "session.updated" })));
      opts.script?.(e, ws, received);
    });
  });
  const app = await buildLearningTutor(
    { url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" },
    opts.store ? { store: opts.store } : {},
  );
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const connect = async (hello?: Record<string, unknown>) => {
    const child = new WebSocket(url.replace("http:", "ws:") + "/tutor/learning");
    const events: any[] = [];
    child.on("message", (raw) => events.push(JSON.parse(raw.toString())));
    if (hello) child.on("open", () => child.send(JSON.stringify(hello)));
    return { child, events };
  };
  const cleanup = async () => {
    await app.close();
    for (const ws of upstream.clients) ws.terminate();
    await new Promise<void>((r) => upstream.close(() => r()));
  };
  return { connect, received, releaseReady, app, cleanup };
}

function submitEnvelope(sessionId: string, revision: number, over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, sessionId, eventId: `e-submit-${revision}`, submissionId: `submission-${revision + 1}`,
    revision, type: "submit",
    payload: { challengeId: "fraction-compare-01", boardRevision: 3 },
    image: "aGVsbG8=", board: childBoard, ...over,
  };
}

test("新会话：ready 固定形状；被接受的信封落事实记录；重放幂等不重复写", async () => {
  const store = tempStore();
  const { connect, releaseReady, cleanup } = await harness({ store });
  try {
    const { child, events } = await connect();
    releaseReady();
    await expect.poll(() => events.some((e) => e.type === "ready")).toBe(true);
    const ready = events.find((e) => e.type === "ready");
    // ready 形状固定：sessionId/revision/phase/challengeId/prompt/restored
    expect(ready).toMatchObject({
      sessionId: expect.any(String), revision: 0, phase: "exploring",
      challengeId: "fraction-compare-01", restored: false,
    });
    expect(ready.prompt).toBe(getChallenge("fraction-compare-01")!.prompt);

    const envelope = submitEnvelope(ready.sessionId, 0);
    child.send(JSON.stringify(envelope));
    await expect.poll(() => events.some((e) => e.type === "accepted")).toBe(true);
    await expect.poll(async () => (await store.load(ready.sessionId)).status).toBe("ok");
    const loaded = await store.load(ready.sessionId);
    if (loaded.status !== "ok") throw Error();
    expect(loaded.record).toMatchObject({
      schemaVersion: 1, sessionId: ready.sessionId, eventId: envelope.eventId,
      packVersion: FRACTION_PACK_VERSION, challengeId: "fraction-compare-01",
      phase: "reviewing", revision: 1, childInkBase64: "aGVsbG8=", hintUsed: false,
    });
    expect(loaded.record.board).toEqual(childBoard);
    expect(loaded.record.submissions).toHaveLength(1);
    expect(loaded.record.submissions[0]).toMatchObject({ submissionId: "submission-1", boardRevision: 3 });

    // 同 eventId 重放：状态机幂等，存档记录不被改写
    child.send(JSON.stringify(envelope));
    await expect.poll(() => events.filter((e) => e.type === "accepted")).toHaveLength(2);
    expect(events.filter((e) => e.type === "accepted")[1]).toMatchObject({ duplicate: true });
    const again = await store.load(ready.sessionId);
    expect(again).toEqual(loaded);
    child.close();
  } finally { await cleanup(); }
});

test("AI 反馈呈现后保存反馈事实；contest 后保存异议事实与提示可见性", async () => {
  const store = tempStore();
  let responseCount = 0;
  const { connect, releaseReady, cleanup } = await harness({
    store,
    script: (e, ws) => {
      if (e.type !== "response.create") return;
      responseCount += 1;
      if (responseCount === 1) {
        ws.send(JSON.stringify({ type: "response.created", response: { id: "r1" } }));
        ws.send(JSON.stringify({ type: "response.audio_transcript.delta", response_id: "r1", delta: "我看到你把第一张纸涂了 9 格。" }));
        ws.send(JSON.stringify({
          type: "response.function_call_arguments.done", response_id: "r1", call_id: "call-1", name: "show_hint_rectangle",
          arguments: JSON.stringify({ wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2] }),
        }));
        ws.send(JSON.stringify({ type: "response.done", response: { id: "r1", status: "completed" } }));
      } else {
        // 工具结果后的第二轮：只说一句话就结束
        ws.send(JSON.stringify({ type: "response.created", response: { id: "r2" } }));
        ws.send(JSON.stringify({ type: "response.done", response: { id: "r2", status: "completed" } }));
      }
    },
  });
  try {
    const { child, events } = await connect();
    releaseReady();
    await expect.poll(() => events.some((e) => e.type === "ready")).toBe(true);
    const sessionId = events.find((e) => e.type === "ready").sessionId as string;
    child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => events.some((e) => e.type === "feedback" && e.feedbackId === "r1")).toBe(true);
    // 反馈事实落盘：summary 来自可见转写，contested=false（工具回合的 r2 也会登记，只断言 r1）
    await expect.poll(async () => {
      const r = await store.load(sessionId);
      return r.status === "ok" && r.record.feedback.some((f) => f.feedbackId === "r1");
    }).toBe(true);
    let record = (await store.load(sessionId) as any).record;
    expect(record.feedback[0]).toMatchObject({ feedbackId: "r1", submissionId: "submission-1", summary: "我看到你把第一张纸涂了 9 格。", contested: false });
    // contest：异议事实落盘，提示矩形已应用则 hintsVisible=true
    child.send(JSON.stringify({ schemaVersion: 1, sessionId, eventId: "e-contest", revision: 1, type: "contest", payload: { feedbackId: "r1" } }));
    await expect.poll(() => events.some((e) => e.type === "accepted" && e.eventId === "e-contest")).toBe(true);
    await expect.poll(async () => {
      const r = await store.load(sessionId);
      return r.status === "ok" && r.record.feedback[0]?.contested === true;
    }).toBe(true);
    record = (await store.load(sessionId) as any).record;
    expect(record.phase).toBe("clarifying");
    expect(record.hintsVisible).toBe(true);
    child.close();
  } finally { await cleanup(); }
});

test("恢复：带 sessionId 重连 → restored:true，反馈资格与 revision 链延续", async () => {
  const store = tempStore();
  const { connect, releaseReady, cleanup } = await harness({
    store,
    script: (e, ws) => {
      if (e.type !== "response.create") return;
      ws.send(JSON.stringify({ type: "response.created", response: { id: "r1" } }));
      ws.send(JSON.stringify({ type: "response.audio_transcript.delta", response_id: "r1", delta: "先复述。" }));
      ws.send(JSON.stringify({ type: "response.done", response: { id: "r1", status: "completed" } }));
    },
  });
  try {
    const first = await connect();
    releaseReady();
    await expect.poll(() => first.events.some((e) => e.type === "ready")).toBe(true);
    const sessionId = first.events.find((e) => e.type === "ready").sessionId as string;
    first.child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => first.events.some((e) => e.type === "feedback")).toBe(true);
    await expect.poll(async () => {
      const r = await store.load(sessionId);
      return r.status === "ok" && r.record.feedback.length === 1;
    }).toBe(true);
    const savedRevision = ((await store.load(sessionId)) as any).record.revision as number;
    first.child.close();
    await new Promise((r) => setTimeout(r, 100));

    // 重连恢复：同一个连接级单会话限制已随旧连接关闭释放
    const second = await connect({ type: "hello", sessionId });
    await expect.poll(() => second.events.some((e) => e.type === "ready")).toBe(true);
    const ready = second.events.find((e) => e.type === "ready");
    expect(ready).toMatchObject({ sessionId, restored: true, revision: savedRevision, phase: "reviewing", challengeId: "fraction-compare-01" });
    // 恢复后 contest 已保存的反馈：证明反馈表跨恢复保留
    second.child.send(JSON.stringify({ schemaVersion: 1, sessionId, eventId: "e-contest-2", revision: savedRevision, type: "contest", payload: { feedbackId: "r1" } }));
    await expect.poll(() => second.events.some((e) => e.type === "accepted" && e.eventId === "e-contest-2")).toBe(true);
    expect(second.events.find((e) => e.type === "accepted" && e.eventId === "e-contest-2")).toMatchObject({ phase: "clarifying" });
    // 重放旧提交：revision 过期被拒绝，不会重复生效
    second.child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => second.events.some((e) => e.type === "rejected" && e.reason === "staleRevision")).toBe(true);
    second.child.close();
  } finally { await cleanup(); }
});

test("记录不存在或已删除：按新会话处理，不复活旧数据", async () => {
  const store = tempStore();
  // 先制造一条已删除记录（墓碑）
  await store.save({
    schemaVersion: 1, sessionId: "deleted-1", eventId: "e-old", packVersion: FRACTION_PACK_VERSION,
    challengeId: "fraction-compare-01", phase: "finished", revision: 9,
    childInkBase64: "", board: { revision: 0, rectangles: [] },
    hintsVisible: false, hintUsed: false, submissions: [], feedback: [],
  });
  await store.delete("deleted-1");

  const { connect, releaseReady, cleanup } = await harness({ store });
  try {
    // 从未存在过的 sessionId
    const a = await connect({ type: "hello", sessionId: "never-existed" });
    releaseReady();
    await expect.poll(() => a.events.some((e) => e.type === "ready")).toBe(true);
    const readyA = a.events.find((e) => e.type === "ready");
    expect(readyA.restored).toBe(false);
    expect(readyA.sessionId).not.toBe("never-existed");
    a.child.close();
    await new Promise((r) => setTimeout(r, 100));

    // 墓碑会话：新会话、新 sessionId，旧记录保持删除状态
    const b = await connect({ type: "hello", sessionId: "deleted-1" });
    await expect.poll(() => b.events.some((e) => e.type === "ready")).toBe(true);
    const readyB = b.events.find((e) => e.type === "ready");
    expect(readyB.restored).toBe(false);
    expect(readyB.sessionId).not.toBe("deleted-1");
    b.child.send(JSON.stringify(submitEnvelope(readyB.sessionId, 0)));
    await expect.poll(() => b.events.some((e) => e.type === "accepted")).toBe(true);
    await expect.poll(async () => (await store.load(readyB.sessionId)).status).toBe("ok");
    expect((await store.load("deleted-1")).status).toBe("missing"); // 旧数据不得复活
    b.child.close();
  } finally { await cleanup(); }
});

test("保存失败如实向孩子端报 error，不假装已保存", async () => {
  const store = tempStore({ atomicWrite: async () => { throw new Error("diskFull"); } });
  const { connect, releaseReady, cleanup } = await harness({ store });
  try {
    const { child, events } = await connect();
    releaseReady();
    await expect.poll(() => events.some((e) => e.type === "ready")).toBe(true);
    const sessionId = events.find((e) => e.type === "ready").sessionId as string;
    child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => events.some((e) => e.type === "accepted")).toBe(true);
    await expect.poll(() => events.some((e) => e.type === "error" && String(e.message).includes("保存"))).toBe(true);
    child.close();
  } finally { await cleanup(); }
});

test("DELETE /learning/:sessionId 删除记录；删除后迟到保存不得复活且报错", async () => {
  const store = tempStore();
  const { connect, releaseReady, app, cleanup } = await harness({ store });
  try {
    const { child, events } = await connect();
    releaseReady();
    await expect.poll(() => events.some((e) => e.type === "ready")).toBe(true);
    const sessionId = events.find((e) => e.type === "ready").sessionId as string;
    child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(async () => (await store.load(sessionId)).status).toBe("ok");

    const deleted = await app.inject({ method: "DELETE", url: `/learning/${sessionId}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ ok: true, sessionId });
    expect((await store.load(sessionId)).status).toBe("missing");

    // 仍在连接的会话继续操作：状态机照走，但迟到保存被墓碑拒绝并如实报错
    child.send(JSON.stringify({ schemaVersion: 1, sessionId, eventId: "e-pause-1", revision: 1, type: "pause", payload: {} }));
    await expect.poll(() => events.some((e) => e.type === "accepted" && e.eventId === "e-pause-1")).toBe(true);
    await expect.poll(() => events.some((e) => e.type === "error" && String(e.message).includes("保存"))).toBe(true);
    expect((await store.load(sessionId)).status).toBe("missing");
    child.close();

    expect((await app.inject({ method: "DELETE", url: "/learning/bad_id!" })).statusCode).toBe(400);
  } finally { await cleanup(); }
});

test("未配置 store 时删除路由明确不可用", async () => {
  const { app, cleanup } = await harness();
  try {
    const res = await app.inject({ method: "DELETE", url: "/learning/s-1" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, reason: "storeDisabled" });
  } finally { await cleanup(); }
});
