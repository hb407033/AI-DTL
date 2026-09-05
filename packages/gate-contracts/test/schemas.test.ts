import { describe, expect, test } from "vitest";
import { metricSampleSchema, metricSummarySchema } from "../src/schemas.js";

describe("结果 JSON 校验 schema", () => {
  test("接受 Swift 端导出的指标样本", () => {
    const parsed = metricSampleSchema.parse({ metric: "local_interrupt_ms", elapsedMs: 120.5, success: true });
    expect(parsed.metric).toBe("local_interrupt_ms");
  });

  test("拒绝未知指标名，防止两端枚举漂移", () => {
    expect(() => metricSampleSchema.parse({ metric: "typo_ms", elapsedMs: 1, success: true })).toThrowError();
  });

  test("拒绝负数耗时", () => {
    expect(() => metricSampleSchema.parse({ metric: "lan_ack_ms", elapsedMs: -1, success: true })).toThrowError();
  });

  test("摘要要求 count 为正整数", () => {
    expect(() =>
      metricSummarySchema.parse({ count: 0, successCount: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 }),
    ).toThrowError();
  });
});
