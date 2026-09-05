import { describe, expect, test } from "vitest";
import { summarizeMetrics, type MetricSample } from "../src/metrics.js";

// 与 Swift 侧 MetricRecorderTests 完全相同的样本：1...20 ms，第 20 个标记失败
function twentySamples(): MetricSample[] {
  return Array.from({ length: 20 }, (_, i) => ({
    metric: "pen_render_ms",
    elapsedMs: i + 1,
    success: i + 1 !== 20,
  }));
}

describe("summarizeMetrics（nearest-rank 百分位，与 Swift 端对齐）", () => {
  test("20 个样本时 P50=10、P95=19、成功数=19", () => {
    const summary = summarizeMetrics(twentySamples());
    expect(summary.count).toBe(20);
    expect(summary.successCount).toBe(19);
    expect(summary.p50Ms).toBe(10);
    expect(summary.p95Ms).toBe(19);
    expect(summary.maxMs).toBe(20);
  });

  test("空样本必须抛错，而不是返回 0", () => {
    expect(() => summarizeMetrics([])).toThrowError();
  });

  test("单个样本时 P50、P95、max 都等于该值", () => {
    const summary = summarizeMetrics([{ metric: "lan_ack_ms", elapsedMs: 7, success: true }]);
    expect(summary.p50Ms).toBe(7);
    expect(summary.p95Ms).toBe(7);
    expect(summary.maxMs).toBe(7);
  });
});
