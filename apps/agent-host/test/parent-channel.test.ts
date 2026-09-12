import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { loadParentToken } from "../src/parent-channel.js";
import { buildHostServers } from "../src/server.js";

test("凭据在独立目录生成并以 0600 保存，重启复用", () => {
  const directory = mkdtempSync(join(tmpdir(), "parent-channel-token-"));
  try {
    const token = loadParentToken(directory);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(loadParentToken(directory)).toBe(token);
    expect(statSync(join(directory, "parent-token")).mode & 0o777).toBe(0o600);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("关闭儿童服务器连带关闭家长监听与共享数据库且只释放一次", async () => {
  const directory = mkdtempSync(join(tmpdir(), "parent-channel-close-"));
  const { childApp, parentApp, ledger } = await buildHostServers({ bridge: "parent", dataDir: directory, parentToken: "test-parent-token" });
  const close = vi.spyOn(ledger!, "close");
  try {
    await parentApp.listen({ host: "127.0.0.1", port: 0 });
    await childApp.listen({ host: "127.0.0.1", port: 0 });
    await childApp.close();
    await childApp.close();
    await parentApp.close();
    expect(parentApp.server.listening).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  } finally { await childApp.close(); rmSync(directory, { recursive: true, force: true }); }
});
