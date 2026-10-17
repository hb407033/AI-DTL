// 仅使用既有合成输入诊断事件顺序，不记录供应商正文、URL 或凭据。
import fs from "node:fs";
import { createRequire } from "node:module";
import { loadQwenConfig } from "../apps/agent-host/src/ai/config.ts";
const require = createRequire(new URL("../apps/agent-host/package.json", import.meta.url));
const WebSocket = require("ws");
const config = loadQwenConfig();
const delay = Number(process.argv[2] ?? 2500);
const ws = new WebSocket(config.url, { headers: { Authorization: `Bearer ${config.apiKey}` } });
const start = Date.now(), events = [];
const send = event => ws.send(JSON.stringify(event));
let timer;
const done = new Promise(resolve => {
  timer = setTimeout(resolve, 18000);
  ws.on("error", () => resolve());
  ws.on("message", async raw => {
    const event = JSON.parse(raw.toString());
    events.push({ type: event.type, ms: Date.now() - start,
      ...(event.type.includes("transcription") ? { item: event.item_id, final: event.type.endsWith("completed") } : {}) });
    if (event.type === "session.created") send({ type: "session.update", session: {
      modalities: ["text"], turn_detection: null,
      audio: { input: { format: { type: "pcm", sample_rate: 16000 } } },
      instructions: "你是内部转写检查器。只输出收到。" } });
    if (event.type === "session.updated") {
      const pcm = Buffer.concat([fs.readFileSync("/tmp/ai-dtl-natural-loop-audio/3.pcm"), Buffer.alloc(38400)]);
      for (let n = 0; n < pcm.length; n += 3200) {
        send({ type: "input_audio_buffer.append", audio: pcm.subarray(n, n + 3200).toString("base64") });
        await new Promise(r => setTimeout(r, 100));
      }
      send({ type: "input_audio_buffer.commit" });
    }
    if (event.type === "input_audio_buffer.committed") setTimeout(() => {
      if (ws.readyState === 1) send({ type: "response.create" });
    }, delay);
    if (event.type === "response.done") setTimeout(resolve, 3000);
  });
});
await done; clearTimeout(timer); ws.terminate();
console.log(JSON.stringify({ responseDelayMs: delay, events }, null, 2));
