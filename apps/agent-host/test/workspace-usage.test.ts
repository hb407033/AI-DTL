import { expect, test } from "vitest";
import { completedUsage, estimateCostCny, type UsageRecord } from "../src/ai/workspace-usage.js";

test("completedUsage：缺失/原始值记 null，对象原样保留，不补 0", () => {
  expect(completedUsage(undefined)).toBeNull();
  expect(completedUsage(null)).toBeNull();
  expect(completedUsage(0)).toBeNull();
  expect(completedUsage("x")).toBeNull();
  expect(completedUsage([1, 2])).toBeNull();
  expect(completedUsage({ input_tokens: 42, output_tokens: 21 })).toEqual({ input_tokens: 42, output_tokens: 21 });
});

test("estimateCostCny：缺价或缺 token 记 null，不显示免费", () => {
  expect(estimateCostCny(null, 1, 2)).toBeNull();
  expect(estimateCostCny({ input_tokens: 42 }, 1, 2)).toBeNull();
  expect(estimateCostCny({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 1, 2)).toBeCloseTo(3);
  expect(estimateCostCny({ input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeNull();
  expect(estimateCostCny({ input_tokens: Number.POSITIVE_INFINITY, output_tokens: 1 }, 1, 2)).toBeNull();
});

test("UsageRecord 契约：转写无 responseId/usage 可为 null，教学带 responseId", () => {
  const asr: UsageRecord = { sessionId: "s", turnId: "t", callId: "c",
    purpose: "transcription", model: "qwen3.5-omni-flash-realtime", status: "completed",
    usage: null, estimatedCostCny: null };
  const teach: UsageRecord = { ...asr, purpose: "teaching", responseId: "r",
    usage: { input_tokens: 10, output_tokens: 5 }, estimatedCostCny: null };
  expect(asr.usage).toBeNull();
  expect(teach.responseId).toBe("r");
});
