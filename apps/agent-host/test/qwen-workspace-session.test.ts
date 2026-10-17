import { expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { recognizePhoto, requestWorkspaceText } from "../src/ai/qwen-workspace-session.js";

test("图片识别按音频、图片、commit 确认后生成；只返回候选文本", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (typeof address === "string" || !address) throw Error();
  const events: string[] = [];
  server.on("connection", ws => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString()); events.push(e.type);
      if (e.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (e.type === "input_audio_buffer.commit") ws.send(JSON.stringify({ type: "input_audio_buffer.committed" }));
      if (e.type === "response.create") {
        ws.send(JSON.stringify({ type: "response.text.delta", delta: "一道数学题" }));
        ws.send(JSON.stringify({ type: "response.done", response: { status: "completed" } }));
      }
    });
  });
  try {
    expect(await recognizePhoto({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" }, Buffer.from("fixture"))).toBe("一道数学题");
    expect(events).toEqual(["session.update", "input_audio_buffer.append", "input_image_buffer.append", "input_audio_buffer.commit", "response.create"]);
  } finally { for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});
test("超大图和已取消请求不连接模型", async () => {
  const config = { url: "ws://127.0.0.1:1", apiKey: "synthetic", decisionMode: "realtime" as const };
  await expect(recognizePhoto(config, Buffer.alloc(180001))).rejects.toThrow("imageSize");
  const controller = new AbortController(); controller.abort();
  await expect(recognizePhoto(config, Buffer.from("x"), controller.signal)).rejects.toThrow("aborted");
});

test("带图教学也显式提交本轮任务文本，不让静音图片覆盖决策或复核请求", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (typeof address === "string" || !address) throw Error();
  const events: Record<string, any>[] = [];
  server.on("connection", ws => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString()); events.push(e);
      if (e.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (e.type === "input_audio_buffer.commit") ws.send(JSON.stringify({ type: "input_audio_buffer.committed" }));
      if (e.type === "response.create") {
        ws.send(JSON.stringify({ type: "response.text.delta", delta: '{"allowed":false,"reason":"repeated_question"}' }));
        ws.send(JSON.stringify({ type: "response.done", response: { status: "completed" } }));
      }
    });
  });
  try {
    const prompt = '只按最新孩子与老师历史复核，不解图片题，只返回JSON。';
    await requestWorkspaceText({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" }, prompt,
      Buffer.from("fixture"), undefined, { sessionId: "s", turnId: "t", purpose: "decision" });
    expect(events.map(e => e.type)).toEqual(["session.update", "conversation.item.create", "input_audio_buffer.append", "input_image_buffer.append", "input_audio_buffer.commit", "response.create"]);
    expect(events[1]?.item).toMatchObject({ role: "user", content: [{ type: "input_text", text: prompt }] });
  } finally { for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});

test("线段提案可使用同一协议的纯文本输出，不请求音频或虚构图片", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); if (typeof address === "string" || !address) throw Error();
  const events: Record<string, any>[] = [];
  server.on("connection", ws => {
    ws.send(JSON.stringify({ type: "session.created" }));
    ws.on("message", raw => {
      const e = JSON.parse(raw.toString()); events.push(e);
      if (e.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (e.type === "input_audio_buffer.commit") ws.send(JSON.stringify({ type: "input_audio_buffer.committed" }));
      if (e.type === "response.create") {
        ws.send(JSON.stringify({ type: "response.text.delta", delta: "null" }));
        ws.send(JSON.stringify({ type: "response.done", response: { status: "completed" } }));
      }
    });
  });
  try {
    expect(await requestWorkspaceText({ url: `ws://127.0.0.1:${address.port}`, apiKey: "synthetic", decisionMode: "realtime" }, "只给出JSON或null")).toBe("null");
    expect(events[0]?.session).toMatchObject({ modalities: ["text"], instructions: "只给出JSON或null" });
    expect(events.some(e => e.type === "input_image_buffer.append")).toBe(false);
    expect(events.map(e => e.type)).toEqual(["session.update", "conversation.item.create", "response.create"]);
    expect(events[1]?.item).toMatchObject({ type: "message", role: "user", content: [{ type: "input_text", text: "只给出JSON或null" }] });
  } finally { for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); }
});
