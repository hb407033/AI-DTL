import { expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { WorkspaceVoiceProvider } from "../src/ai/workspace-voice-provider.js";

function startServer() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  return new Promise<{ server: WebSocketServer; port: number }>(resolve => {
    server.once("listening", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw Error();
      resolve({ server, port: addr.port });
    });
  });
}

const CTX = { sessionId: "s1", turnId: "t1" };

test("教学 response.done 发出一次用量含真实身份，重复 done 不双计，缺失 usage 记 null", async () => {
  const { server, port } = await startServer();
  const usageRecords: any[] = [];
  server.on("connection", ws => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      const send = (x: object) => ws.send(JSON.stringify(x));
      if (e.type === "session.update") send({ type: "session.updated" });
      if (e.type === "input_audio_buffer.commit") send({ type: "input_audio_buffer.committed", item_id: "i" });
      if (e.type === "response.create") {
        send({ type: "response.created", response: { id: "r1" } });
        send({ type: "response.audio.delta", response_id: "r1", delta: Buffer.from("x").toString("base64") });
        send({ type: "response.audio_transcript.delta", response_id: "r1", delta: "好的。" });
        send({ type: "response.done", response: { id: "r1", status: "completed", usage: { input_tokens: 12, output_tokens: 8 } } });
        send({ type: "response.done", response: { id: "r1", status: "completed", usage: { input_tokens: 12, output_tokens: 8 } } });
      }
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${port}`, apiKey: "synthetic", decisionMode: "realtime" },
    { frameDelayMs: 0, onUsage: r => usageRecords.push(r) });
  try {
    await provider.respond(Buffer.alloc(3200), "接住", undefined, () => {}, undefined, CTX);
    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0].purpose).toBe("teaching");
    expect(usageRecords[0].responseId).toBe("r1");
    expect(usageRecords[0].status).toBe("completed");
    expect(usageRecords[0].usage).toEqual({ input_tokens: 12, output_tokens: 8 });
    expect(usageRecords[0].callId).toBeTruthy(); // 非空 callId
    expect(usageRecords[0].sessionId).toBe("s1");
    expect(usageRecords[0].turnId).toBe("t1");
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }

  // 缺失 usage → null，不记 0
  const { server: s2, port: p2 } = await startServer();
  const records2: any[] = [];
  s2.on("connection", ws => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      const send = (x: object) => ws.send(JSON.stringify(x));
      if (e.type === "session.update") send({ type: "session.updated" });
      if (e.type === "input_audio_buffer.commit") send({ type: "input_audio_buffer.committed", item_id: "i" });
      if (e.type === "response.create") {
        send({ type: "response.created", response: { id: "r2" } });
        send({ type: "response.audio.delta", response_id: "r2", delta: Buffer.from("x").toString("base64") });
        send({ type: "response.audio_transcript.delta", response_id: "r2", delta: "嗯。" });
        send({ type: "response.done", response: { id: "r2", status: "completed" } });
      }
    });
  });
  const provider2 = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${p2}`, apiKey: "synthetic", decisionMode: "realtime" },
    { frameDelayMs: 0, onUsage: r => records2.push(r) });
  try {
    await provider2.respond(Buffer.alloc(3200), "接住", undefined, () => {}, undefined, CTX);
    expect(records2).toHaveLength(1);
    expect(records2[0]!.usage).toBeNull();
    expect(records2[0]!.callId).toBeTruthy();
    expect(records2[0]!.status).toBe("completed");
  } finally { provider2.close(); for (const ws of s2.clients) ws.terminate(); await new Promise<void>(r => s2.close(() => r())); }
});

test("转写完成发出 null 用量含身份（无 response.done）", async () => {
  const { server, port } = await startServer();
  const records: any[] = [];
  server.on("connection", ws => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      const send = (x: object) => ws.send(JSON.stringify(x));
      if (e.type === "session.update") send({ type: "session.updated" });
      if (e.type === "input_audio_buffer.commit") {
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i", transcript: "我先想想" });
        send({ type: "input_audio_buffer.committed", item_id: "i" });
      }
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${port}`, apiKey: "synthetic", decisionMode: "realtime" },
    { frameDelayMs: 0, onUsage: r => records.push(r) });
  try {
    expect(await provider.transcribe(Buffer.alloc(3200), undefined, CTX)).toBe("我先想想");
    expect(records).toHaveLength(1);
    expect(records[0].purpose).toBe("transcription");
    expect(records[0].status).toBe("completed");
    expect(records[0].usage).toBeNull();
    expect(records[0].callId).toBeTruthy();
    expect(records[0].sessionId).toBe("s1");
    expect(records[0].turnId).toBe("t1");
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});

test("取消（abort）记录 cancelled，usage=null", async () => {
  const { server, port } = await startServer();
  const records: any[] = [];
  server.on("connection", ws => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      // 不发 response.done，让 abort 触发
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${port}`, apiKey: "synthetic", decisionMode: "realtime" },
    { frameDelayMs: 0, onUsage: r => records.push(r) });
  const controller = new AbortController();
  try {
    const promise = provider.respond(Buffer.alloc(3200), "接住", undefined, () => {}, controller.signal, CTX);
    await new Promise(r => setTimeout(r, 50));
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("cancelled");
    expect(records[0].usage).toBeNull();
    expect(records[0].callId).toBeTruthy();
    expect(records[0].sessionId).toBe("s1");
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});

test("断线失败记录 failed，usage=null", async () => {
  const { server, port } = await startServer();
  const records: any[] = [];
  server.on("connection", ws => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === "session.update") {
        ws.send(JSON.stringify({ type: "session.updated" }));
        // 握手后立即断开，触发 connectionClosed
        ws.close();
      }
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${port}`, apiKey: "synthetic", decisionMode: "realtime" },
    { frameDelayMs: 0, onUsage: r => records.push(r) });
  try {
    await expect(provider.respond(Buffer.alloc(3200), "接住", undefined, () => {}, undefined, CTX)).rejects.toThrow();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("failed");
    expect(records[0].usage).toBeNull();
    expect(records[0].callId).toBeTruthy();
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});

test("转写重试：两次调用不同 callId，失败+成功各一条", async () => {
  let firstConnection = true;
  const { server, port } = await startServer();
  const records: any[] = [];
  server.on("connection", ws => {
    if (firstConnection) { firstConnection = false; ws.close(); return; } // 首次连接立即断开触发重试
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (e.type === "input_audio_buffer.commit") {
        ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "i", transcript: "好的" }));
        ws.send(JSON.stringify({ type: "input_audio_buffer.committed", item_id: "i" }));
      }
    });
  });
  const provider = new WorkspaceVoiceProvider({ url: `ws://127.0.0.1:${port}`, apiKey: "synthetic", decisionMode: "realtime" },
    { frameDelayMs: 0, onUsage: r => records.push(r) });
  try {
    expect(await provider.transcribe(Buffer.alloc(3200), undefined, CTX)).toBe("好的");
    expect(records).toHaveLength(2);
    expect(records[0].status).toBe("failed"); // 首次失败
    expect(records[1].status).toBe("completed"); // 重试成功
    expect(records[0].callId).not.toBe(records[1].callId); // 不同 callId
    expect(records[0].sessionId).toBe("s1");
    expect(records[1].sessionId).toBe("s1");
  } finally { provider.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});
