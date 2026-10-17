import { afterEach, expect, test, vi } from "vitest";
import { requestThinkingText } from "../src/ai/qwen-thinking-text.js";
import type { UsageRecord } from "../src/ai/workspace-usage.js";
const config = { apiKey: "test-only", url: "wss://test.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime", decisionMode: "thinking" as const };
afterEach(() => vi.unstubAllGlobals());

test("HTTP失败也上报failed和未知usage，不冒充completed或免费", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not-authorized", { status: 403 })));
  const usage: UsageRecord[] = [];
  await expect(requestThinkingText(config, "请求", undefined, undefined, { sessionId: "s", turnId: "t", purpose: "decision", onUsage: r => usage.push(r) })).rejects.toThrow("http_403");
  expect(usage).toHaveLength(1); expect(usage[0]).toMatchObject({ status: "failed", usage: null, estimatedCostCny: null });
});

test("SSE缺尾保持失败，JPEG按真实MIME发送且带本地超时signal", async () => {
  const fetcher = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"片段"}}]}\n\n', { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const usage: UsageRecord[] = [];
  await expect(requestThinkingText(config, "请求", Buffer.from([255, 216, 255, 0]), undefined,
    { sessionId: "s", turnId: "t", purpose: "decision", onUsage: r => usage.push(r) })).rejects.toThrow("incompleteSse");
  const options = (fetcher.mock.calls[0] as any)[1];
  expect(JSON.parse(options.body).messages[0].content[1].image_url.url).toContain("data:image/jpeg;");
  expect(options.signal).toBeInstanceOf(AbortSignal); expect(usage[0]?.status).toBe("failed");
});
