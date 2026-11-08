import { expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { WorkspaceVoiceProvider } from "../src/ai/workspace-voice-provider.js";

test("3.8 切换转写和教学指令时重建云端会话，不沿用只输出收到的状态", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (!address || typeof address === "string") throw Error();
  let connections = 0;
  const configuredInstructions: string[] = [];
  server.on("connection", ws => {
    connections++;
    let committed = false, audio = false;
    const send = (event: object) => ws.send(JSON.stringify(event));
    send({ type: "session.created" });
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === "session.update") {
        configuredInstructions.push(e.session.instructions);
        if (!committed) audio = e.session.modalities.includes("audio");
        send({ type: "session.updated" });
      }
      if (e.type === "input_audio_buffer.commit") {
        committed = true;
        send({ type: "input_audio_buffer.committed", item_id: "i" });
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i", transcript: "我先画一条线" });
      }
      if (e.type === "response.create") {
        send({ type: "response.created", response: { id: "r" } });
        if (audio) send({ type: "response.audio.delta", response_id: "r", delta: Buffer.from("voice").toString("base64") });
        send({ type: "response.audio_transcript.delta", response_id: "r", delta: audio ? "说说你的想法" : "收到" });
        send({ type: "response.done", response: { id: "r", status: "completed" } });
      }
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${address.port}?model=qwen3.8-omni-flash-realtime`, apiKey: "synthetic", decisionMode: "realtime" });
  try {
    expect(await provider.transcribe(Buffer.alloc(3200))).toBe("我先画一条线");
    const chunks: string[] = [];
    expect(await provider.respond(Buffer.alloc(3200), "只问思路", undefined, b => chunks.push(b.toString()))).toBe("说说你的想法");
    expect(chunks).toEqual(["voice"]);
    expect(connections).toBe(2);
    expect(configuredInstructions[1]).toContain("不添加喘气、吸气、叹气");
    expect(configuredInstructions[1]).toContain("只问思路");
    expect(configuredInstructions[0]).not.toContain("不添加喘气");
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});

test.each(["before", "alwaysBefore", "afterAppend", "afterCommit", "aborted"])("教学连接恢复边界：%s", async failure => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (!address || typeof address === "string") throw Error();
  let connections = 0, commits = 0, firstAppend = 0, uploadMs = 0;
  const abort = new AbortController();
  server.on("connection", ws => {
    connections++;
    if (failure === "alwaysBefore" || (connections === 1 && ["before", "aborted"].includes(failure))) {
      if (failure === "aborted") abort.abort();
      ws.close(); return;
    }
    const send = (event: object) => ws.readyState === 1 && ws.send(JSON.stringify(event));
    send({ type: "session.created" });
    ws.on("message", raw => {
      const event = JSON.parse(raw.toString());
      if (event.type === "session.update") send({ type: "session.updated" });
      if (event.type === "input_audio_buffer.append") firstAppend ||= performance.now();
      if (event.type === "input_audio_buffer.append" && failure === "afterAppend") ws.close();
      if (event.type === "input_audio_buffer.commit") {
        commits++;
        uploadMs = performance.now() - firstAppend;
        if (failure === "afterCommit") { ws.close(); return; }
        send({ type: "input_audio_buffer.committed", item_id: "i" });
      }
      if (event.type === "response.create") {
        send({ type: "response.created", response: { id: "r" } });
        send({ type: "response.audio.delta", response_id: "r", delta: Buffer.from("once").toString("base64") });
        send({ type: "response.audio_transcript.delta", response_id: "r", delta: "请继续尝试。" });
        send({ type: "response.done", response: { id: "r", status: "completed" } });
      }
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" }, failure === "before" ? {} : { frameDelayMs: 0 });
  const chunks: string[] = [];
  try {
    const response = provider.respond(Buffer.alloc(3200), "接住信息", undefined, b => chunks.push(b.toString()), abort.signal);
    if (failure === "before") {
      await expect(response).resolves.toBe("请继续尝试。");
      expect(commits).toBe(1); expect(chunks).toEqual(["once"]);
      expect(uploadMs, "已录完的教学输入不重复等待音频原长").toBeLessThan(500);
    } else {
      await expect(response).rejects.toThrow(); expect(chunks).toEqual([]);
    }
    expect(connections).toBe(["before", "alwaysBefore"].includes(failure) ? 2 : 1);
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});

test("五轮转写复用连接，接受 commit 前到达的关联 ASR，内部音频永不透出", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (!address || typeof address === "string") throw Error();
  let connections = 0, turn = 0, audio = false, responses = 0;
  server.on("connection", ws => {
    connections++;
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      const send = (x: object) => ws.send(JSON.stringify(x));
      if (e.type === "session.update") { audio = e.session.modalities.includes("audio"); send({ type: "session.updated" }); }
      if (e.type === "input_audio_buffer.commit") {
        turn++;
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: `item_${turn}`, transcript: "看看我的想法" });
        send({ type: "input_audio_buffer.committed", item_id: `item_${turn}` });
      }
      if (e.type === "response.create") {
        responses++;
        send({ type: "response.created", response: { id: `response_${turn}` } });
        send({ type: "response.audio.delta", response_id: "stale", delta: Buffer.from("bad").toString("base64") });
        send({ type: "response.audio.delta", response_id: `response_${turn}`, delta: Buffer.from("good").toString("base64") });
        send({ type: "response.audio_transcript.delta", response_id: `response_${turn}`, delta: audio ? "说说单位" : "收到" });
        send({ type: "response.done", response: { id: `response_${turn}`, status: "completed" } });
      }
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" });
  try {
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      expect(await provider.transcribe(Buffer.alloc(3200))).toBe("看看我的想法");
      expect(performance.now() - started, "缓冲音频转写不人为等待音频时长").toBeLessThan(500);
    }
    expect(responses, "原生 ASR 完成不依赖内部生成收到，避免抢跑取消转写").toBe(0);
    const chunks: string[] = [];
    expect(await provider.respond(Buffer.alloc(3200), "只问单位", undefined, b => chunks.push(b.toString()))).toBe("说说单位");
    expect(chunks).toEqual(["good"]);
    expect(connections).toBe(1);
    const aborted = new AbortController(); aborted.abort();
    await expect(provider.transcribe(Buffer.alloc(3200), aborted.signal)).rejects.toThrow("aborted");
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});

test("原生 ASR 缺失时及时恢复，commit 后迟到 ASR 不丢弃", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (!address || typeof address === "string") throw Error();
  let connections = 0;
  server.on("connection", ws => {
    const connection = ++connections;
    const send = (event: object) => ws.readyState === 1 && ws.send(JSON.stringify(event));
    send({ type: "session.created" });
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === "session.update") send({ type: "session.updated" });
      if (e.type === "input_audio_buffer.commit") {
        send({ type: "input_audio_buffer.committed", item_id: "i" });
        if (connection > 1) setTimeout(() => send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i", transcript: "我先想想" }), 30);
      }
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" }, { frameDelayMs: 0 });
  const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 5000);
  const started = Date.now();
  try {
    expect(await provider.transcribe(Buffer.alloc(3200), abort.signal)).toBe("我先想想");
    expect(connections).toBe(2);
    expect(Date.now() - started).toBeLessThan(4000);
  } finally { clearTimeout(timeout); provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
}, 7000);

test("仅内部转写遇到连接中断可重试一次，教学生成不重放", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (!address || typeof address === "string") throw Error();
  let connections = 0;
  server.on("connection", ws => {
    connections++;
    if (connections === 1) { ws.close(); return; }
    const send = (e: object) => ws.send(JSON.stringify(e));
    send({ type: "session.created" });
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === "session.update") send({ type: "session.updated" });
      if (e.type === "input_audio_buffer.commit") {
        send({ type: "input_audio_buffer.committed", item_id: "item" });
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "item", transcript: "我先想想" });
      }
      if (e.type === "response.create") {
        send({ type: "response.created", response: { id: "r" } });
        send({ type: "response.done", response: { id: "r", status: "completed" } });
      }
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" }, { frameDelayMs: 0 });
  try {
    expect(await provider.transcribe(Buffer.alloc(3200))).toBe("我先想想");
    expect(connections).toBe(2);
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});

// 2026-11-08 真机：家里网络断几秒时同一句两次立即重试都失败，老师没了声音。
test("转写遇到连接失败间隔着最多再试两次；三次都失败才放弃，并记下真实的网络错误", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (!address || typeof address === "string") throw Error();
  let connections = 0, failFirst = 2;
  server.on("connection", ws => {
    connections++;
    if (connections <= failFirst) { ws.close(); return; }
    const send = (e: object) => ws.send(JSON.stringify(e));
    send({ type: "session.created" });
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === "session.update") send({ type: "session.updated" });
      if (e.type === "input_audio_buffer.commit") {
        send({ type: "input_audio_buffer.committed", item_id: "item" });
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "item", transcript: "我再说一遍" });
      }
    });
  });
  const url = `ws://127.0.0.1:${address.port}`;
  const provider = new WorkspaceVoiceProvider({ url, apiKey: "synthetic", decisionMode: "realtime" }, { frameDelayMs: 0, transcribeRetryDelaysMs: [10, 10] });
  try {
    expect(await provider.transcribe(Buffer.alloc(3200))).toBe("我再说一遍");
    expect(connections).toBe(3);
    provider.close(); connections = 0; failFirst = 5;
    await expect(provider.transcribe(Buffer.alloc(3200))).rejects.toThrow("connectionClosed");
    expect(connections).toBe(3);
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
  // 连不上（端口已关）时记为连接失败，不再被随后的 close 覆盖成“云端关闭”。
  const offline = new WorkspaceVoiceProvider({ url, apiKey: "synthetic", decisionMode: "realtime" }, { frameDelayMs: 0, transcribeRetryDelaysMs: [] });
  await expect(offline.transcribe(Buffer.alloc(3200))).rejects.toThrow("connectionFailed");
  offline.close();
});

// 2026-11-08 真机：长录音转写超过 2 秒被判超时，再重试两次又各等 2 秒，孩子白等近 10 秒后听到“没听清”。
test("转写超时只换连接再要一次，不像连接失败那样试第三次", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (!address || typeof address === "string") throw Error();
  let connections = 0;
  server.on("connection", ws => {
    connections++;
    const send = (e: object) => ws.readyState === 1 && ws.send(JSON.stringify(e));
    send({ type: "session.created" });
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === "session.update") send({ type: "session.updated" });
      if (e.type === "input_audio_buffer.commit") send({ type: "input_audio_buffer.committed", item_id: "i" });
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" }, { frameDelayMs: 0, transcribeRetryDelaysMs: [10, 10] });
  try {
    await expect(provider.transcribe(Buffer.alloc(3200))).rejects.toThrow("providerTimeout");
    expect(connections).toBe(2);
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
}, 12000);
