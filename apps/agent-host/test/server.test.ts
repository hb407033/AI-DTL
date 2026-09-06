// apps/agent-host/test/server.test.ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { buildHostServer } from "../src/server.js";

let baseUrl = "";
let app: Awaited<ReturnType<typeof buildHostServer>>;

// 轮询等待条件成立，最多 2 秒；比固定 sleep 稳定
async function until(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("等待超时");
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeAll(async () => {
  app = await buildHostServer({ bridge: "parent", dataDir: null });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (typeof address === "object" && address) baseUrl = `127.0.0.1:${address.port}`;
});
afterAll(async () => { await app.close(); });

describe("宿主 HTTP/WS", () => {
  test("/healthz 与家长控制台页面可达", async () => {
    expect(await (await fetch(`http://${baseUrl}/healthz`)).json()).toEqual({ status: "ok", bridge: "parent" });
    const html = await (await fetch(`http://${baseUrl}/parent`)).text();
    expect(html).toContain("家长控制台");
  });

  test("WebSocket 打开会话收到 outbound，发事件收到 ack，家长 API 能看到状态并提交提案", async () => {
    const ws = new WebSocket(`ws://${baseUrl}/session?sessionId=s-ws`);
    const received: Array<{ type: string; message?: { type: string } }> = [];
    ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    await until(() => received.length >= 2);
    expect(received.map((f) => f.type)).toEqual(["outbound", "outbound"]);

    ws.send(JSON.stringify({ protocolVersion: 1, type: "event", id: "f-1", clientSeq: 1, sessionId: "s-ws", sentAt: 1,
      event: { eventId: "f-1", clientSessionId: "s-ws", deviceId: "d", clientSeq: 1, occurredAt: 1, quality: "confirmed", source: "child_button", semanticObjectIds: [], payload: { type: "HELP_REQUEST" } } }));
    await until(() => received.some((f) => f.type === "ack"));

    const view = await (await fetch(`http://${baseUrl}/parent/sessions/s-ws`)).json() as { state: string; pending: { purpose: string } | null };
    expect(view.state).toBe("INTERVENING");
    expect(view.pending?.purpose).toBe("hint");

    const res = await fetch(`http://${baseUrl}/parent/sessions/s-ws/proposal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spokenResponse: "你确定了什么？", learnerTask: "说说", hintLevel: 1 }) });
    expect(res.status).toBe(200);
    await until(() => received.some((f) => f.type === "outbound" && f.message?.type === "speak"));
    ws.close();
  });
});

describe("家长端只在本机可达（设计稿 8.1、11.2）", () => {
  test("来自局域网其他设备的 /parent 请求被拒，孩子的 iPad 看不到能力分析", async () => {
    for (const url of ["/parent", "/parent/sessions", "/parent/sessions/s-ws"]) {
      const res = await app.inject({ method: "GET", url, remoteAddress: "192.168.97.42" });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: "家长视图只能在学习主机本机打开" });
    }
    const post = await app.inject({ method: "POST", url: "/parent/sessions/s-ws/proposal", remoteAddress: "192.168.97.42", payload: { spokenResponse: "", learnerTask: "t", hintLevel: 1 } });
    expect(post.statusCode).toBe(403);
  });

  test("儿童端通道不受影响：/healthz 与 /session 仍对局域网开放", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz", remoteAddress: "192.168.97.42" });
    expect(res.statusCode).toBe(200);
  });

  test("本机访问照常", async () => {
    for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      const res = await app.inject({ method: "GET", url: "/parent/sessions", remoteAddress: addr });
      expect(res.statusCode).toBe(200);
    }
  });
});
