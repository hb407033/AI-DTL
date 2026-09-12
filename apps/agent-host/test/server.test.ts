// apps/agent-host/test/server.test.ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { buildHostServer, buildHostServers, CHILD_LISTEN, PARENT_LISTEN } from "../src/server.js";

let baseUrl = "";
let parentUrl = "";
const headers = { "X-Parent-Token": "test-parent-token" };
let app: Awaited<ReturnType<typeof buildHostServer>>;
let parentApp: typeof app;

// 轮询等待条件成立，最多 2 秒；比固定 sleep 稳定
async function until(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("等待超时");
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeAll(async () => {
  ({ childApp: app, parentApp } = await buildHostServers({ bridge: "parent", dataDir: null, parentToken: "test-parent-token" }));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (typeof address === "object" && address) baseUrl = `127.0.0.1:${address.port}`;
  parentUrl = await parentApp.listen({ host: PARENT_LISTEN.host, port: 0 });
});
afterAll(async () => { await app.close(); });

describe("宿主 HTTP/WS", () => {
  test("/healthz 与家长控制台页面可达", async () => {
    expect(await (await fetch(`http://${baseUrl}/healthz`)).json()).toEqual({ status: "ok", bridge: "parent" });
    expect(CHILD_LISTEN).toEqual({ host: "0.0.0.0", port: 8788 });
    expect(PARENT_LISTEN).toEqual({ host: "127.0.0.1", port: 8789 });
    expect((await fetch(`http://${baseUrl}/parent`)).status).toBe(404);
    const html = await (await fetch(`${parentUrl}/parent`)).text();
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

    const view = await (await fetch(`${parentUrl}/parent/sessions/s-ws`, { headers })).json() as { state: string; pending: { purpose: string } | null };
    expect(view.state).toBe("INTERVENING");
    expect(view.pending?.purpose).toBe("hint");

    const res = await fetch(`${parentUrl}/parent/sessions/s-ws/proposal`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ spokenResponse: "你确定了什么？", learnerTask: "说说", hintLevel: 1 }) });
    expect(res.status).toBe(200);
    await until(() => received.some((f) => f.type === "outbound" && f.message?.type === "speak"));
    ws.close();
  });
});

describe("家长端只在本机可达（设计稿 8.1、11.2）", () => {
  test("来自局域网其他设备的 /parent 请求被拒，孩子的 iPad 看不到能力分析", async () => {
    for (const url of ["/parent", "/parent/sessions", "/parent/sessions/s-ws"]) {
      expect((await app.inject({ method: "GET", url, remoteAddress: "192.168.97.42" })).statusCode).toBe(404);
      const res = await parentApp.inject({ method: "GET", url, headers, remoteAddress: "192.168.97.42" });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: "家长视图只能在学习主机本机打开" });
    }
    const post = await parentApp.inject({ method: "POST", url: "/parent/sessions/s-ws/proposal", headers, remoteAddress: "192.168.97.42", payload: { spokenResponse: "", learnerTask: "t", hintLevel: 1 } });
    expect(post.statusCode).toBe(403);
  });

  test("儿童端通道不受影响：/healthz 与 /session 仍对局域网开放", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz", remoteAddress: "192.168.97.42" });
    expect(res.statusCode).toBe(200);
  });

  test("本机访问照常", async () => {
    for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      const res = await parentApp.inject({ method: "GET", url: "/parent/sessions", headers, remoteAddress: addr });
      expect(res.statusCode).toBe(200);
    }
  });
  test("本机 API 也必须带正确 token，家长端不提供儿童路由或 CORS", async () => {
    for (const token of [undefined, "incorrect"]) {
      expect((await fetch(`${parentUrl}/parent/sessions`, { headers: token ? { "X-Parent-Token": token } : {} })).status).toBe(401);
    }
    for (const url of ["/healthz", "/session", "/child/first-use"]) {
      expect((await parentApp.inject({ url })).statusCode).toBe(404);
    }
    const preflight = await parentApp.inject({ method: "OPTIONS", url: "/parent/sessions", headers: { origin: "http://evil.example", "access-control-request-headers": "X-Parent-Token" } });
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    expect(preflight.statusCode).not.toBe(200);
    for (const method of ["GET", "POST", "DELETE", "OPTIONS"] as const) {
      expect((await app.inject({ method, url: "/parent/sessions", headers })).statusCode).toBe(404);
    }
  });
});
