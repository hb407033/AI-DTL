// 门禁指标的统计算法。iPad 端 Swift 的 MetricRecorder 与这里必须是同一算法，报告器才能跨端比较。

/** 六项门禁指标名。字面量即 Swift 端 MetricName 的 rawValue，两端不得各自改名。 */
export const METRIC_NAMES = [
  "pen_render_ms",
  "local_interrupt_ms",
  "lan_ack_ms",
  "first_audio_ms",
  "remote_canvas_ms",
  "reconnect_ms",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export interface MetricSample {
  metric: MetricName;
  elapsedMs: number;
  success: boolean;
}

export interface MetricSummary {
  count: number;
  successCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/**
 * 用 nearest-rank 法算百分位：取排序后第 ceil(p·n) 个样本，不做插值。
 * 选它是因为两端实现只需一行且结果完全一致；插值法在小样本上会让 Swift 与 TS 各差一点。
 * 空样本抛错而不是返回 0，避免把"没测"伪装成"0 毫秒"。
 */
export function summarizeMetrics(samples: readonly MetricSample[]): MetricSummary {
  if (samples.length === 0) {
    throw new Error("summarizeMetrics: 样本为空，不能生成摘要");
  }
  const values = samples.map((s) => s.elapsedMs).sort((a, b) => a - b);
  const nearestRank = (percentile: number): number =>
    values[Math.max(0, Math.ceil(percentile * values.length) - 1)]!;
  return {
    count: samples.length,
    successCount: samples.filter((s) => s.success).length,
    p50Ms: nearestRank(0.5),
    p95Ms: nearestRank(0.95),
    maxMs: values[values.length - 1]!,
  };
}
