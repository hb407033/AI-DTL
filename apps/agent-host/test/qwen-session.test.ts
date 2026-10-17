import { afterEach, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { QwenSession } from "../src/ai/qwen-session.js";
import { VoiceTurn } from "../src/ai/voice-turn.js";

const cleanups: Array<() => Promise<void>> = [];
test("录音回合通过真实本地 WS 得到带版本的待确认转写并关闭连接", async () => {
  const fake = await server();
  const channel = new QwenSession({ url: fake.url, apiKey: "synthetic-only", decisionMode: "realtime" });
  const events: unknown[] = [];
  const turn = new VoiceTurn({ sessionId: "s", turnId: "t", canvasRevision: 3 }, channel, event => events.push(event));
  cleanups.unshift(async () => turn.close());
  await turn.start(); turn.appendPcm(Buffer.alloc(3200)); turn.commit();
  await expect.poll(() => events.length).toBe(1);
  expect(events[0]).toEqual({ type: "transcript", sessionId: "s", turnId: "t", canvasRevision: 3,
    itemId: "u1", text: "零点三", quality: "unconfirmed" });
  await expect.poll(() => fake.wss.clients.size).toBe(0);
});
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function server(ack = true) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>(resolve => wss.once("listening", resolve));
  const address = wss.address();
  if (typeof address === "string" || !address) throw new Error("address");
  const received: Array<Record<string, unknown>> = [];
  let authorization = "";
  wss.on("connection", (socket, request) => {
    authorization = request.headers.authorization ?? "";
    socket.send(JSON.stringify({ type: "session.created", session: { id: "fake" } }));
    socket.on("message", data => {
      const event = JSON.parse(data.toString()); received.push(event);
      if (event.type === "session.update" && ack) socket.send(JSON.stringify({ type: "session.updated" }));
      if (event.type === "input_audio_buffer.commit") socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "零点三" }));
    });
  });
  cleanups.push(async () => { for (const s of wss.clients) s.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); });
  return { url: `ws://127.0.0.1:${address.port}`, received, wss, auth: () => authorization };
}
test("真实本地 WS 验证鉴权、手动回合、PCM 和转写；不自动让模型回答", async () => {
  const fake = await server();
  const session = new QwenSession({ url: fake.url, apiKey: "synthetic-only", decisionMode: "realtime" });
  cleanups.unshift(async () => session.close());
  const events: unknown[] = [];
  session.onEvent(event => events.push(event));
  await session.connect();
  expect(fake.auth()).toBe("Bearer synthetic-only");
  expect(fake.received[0]).toMatchObject({ type: "session.update", session: { turn_detection: null, modalities: ["text", "audio"] } });
  session.appendPcm(Buffer.alloc(3200));
  session.commit();
  await expect.poll(() => events).toContainEqual({ type: "transcript", itemId: "u1", text: "零点三", quality: "unconfirmed" });
  expect(fake.received.some(event => event.type === "response.create")).toBe(false);
  expect(() => session.appendPcm(Buffer.alloc(1))).toThrow("qwenInvalidPcm");
});
test("服务器未确认配置不能发送音频，超时关闭且不返回敏感错误", async () => {
  const fake = await server(false);
  const session = new QwenSession({ url: fake.url, apiKey: "synthetic-only", decisionMode: "realtime" }, 40);
  expect(() => session.appendPcm(Buffer.alloc(2))).toThrow("qwenNotReady");
  await expect(session.connect()).rejects.toThrow("qwenConnectTimeout");
  expect(() => session.commit()).toThrow("qwenNotReady");
});
test("音频只发给协议监听者，取消清理输入，关闭后不接收迟到帧", async () => {
  const fake = await server();
  const session = new QwenSession({ url: fake.url, apiKey: "synthetic-only", decisionMode: "realtime" });
  const events: unknown[] = [];
  session.onEvent(event => events.push(event));
  await session.connect();
  for (const ws of fake.wss.clients) ws.send(JSON.stringify({ type: "response.audio.delta", response_id: "r", delta: "AAA=" }));
  await expect.poll(() => events.length).toBe(1);
  expect(events[0]).toMatchObject({ type: "unapprovedAudio", responseId: "r" });
  session.cancel();
  await expect.poll(() => fake.received.some(x => x.type === "input_audio_buffer.clear")).toBe(true);
  expect(fake.received.some(x => x.type === "response.cancel")).toBe(true);
  session.close();
  expect(() => session.commit()).toThrow("qwenNotReady");
});

test("云端原始错误不暴露给消费者；畸形帧关闭连接", async () => {
  const fake = await server();
  const session = new QwenSession({ url: fake.url, apiKey: "synthetic-only", decisionMode: "realtime" });
  const events: unknown[] = [];
  session.onEvent(event => events.push(event));
  await session.connect();
  for (const ws of fake.wss.clients) ws.send(JSON.stringify({ type: "error", error: { message: "synthetic-private-error" } }));
  await expect.poll(() => events.length).toBe(1);
  expect(events).toEqual([{ type: "error", code: "qwenProtocolError" }]);
  expect(() => session.appendPcm(Buffer.alloc(2))).toThrow("qwenNotReady");
});
