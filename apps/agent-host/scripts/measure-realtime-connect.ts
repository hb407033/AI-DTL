// 一次性探针：只测握手到 session.updated 的耗时，以及空闲连接被云端关掉的秒数。
// 不打印、不落盘密钥、工作区地址或任何音频。失败只记错误码。
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { loadQwenConfig } from "../src/ai/config.js";

const samplesWanted = 10;
const idleCapSec = 600;
const idlePollSec = 15;

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function handshakeOnce(url: string, apiKey: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let settled = false;
    const fail = (code: string) => {
      if (settled) return;
      settled = true;
      socket.terminate();
      reject(Error(code));
    };
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      maxPayload: 512 * 1024,
      handshakeTimeout: 10000,
    });
    const timer = setTimeout(() => fail("providerTimeout"), 12000);
    socket.on("error", () => fail("connectionFailed"));
    socket.on("unexpected-response", (_req, response) => fail(`http_${response.statusCode ?? "unknown"}`));
    socket.on("close", () => fail("connectionClosed"));
    socket.on("message", raw => {
      let event: { type?: string };
      try { event = JSON.parse(raw.toString()); }
      catch { fail("invalidProviderEvent"); return; }
      if (event.type === "error") { fail("providerError"); return; }
      if (event.type === "session.created") {
        // 与 WorkspaceVoiceProvider 相同的会话更新，只是指令换成测量用短句，不含题目或录音。
        socket.send(JSON.stringify({
          event_id: randomUUID(),
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            voice: "Tina",
            turn_detection: null,
            audio: {
              input: { format: { type: "pcm", sample_rate: 16000 } },
              output: { format: { type: "pcm", sample_rate: 24000 } },
            },
            instructions: "测量连接。不回答，不解题。",
          },
        }));
      }
      if (event.type === "session.updated") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const elapsed = Math.round(performance.now() - started);
        socket.terminate();
        resolve(elapsed);
      }
    });
  });
}

function watchIdle(url: string, apiKey: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const opened = Date.now();
    let settled = false;
    let updated = false;
    const finish = (sec: number) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      socket.terminate();
      resolve(sec);
    };
    const fail = (code: string) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      socket.terminate();
      reject(Error(code));
    };
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      maxPayload: 512 * 1024,
      handshakeTimeout: 10000,
    });
    const poll = setInterval(() => {
      const sec = Math.round((Date.now() - opened) / 1000);
      // 只记状态码，不记地址。
      console.error(JSON.stringify({ idlePoll: true, readyState: socket.readyState, elapsedSec: sec }));
      if (sec >= idleCapSec) finish(idleCapSec);
    }, idlePollSec * 1000);
    socket.on("error", () => fail(updated ? "idleConnectionFailed" : "connectionFailed"));
    socket.on("unexpected-response", (_req, response) => fail(`http_${response.statusCode ?? "unknown"}`));
    socket.on("close", () => {
      if (!updated) { fail("connectionClosed"); return; }
      finish(Math.max(1, Math.round((Date.now() - opened) / 1000)));
    });
    socket.on("message", raw => {
      let event: { type?: string };
      try { event = JSON.parse(raw.toString()); }
      catch { return; }
      if (event.type === "error") { fail("providerError"); return; }
      if (event.type === "session.created") {
        socket.send(JSON.stringify({
          event_id: randomUUID(),
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            voice: "Tina",
            turn_detection: null,
            audio: {
              input: { format: { type: "pcm", sample_rate: 16000 } },
              output: { format: { type: "pcm", sample_rate: 24000 } },
            },
            instructions: "测量空闲。不回答，不发音频。",
          },
        }));
      }
      if (event.type === "session.updated") updated = true;
    });
  });
}

const config = loadQwenConfig();
const samples: number[] = [];
try {
  for (let i = 0; i < samplesWanted; i++) samples.push(await handshakeOnce(config.url, config.apiKey));
  const idleTimeoutSec = await watchIdle(config.url, config.apiKey);
  console.log(JSON.stringify({
    connectReadyMs: { p50: percentile(samples, 50), p90: percentile(samples, 90), samples },
    idleTimeoutSec,
  }));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    code: error instanceof Error ? error.message : "unknown",
    connectReadyMs: samples.length ? { p50: percentile(samples, 50), p90: percentile(samples, 90), samples } : null,
  }));
  process.exitCode = 1;
}
