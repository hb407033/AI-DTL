import { expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { buildLearningTutor } from "../src/ai/learning-tutor.js";

// 本地假 Omni：按探针验证过的事件形状（session.created/updated、function_call_arguments.done、
// function_call_output 回传、response.cancel → response.done cancelled + 迟到音频增量）驱动宿主。
const childBoard = {
  revision: 3,
  rectangles: [
    { id: "rect-child-1", wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2, 3, 4, 5, 6, 7, 8], owner: "child" },
    { id: "rect-child-2", wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2, 3, 4, 5, 6, 7], owner: "child" },
  ],
};

type UpstreamScript = (e: any, ws: WebSocket, received: any[]) => void;

async function harness(script: UpstreamScript = () => {}, autoCommit = true) {
  const upstream = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => upstream.once("listening", r));
  const address = upstream.address();
  if (!address || typeof address === "string") throw Error();
  const received: any[] = [];
  const sockets = new Set<WebSocket>();
  upstream.on("connection", (ws) => {
    sockets.add(ws);
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString());
      received.push(e);
      if (e.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (e.type === "input_audio_buffer.commit" && autoCommit) ws.send(JSON.stringify({ type: "input_audio_buffer.committed" }));
      script(e, ws, received);
    });
  });
  const app = await buildLearningTutor({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const child = new WebSocket(url.replace("http:", "ws:") + "/tutor/learning");
  const events: any[] = [];
  child.on("message", (raw) => events.push(JSON.parse(raw.toString())));
  await expect.poll(() => events.some((e) => e.type === "ready")).toBe(true);
  const sessionId = events.find((e) => e.type === "ready").sessionId as string;
  const cleanup = async () => {
    child.terminate();
    await app.close();
    for (const ws of upstream.clients) ws.terminate();
    await new Promise<void>((r) => upstream.close(() => r()));
  };
  return { child, events, received, sessionId, sockets, cleanup };
}

function submitEnvelope(sessionId: string, revision: number, over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, sessionId, eventId: `e-submit-${revision}`, submissionId: `submission-${revision + 1}`,
    revision, type: "submit",
    payload: { challengeId: "fraction-compare-01", boardRevision: 3 },
    image: "aGVsbG8=", board: childBoard, ...over,
  };
}

const types = (list: any[]) => list.map((e) => e.type);

test("无语音按钮提交先放协议静音，再图片与 commit，收到确认才回答", async () => {
  const h = await harness(() => {}, false);
  try {
    h.child.send(JSON.stringify(submitEnvelope(h.sessionId, 0)));
    await expect.poll(() => types(h.received).includes("input_audio_buffer.commit")).toBe(true);
    const sequence = types(h.received);
    expect(sequence.indexOf("input_audio_buffer.append")).toBeLessThan(sequence.indexOf("input_image_buffer.append"));
    expect(sequence.indexOf("input_image_buffer.append")).toBeLessThan(sequence.indexOf("input_audio_buffer.commit"));
    expect(sequence).not.toContain("response.create");
    expect(Buffer.from(h.received.find(e => e.type === "input_audio_buffer.append").audio, "base64")).toEqual(Buffer.alloc(6400));
    for (const ws of h.sockets) ws.send(JSON.stringify({type: "input_audio_buffer.committed"}));
    await expect.poll(() => types(h.received).filter(t => t === "response.create").length).toBe(1);
  } finally { await h.cleanup(); }
});

test("等待提交确认期间打断，迟到确认不得启动回答", async () => {
  const h = await harness(() => {}, false);
  try {
    h.child.send(JSON.stringify(submitEnvelope(h.sessionId, 0)));
    await expect.poll(() => types(h.received).includes("input_audio_buffer.commit")).toBe(true);
    h.child.send(JSON.stringify({type: "interrupt"}));
    await expect.poll(() => h.events.some(e => e.type === "interrupted")).toBe(true);
    for (const ws of h.sockets) ws.send(JSON.stringify({type: "input_audio_buffer.committed"}));
    await new Promise(r => setTimeout(r, 50));
    expect(types(h.received)).not.toContain("response.create");
  } finally { await h.cleanup(); }
});

test("练习模式与自由聊天隔离：绘图、音频、静音等都不触发教学响应", async () => {
  const { child, events, received, cleanup } = await harness();
  try {
    child.send(Buffer.alloc(3200)); // 语音说明草稿，只进缓冲
    child.send(JSON.stringify({ type: "commitAudio" }));
    child.send(JSON.stringify({ type: "ping" })); // 画布/心跳类消息
    child.send(JSON.stringify({ schemaVersion: 1, sessionId: "nope", eventId: "e-x", revision: 0, type: "pause", payload: {} }));
    await new Promise((r) => setTimeout(r, 300));
    const upstreamTypes = types(received);
    expect(upstreamTypes).toContain("input_audio_buffer.append");
    expect(upstreamTypes).toContain("input_audio_buffer.commit");
    expect(upstreamTypes).not.toContain("response.create");
    expect(upstreamTypes).not.toContain("conversation.item.create");
    expect(events.filter((e) => e.type === "accepted")).toHaveLength(0);
  } finally { await cleanup(); }
});

test("按钮提交冻结证据后上行；合法图形动作校验通过才下发并回传结果", async () => {
  let responseCount = 0;
  const { child, events, received, cleanup } = await harness((e, ws) => {
    if (e.type !== "response.create") return;
    responseCount += 1;
    if (responseCount === 1) {
      ws.send(JSON.stringify({ type: "response.created", response: { id: "r1" } }));
      ws.send(JSON.stringify({ type: "response.audio_transcript.delta", response_id: "r1", delta: "我看到你把两张纸都分了格子，" }));
      ws.send(JSON.stringify({ type: "response.audio.delta", response_id: "r1", delta: Buffer.alloc(960).toString("base64") }));
      ws.send(JSON.stringify({
        type: "response.function_call_arguments.done", response_id: "r1", call_id: "call-1", name: "show_hint_rectangle",
        arguments: JSON.stringify({ wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2, 3, 4, 5, 6, 7, 8] }),
      }));
      ws.send(JSON.stringify({ type: "response.done", response: { id: "r1", status: "completed" } }));
    } else if (responseCount === 2) {
      ws.send(JSON.stringify({ type: "response.created", response: { id: "r2" } }));
      ws.send(JSON.stringify({ type: "response.audio.delta", response_id: "r2", delta: Buffer.alloc(960).toString("base64") }));
      ws.send(JSON.stringify({ type: "response.done", response: { id: "r2", status: "completed", usage: { input_tokens: 10, output_tokens: 5 } } }));
    }
  });
  try {
    const sessionId = events.find((e) => e.type === "ready").sessionId as string;
    child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => events.some((e) => e.type === "accepted")).toBe(true);
    expect(events.find((e) => e.type === "accepted")).toMatchObject({ revision: 1, phase: "reviewing", duplicate: false });
    // 冻结证据上行：图片 + 绑定 submissionId 的结构化消息 + response.create
    expect(types(received)).toContain("input_image_buffer.append");
    const item = received.find((e) => e.type === "conversation.item.create");
    expect(JSON.stringify(item.item)).toContain("submission-1");
    // 校验通过的图形动作下发给孩子端，owner 恒为 agent
    await expect.poll(() => events.some((e) => e.type === "action")).toBe(true);
    const action = events.find((e) => e.type === "action");
    expect(action.submissionId).toBe("submission-1");
    expect(action.boardRevision).toBe(4);
    expect(action.command.type).toBe("showHintRectangle");
    expect(action.command.rectangle.owner).toBe("agent");
    expect(action.command.rectangle.shadedCells).toHaveLength(9);
    // 执行结果如实回传，模型继续完成第二轮
    await expect.poll(() => received.filter((e) => e.type === "response.create")).toHaveLength(2);
    const output = received.find((e) => e.type === "conversation.item.create" && e.item.type === "function_call_output");
    expect(output.item.call_id).toBe("call-1");
    expect(JSON.parse(output.item.output)).toMatchObject({ applied: true });
    // 音频增量带 responseId 正常下行；每轮完成的响应都登记 feedbackId
    expect(events.filter((e) => e.type === "audio").map((e) => e.responseId)).toEqual(["r1", "r2"]);
    await expect.poll(() => events.some((e) => e.type === "feedback" && e.feedbackId === "r2")).toBe(true);
    expect(events.filter((e) => e.type === "feedback").map((e) => e.feedbackId)).toEqual(["r1", "r2"]);
    expect(events.find((e) => e.type === "feedback" && e.feedbackId === "r2")).toMatchObject({ submissionId: "submission-1" });
  } finally { await cleanup(); }
});

test("非法图形动作被拒绝并如实回传 applied:false；AI 口头说画好了不算绘图成功", async () => {
  const { child, events, received, sessionId, cleanup } = await harness((e, ws) => {
    if (e.type !== "response.create") return;
    ws.send(JSON.stringify({ type: "response.created", response: { id: "r1" } }));
    ws.send(JSON.stringify({ type: "response.audio_transcript.delta", response_id: "r1", delta: "我已经在右边画好了一个提示矩形。" }));
    ws.send(JSON.stringify({
      type: "response.function_call_arguments.done", response_id: "r1", call_id: "call-bad", name: "show_hint_rectangle",
      arguments: JSON.stringify({ wholeGroupId: "whole-1", rows: 8, columns: 8, shadedCells: [0] }),
    }));
    ws.send(JSON.stringify({ type: "response.done", response: { id: "r1", status: "completed" } }));
  });
  try {
    child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => events.some((e) => e.type === "accepted")).toBe(true);
    await expect.poll(() => received.some((e) => e.item?.type === "function_call_output")).toBe(true);
    const output = received.find((e) => e.item?.type === "function_call_output");
    expect(JSON.parse(output.item.output)).toMatchObject({ applied: false, reason: "invalidRectangle" });
    expect(events.some((e) => e.type === "action")).toBe(false); // 口头声称不产生任何图形
  } finally { await cleanup(); }
});

test("异议：取消上游响应、丢弃迟到音频、只接受已登记的 feedbackId", async () => {
  let responseCount = 0;
  const { child, events, received, sessionId, cleanup } = await harness((e, ws) => {
    if (e.type === "response.cancel") {
      // 真实协议事实：取消后仍可能有少量迟到音频增量，最后 response.done status=cancelled
      ws.send(JSON.stringify({ type: "response.audio.delta", response_id: "r2", delta: Buffer.alloc(960).toString("base64") }));
      ws.send(JSON.stringify({ type: "response.audio_transcript.delta", response_id: "r2", delta: "你不该听到的迟到内容" }));
      ws.send(JSON.stringify({ type: "response.done", response: { id: "r2", status: "cancelled" } }));
      return;
    }
    if (e.type !== "response.create") return;
    responseCount += 1;
    if (responseCount === 1) {
      ws.send(JSON.stringify({ type: "response.created", response: { id: "r1" } }));
      ws.send(JSON.stringify({ type: "response.audio.delta", response_id: "r1", delta: Buffer.alloc(960).toString("base64") }));
      ws.send(JSON.stringify({
        type: "response.function_call_arguments.done", response_id: "r1", call_id: "call-1", name: "show_hint_rectangle",
        arguments: JSON.stringify({ wholeGroupId: "whole-1", rows: 1, columns: 2, shadedCells: [0] }),
      }));
      ws.send(JSON.stringify({ type: "response.done", response: { id: "r1", status: "completed" } }));
    } else if (responseCount === 2) {
      // 工具结果后的第二轮：播到一半被孩子异议打断（不再发 done，等 cancel）
      ws.send(JSON.stringify({ type: "response.created", response: { id: "r2" } }));
      ws.send(JSON.stringify({ type: "response.audio.delta", response_id: "r2", delta: Buffer.alloc(960).toString("base64") }));
    }
  });
  try {
    child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => events.some((e) => e.type === "feedback" && e.feedbackId === "r1")).toBe(true);
    // 未知的 feedbackId 不能异议
    child.send(JSON.stringify({ schemaVersion: 1, sessionId, eventId: "e-bad-contest", revision: 1, type: "contest", payload: { feedbackId: "nope" } }));
    await expect.poll(() => events.some((e) => e.type === "rejected" && e.eventId === "e-bad-contest")).toBe(true);
    expect(received.some((e) => e.type === "response.cancel")).toBe(false);
    // 第二轮正在播放时按下「你理解错了」
    await expect.poll(() => events.filter((e) => e.type === "audio").map((e) => e.responseId)).toEqual(["r1", "r2"]);
    child.send(JSON.stringify({ schemaVersion: 1, sessionId, eventId: "e-contest", revision: 1, type: "contest", payload: { feedbackId: "r1" } }));
    await expect.poll(() => events.some((e) => e.type === "accepted" && e.eventId === "e-contest")).toBe(true);
    expect(events.find((e) => e.type === "accepted" && e.eventId === "e-contest")).toMatchObject({ phase: "clarifying" });
    expect(received.some((e) => e.type === "response.cancel")).toBe(true);
    expect(events.some((e) => e.type === "interrupted" && e.responseId === "r2")).toBe(true);
    // 迟到增量被宿主丢弃，cancelled 是正常收尾而非错误
    await expect.poll(() => events.some((e) => e.type === "responseDone" && e.status === "cancelled")).toBe(true);
    expect(events.filter((e) => e.type === "audio")).toHaveLength(2);
    expect(events.some((e) => e.type === "text" && String(e.text).includes("迟到"))).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(false);
  } finally { await cleanup(); }
});

test("按钮打断：取消生成、屏蔽旧响应片段，cancelled 不算错误", async () => {
  let upstreamWs: WebSocket | null = null;
  const { child, events, received, sessionId, cleanup } = await harness((e, ws) => {
    upstreamWs = ws;
    if (e.type !== "response.create") return;
    ws.send(JSON.stringify({ type: "response.created", response: { id: "r1" } }));
    ws.send(JSON.stringify({ type: "response.audio.delta", response_id: "r1", delta: Buffer.alloc(960).toString("base64") }));
    // 故意不发 response.done：响应保持在播放中
  });
  try {
    child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => events.some((e) => e.type === "audio" && e.responseId === "r1")).toBe(true);
    child.send(JSON.stringify({ type: "interrupt" }));
    await expect.poll(() => received.some((e) => e.type === "response.cancel")).toBe(true);
    expect(events.some((e) => e.type === "interrupted" && e.responseId === "r1")).toBe(true);
    upstreamWs!.send(JSON.stringify({ type: "response.audio.delta", response_id: "r1", delta: Buffer.alloc(960).toString("base64") }));
    upstreamWs!.send(JSON.stringify({ type: "response.audio_transcript.delta", response_id: "r1", delta: "迟到的文字" }));
    upstreamWs!.send(JSON.stringify({ type: "response.done", response: { id: "r1", status: "cancelled" } }));
    await expect.poll(() => events.some((e) => e.type === "responseDone" && e.status === "cancelled")).toBe(true);
    expect(events.filter((e) => e.type === "audio")).toHaveLength(1); // 只有打断前那一帧
    expect(events.some((e) => e.type === "text" && e.text === "迟到的文字")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(false);
  } finally { await cleanup(); }
});

test("切题后旧提交绑定被清除，迟到的图形动作不再应用", async () => {
  let responseCount = 0;
  let upstreamWs: WebSocket | null = null;
  const { child, events, received, sessionId, cleanup } = await harness((e, ws) => {
    upstreamWs = ws;
    if (e.type !== "response.create") return;
    responseCount += 1;
    ws.send(JSON.stringify({ type: "response.created", response: { id: `r${responseCount}` } }));
  });
  try {
    child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => events.some((e) => e.type === "accepted")).toBe(true);
    await expect.poll(() => responseCount).toBe(1);
    // 旧提交的响应还在进行中（r1 未 done），孩子已进入迁移题
    child.send(JSON.stringify({ schemaVersion: 1, sessionId, eventId: "e-transfer", revision: 1, type: "startTransfer", payload: { challengeId: "fraction-transfer-01" } }));
    await expect.poll(() => events.some((e) => e.type === "accepted" && e.eventId === "e-transfer")).toBe(true);
    expect(events.find((e) => e.type === "accepted" && e.eventId === "e-transfer")).toMatchObject({ phase: "transfer" });
    // r1 此时才带来工具调用：宿主已无旧提交绑定，必须拒绝并如实回传
    upstreamWs!.send(JSON.stringify({
      type: "response.function_call_arguments.done", response_id: "r1", call_id: "call-late", name: "show_hint_rectangle",
      arguments: JSON.stringify({ wholeGroupId: "whole-1", rows: 1, columns: 2, shadedCells: [0] }),
    }));
    upstreamWs!.send(JSON.stringify({ type: "response.done", response: { id: "r1", status: "completed" } }));
    await expect.poll(() => received.some((e) => e.item?.type === "function_call_output")).toBe(true);
    const output = received.find((e) => e.item?.type === "function_call_output");
    expect(JSON.parse(output.item.output)).toMatchObject({ applied: false, reason: "noActiveSubmission" });
    expect(events.some((e) => e.type === "action")).toBe(false); // 旧提交图形不得应用到新画布
  } finally { await cleanup(); }
});

test("revision 过期、证据缺失或证据与提交不符的 submit 被拒绝且不上行", async () => {
  const { child, events, received, sessionId, cleanup } = await harness();
  try {
    child.send(JSON.stringify(submitEnvelope(sessionId, 7))); // revision 不匹配
    await expect.poll(() => events.some((e) => e.type === "rejected")).toBe(true);
    expect(events.find((e) => e.type === "rejected")).toMatchObject({ reason: "staleRevision" });
    child.send(JSON.stringify(submitEnvelope(sessionId, 0, { board: undefined, image: undefined })));
    await expect.poll(() => events.filter((e) => e.type === "rejected")).toHaveLength(2);
    expect(events.filter((e) => e.type === "rejected")[1]).toMatchObject({ reason: "missingEvidence" });
    child.send(JSON.stringify(submitEnvelope(sessionId, 0, { payload: { challengeId: "fraction-compare-01", boardRevision: 9 } })));
    await expect.poll(() => events.filter((e) => e.type === "rejected")).toHaveLength(3);
    expect(events.filter((e) => e.type === "rejected")[2]).toMatchObject({ reason: "evidenceMismatch" });
    expect(types(received)).not.toContain("response.create");
    expect(types(received)).not.toContain("input_image_buffer.append");
    // 被拒绝的尝试不消耗 revision：合法提交仍可用
    child.send(JSON.stringify(submitEnvelope(sessionId, 0)));
    await expect.poll(() => events.some((e) => e.type === "accepted")).toBe(true);
  } finally { await cleanup(); }
});

test("语音「我做好了」只按明确短语转写转发意图，绝不自动提交", async () => {
  let upstreamWs: WebSocket | null = null;
  const { events, received, cleanup } = await harness((_e, ws) => { upstreamWs = ws; });
  try {
    upstreamWs!.send(JSON.stringify({ type: "input_audio_transcription.completed", transcript: "我做好了。" }));
    await expect.poll(() => events.some((e) => e.type === "voiceIntent")).toBe(true);
    expect(events.find((e) => e.type === "voiceIntent")).toMatchObject({ intent: "submit", transcript: "我做好了。" });
    upstreamWs!.send(JSON.stringify({ type: "input_audio_transcription.completed", transcript: "帮我一下" }));
    await expect.poll(() => events.filter((e) => e.type === "voiceIntent")).toHaveLength(2);
    expect(events.filter((e) => e.type === "voiceIntent")[1]).toMatchObject({ intent: "help" });
    upstreamWs!.send(JSON.stringify({ type: "input_audio_transcription.completed", transcript: "今天天气真好" }));
    await new Promise((r) => setTimeout(r, 200));
    expect(events.filter((e) => e.type === "voiceIntent")).toHaveLength(2);
    // 转写本身不产生任何提交或教学响应
    expect(events.some((e) => e.type === "accepted")).toBe(false);
    expect(types(received)).not.toContain("response.create");
  } finally { await cleanup(); }
});

test("缺配置时健康检查可用，但不启动云端连接", async () => {
  const app = await buildLearningTutor(null);
  try {
    expect((await app.inject("/healthz")).json()).toEqual({ status: "ok", mode: "learning-tutor", configured: false });
  } finally { await app.close(); }
});
