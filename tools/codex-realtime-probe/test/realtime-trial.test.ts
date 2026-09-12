import { describe, expect, test } from "vitest";
import { runRealtimeTrial, type TrialClient } from "../src/realtime-trial.js";

function fake(mode: "audio" | "auth" | "silent" | "stop-error" | "invalid-audio" | "stop-notice" = "audio") {
  const listeners = new Set<(method: string, params: unknown) => void>();
  const calls: Array<{ method: string; params: unknown }> = [];
  const emit = (method: string, params: unknown) => { for (const fn of listeners) fn(`thread/realtime/${method}`, params); };
  const client: TrialClient = {
    onNotification(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async request(method, params) {
      calls.push({ method, params });
      if (method.endsWith("/start")) {
        if (mode === "auth") emit("error", { threadId: "t", message: "realtime conversation requires API key auth" });
        else emit("started", { threadId: "t", version: "v2" });
      }
      if (method.endsWith("/appendAudio") || method.endsWith("/appendText")) {
        emit("outputAudio/delta", { threadId: "other", audio: { data: "AQI=", sampleRate: 24000, numChannels: 1 } });
        if (mode !== "silent") emit("outputAudio/delta", { threadId: "t", audio: mode === "invalid-audio" ? { data: "AQ==", sampleRate: 0, numChannels: 0 } : { data: "AQI=", sampleRate: 24000, numChannels: 1 } });
      }
      if (method.endsWith("/stop") && mode === "stop-error") throw new Error("stop failed");
      if (method.endsWith("/stop") && mode === "stop-notice") emit("error", { threadId: "t", message: "stop failed" });
      return {};
    },
  };
  return { client, calls, listeners };
}

describe("实时回合：可在无 iPad、无模型条件验证协议行为", () => {
  test("音频经 appendAudio 发送，静音分块包含格式，停止后清理监听", async () => {
    const f = fake();
    const result = await runRealtimeTrial(f.client, "t", { kind: "audio", chunks: [
      { data: "AQI=", sampleRate: 24000, numChannels: 1, samplesPerChannel: 1 },
      { data: "AAA=", sampleRate: 24000, numChannels: 1, samplesPerChannel: 1 },
    ] }, { pause: async () => {}, timeoutMs: 50 });
    expect(result.ok).toBe(true);
    expect(f.calls.map(c => c.method)).toEqual(["thread/realtime/start", "thread/realtime/appendAudio", "thread/realtime/appendAudio", "thread/realtime/stop"]);
    expect((f.calls[1]!.params as { audio: unknown }).audio).toMatchObject({ sampleRate: 24000, numChannels: 1 });
    expect(f.listeners.size).toBe(0);
  });
  test("start 拒绝身份时不发送任何输入，错误按阻塞归类", async () => {
    const f = fake("auth");
    const result = await runRealtimeTrial(f.client, "t", { kind: "text", text: "固定测试" }, { timeoutMs: 50 });
    expect(result).toMatchObject({ ok: false, blocked: true });
    expect(f.calls.some(c => c.method.includes("append"))).toBe(false);
    expect(f.listeners.size).toBe(0);
  });
  test("其他线程音频不误判成功，超时仍停止并清理", async () => {
    const f = fake("silent");
    expect(await runRealtimeTrial(f.client, "t", { kind: "text", text: "测试" }, { timeoutMs: 20 })).toMatchObject({ ok: false, blocked: false });
    expect(f.calls.at(-1)?.method).toBe("thread/realtime/stop");
    expect(f.listeners.size).toBe(0);
  });
  test("停止失败不能记作成功回合", async () => {
    const f = fake("stop-error");
    expect(await runRealtimeTrial(f.client, "t", { kind: "text", text: "测试" }, { timeoutMs: 50 })).toMatchObject({ ok: false, error: expect.stringContaining("stop failed") });
  });
  test.each(["invalid-audio", "stop-notice"] as const)("%s 不得假报 PASS", async mode => {
    const f = fake(mode);
    expect(await runRealtimeTrial(f.client, "t", { kind: "text", text: "测试" }, { timeoutMs: 50 })).toMatchObject({ ok: false });
    expect(f.listeners.size).toBe(0);
  });
  test("分块逐个成功也受整回合截止时间限制", async () => {
    const f = fake();
    const chunk = { data: "AQI=", sampleRate: 24000, numChannels: 1, samplesPerChannel: 1 };
    const result = await runRealtimeTrial(f.client, "t", { kind: "audio", chunks: [chunk, chunk] }, {
      timeoutMs: 50, overallTimeoutMs: 5, pause: async () => { await new Promise(resolve => setTimeout(resolve, 10)); },
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("deadline") });
    expect(f.calls.at(-1)?.method).toBe("thread/realtime/stop");
  });
});
