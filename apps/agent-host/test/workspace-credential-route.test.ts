import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerRealtimeCredentialRoute, writeKeyHandout } from "../src/ai/workspace-credential-route.js";

const credential = { apiKey: "synthetic-realtime-key", url: "wss://example.test/realtime?model=qwen3.8-omni-flash-realtime" };

async function appFor(directory: string, now = () => Date.parse("2026-11-08T12:00:00Z")) {
  const app = Fastify({ logger: false });
  registerRealtimeCredentialRoute(app, { directory, loadCredential: () => credential, now });
  return app;
}

test("口令正确一次有效，第二次 403", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "key-handout-"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await writeKeyHandout(directory, "246813", "2026-11-08T12:10:00Z");
    const app = await appFor(directory);
    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/workspace/credentials/realtime", payload: { code: "246813" }, remoteAddress: "10.1.0.2" }),
      app.inject({ method: "POST", url: "/workspace/credentials/realtime", payload: { code: "246813" }, remoteAddress: "10.1.0.3" }),
    ]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([200, 403]);
    const ok = first.statusCode === 200 ? first : second;
    expect(ok.json()).toEqual(credential);
    const again = await app.inject({ method: "POST", url: "/workspace/credentials/realtime", payload: { code: "246813" }, remoteAddress: "10.1.0.4" });
    expect(again.statusCode).toBe(403);
    await expect(readFile(path.join(directory, "key-handout.json"), "utf8")).rejects.toThrow();
    const printed = [...warn.mock.calls, ...log.mock.calls].flat().join("\n");
    expect(printed).not.toContain(credential.apiKey);
    expect(printed).not.toContain("246813");
  } finally {
    warn.mockRestore(); log.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("过期口令 403", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "key-handout-expired-"));
  try {
    await writeKeyHandout(directory, "135790", "2026-11-08T11:00:00Z");
    const app = await appFor(directory);
    const response = await app.inject({ method: "POST", url: "/workspace/credentials/realtime", payload: { code: "135790" }, remoteAddress: "10.2.0.2" });
    expect(response.statusCode).toBe(403);
    expect(JSON.stringify(response.json())).not.toContain(credential.apiKey);
    await expect(readFile(path.join(directory, "key-handout.json"), "utf8")).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("错误口令不消耗文件，连续失败后限流", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "key-handout-limit-"));
  try {
    await writeKeyHandout(directory, "112233", "2026-11-08T12:10:00Z");
    const app = await appFor(directory);
    for (let i = 0; i < 8; i++) {
      const wrong = await app.inject({ method: "POST", url: "/workspace/credentials/realtime", payload: { code: "000000" }, remoteAddress: "10.3.0.9" });
      expect(wrong.statusCode).toBe(403);
    }
    expect(await readFile(path.join(directory, "key-handout.json"), "utf8")).toContain("112233");
    const limited = await app.inject({ method: "POST", url: "/workspace/credentials/realtime", payload: { code: "112233" }, remoteAddress: "10.3.0.9" });
    expect(limited.statusCode).toBe(429);
    expect(await readFile(path.join(directory, "key-handout.json"), "utf8")).toContain("112233");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
