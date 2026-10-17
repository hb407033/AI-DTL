import { expect, test } from "vitest";
import { inspectAiConfig, loadPiConfig, loadQwenConfig } from "../src/ai/config.js";

test("配置检查仅返回缺失名称，不泄漏配置值", () => {
  const report = inspectAiConfig({ DASHSCOPE_API_KEY: "test-secret-never-display" });
  expect(report.qwen.missing).toEqual(["AI_DTL_QWEN_WORKSPACE_ID"]);
  expect(report.pi.ready).toBe(false);
  expect(JSON.stringify(report)).not.toContain("test-secret-never-display");
});
test("千问使用工作空间北京 WSS 和指定 Flash 实时模型", () => {
  const config = loadQwenConfig({ DASHSCOPE_API_KEY: "synthetic", AI_DTL_QWEN_WORKSPACE_ID: "test-space" });
  expect(config.url).toBe("wss://test-space.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime");
  expect(config.decisionMode).toBe("realtime");
  expect(() => loadQwenConfig({ DASHSCOPE_API_KEY: "secret", AI_DTL_QWEN_WORKSPACE_ID: "x.evil/path" })).toThrow("AI_DTL_QWEN_WORKSPACE_ID");
  expect(() => loadQwenConfig({})).toThrow("DASHSCOPE_API_KEY");
});
test("决策通道默认 realtime，显式 thinking 时切换", () => {
  const realtime = loadQwenConfig({ DASHSCOPE_API_KEY: "k", AI_DTL_QWEN_WORKSPACE_ID: "s" });
  expect(realtime.decisionMode).toBe("realtime");
  const thinking = loadQwenConfig({ DASHSCOPE_API_KEY: "k", AI_DTL_QWEN_WORKSPACE_ID: "s", AI_DTL_DECISION_MODE: "thinking" });
  expect(thinking.decisionMode).toBe("thinking");
  const fallback = loadQwenConfig({ DASHSCOPE_API_KEY: "k", AI_DTL_QWEN_WORKSPACE_ID: "s", AI_DTL_DECISION_MODE: "bogus" });
  expect(fallback.decisionMode).toBe("realtime");
});
test("Pi 必须指定 provider 和模型，不继承本地默认模型", () => {
  expect(() => loadPiConfig({})).toThrow("AI_DTL_PI_PROVIDER");
  expect(loadPiConfig({ AI_DTL_PI_PROVIDER: "test", AI_DTL_PI_MODEL: "test-model" })).toMatchObject({ command: "pi", provider: "test", model: "test-model" });
});
