import { expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { buildSimpleTutor } from "../src/ai/simple-tutor.js";

test("十轮语音与画布，确认提交后请求回答，断开清理云端", async () => {
  const upstream = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>(r => upstream.once("listening", r));
  const address = upstream.address(); if (!address || typeof address === "string") throw Error();
  const types: string[] = [];
  let voice: string | undefined;
  upstream.on("connection", ws => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString()); types.push(e.type);
      if (e.type === "session.update") { voice = e.session.voice; ws.send(JSON.stringify({ type: "session.updated" })); }
      if (e.type === "input_audio_buffer.commit") ws.send(JSON.stringify({ type: "input_audio_buffer.committed" }));
      if (e.type === "response.create") ws.send(JSON.stringify({ type: "response.done", response: { status: "completed", ...(types.filter(t => t === "response.create").length === 1 ? { usage: { input_tokens: 123, output_tokens: 45 } } : {}) } }));
    });
  });
  const app = await buildSimpleTutor({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const child = new WebSocket(url.replace("http:", "ws:") + "/tutor");
  const events: string[] = [];
  const doneEvents: any[] = [];
  child.on("message", raw => { const event = JSON.parse(raw.toString()); events.push(event.type); if (event.type === "done") doneEvents.push(event); });
  try {
    await expect.poll(() => events.includes("ready")).toBe(true);
    expect(voice).toBe("Tina");
    for (let i = 0; i < 10; i++) {
      child.send(JSON.stringify({ type: "start" }));
      child.send(Buffer.alloc(3200));
      child.send(JSON.stringify({ type: "finish", image: "aGVsbG8=" }));
      await expect.poll(() => events.filter(e => e === "done").length).toBe(i + 1);
    }
    expect(types.slice(1, 5)).toEqual(["input_audio_buffer.append", "input_image_buffer.append", "input_audio_buffer.commit", "response.create"]);
    expect(doneEvents[0].usage).toEqual({ input_tokens: 123, output_tokens: 45 });
    expect(doneEvents[1].usage).toBeNull(); // 缺失不能当成零费用。
    expect(doneEvents[0].inputAudioSeconds).toBe(0.1);
    // 上游限制 256 KiB 单帧。图片必须在转发前拦截，不能等云端断开。
    child.send(JSON.stringify({ type: "start" })); child.send(Buffer.alloc(3200));
    child.send(JSON.stringify({ type: "finish", image: "A".repeat(250_004) }));
    await expect.poll(() => events.includes("error")).toBe(true);
    expect(types.filter(t => t === "input_image_buffer.append")).toHaveLength(10);
    child.close(); await expect.poll(() => upstream.clients.size).toBe(0);
  } finally { child.terminate(); await app.close(); for (const ws of upstream.clients) ws.terminate(); await new Promise<void>(r => upstream.close(() => r())); }
});
test("缺配置时健康检查可用，但不启动云端连接", async () => {
  const app = await buildSimpleTutor(null);
  try { expect((await app.inject("/healthz")).json()).toEqual({ status: "ok", mode: "simple-tutor", configured: false }); }
  finally { await app.close(); }
});
