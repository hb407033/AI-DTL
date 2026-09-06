import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { AppServerClient } from "../src/app-server-client.js";

const fakeServer = fileURLToPath(new URL("./fake-app-server.mjs", import.meta.url));

async function spawnClient(options: { experimentalApi?: boolean } = {}) {
  return AppServerClient.spawn({ command: process.execPath, args: [fakeServer], experimentalApi: options.experimentalApi ?? true });
}

describe("AppServerClient（stdio JSON-RPC）", () => {
  test("握手：initialize 声明 experimentalApi，收到响应后才发 initialized", async () => {
    const client = await spawnClient();
    const init = await client.initialize({ name: "ai_scholar_probe", title: "AI Scholar Probe", version: "0.1.0" });
    expect(init.userAgent).toBe("fake-app-server/0.0.0");
    const { received } = await client.request<{ received: string[] }>("debug/received", {});
    expect(received.slice(0, 2)).toEqual(["initialize", "initialized"]);
    await client.close();
  });

  test("省略 experimentalApi 时握手被拒绝", async () => {
    const client = await spawnClient({ experimentalApi: false });
    await expect(client.initialize({ name: "x", title: "x", version: "0" })).rejects.toThrow(/requires experimentalApi capability/);
    await client.close();
  });

  test("按 JSON-RPC id 匹配响应，并能收到 realtime started 通知", async () => {
    const client = await spawnClient();
    await client.initialize({ name: "x", title: "x", version: "0" });
    const started = client.waitForNotification<{ threadId: string; version: string }>("thread/realtime/started", 1_000);
    await client.request("thread/realtime/start", { threadId: "t-1", outputModality: "audio" });
    expect(await started).toEqual({ threadId: "t-1", version: "v2" });
    await client.close();
  });

  test("请求超时会拒绝，而不是永远挂起", async () => {
    const client = await spawnClient();
    await client.initialize({ name: "x", title: "x", version: "0" });
    await expect(client.request("slow/never", {}, { timeoutMs: 100 })).rejects.toThrow(/timeout/i);
    await client.close();
  });

  test("close 后子进程正常退出", async () => {
    const client = await spawnClient();
    await client.initialize({ name: "x", title: "x", version: "0" });
    const exitCode = await client.close();
    expect(exitCode).toBe(0);
  });
});
