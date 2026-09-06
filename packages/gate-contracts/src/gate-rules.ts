// 门禁规则表与判定。与 iPad 端 Swift 的 GateThresholds / LatencyGate 是同一张表、同一判定逻辑（计划 §0）。
import { summarizeMetrics, type MetricName, type MetricSample, type MetricSummary } from "./metrics.js";

export interface GateRule {
  p95LimitMs: number;
  minSamples: number;
  p50LimitMs?: number;
}

export const GATE_RULES: Record<MetricName, GateRule> = {
  pen_render_ms: { p95LimitMs: 50, minSamples: 100 },
  local_interrupt_ms: { p95LimitMs: 200, minSamples: 20 },
  lan_ack_ms: { p95LimitMs: 150, minSamples: 100 },
  first_audio_ms: { p95LimitMs: 3000, minSamples: 20, p50LimitMs: 1500 },
  remote_canvas_ms: { p95LimitMs: 300, minSamples: 20 },
  reconnect_ms: { p95LimitMs: 5000, minSamples: 5 },
};

/** 样本成功率下限：超时/失败的样本仍参与百分位，但成功率不足也判失败，避免"全超时但 P95 恰好达标"的假通过。 */
export const MIN_SUCCESS_RATIO = 0.95;

export type GateVerdict =
  | { kind: "insufficient"; have: number; need: number }
  | { kind: "pass"; summary: MetricSummary }
  | { kind: "fail"; summary: MetricSummary; reasons: string[] };

export function evaluateGate(samples: readonly MetricSample[], metric: MetricName | undefined = samples[0]?.metric): GateVerdict {
  if (!metric) throw new Error("evaluateGate: 没有样本且未指定指标");
  const rule = GATE_RULES[metric];
  if (samples.length < rule.minSamples) return { kind: "insufficient", have: samples.length, need: rule.minSamples };
  const summary = summarizeMetrics(samples);
  const reasons: string[] = [];
  if (summary.successCount / summary.count < MIN_SUCCESS_RATIO) reasons.push(`成功 ${summary.successCount}/${summary.count} 低于 95%`);
  if (summary.p95Ms > rule.p95LimitMs) reasons.push(`P95 ${summary.p95Ms.toFixed(1)} > 阈值 ${rule.p95LimitMs} ms`);
  if (rule.p50LimitMs !== undefined && summary.p50Ms > rule.p50LimitMs) reasons.push(`P50 ${summary.p50Ms.toFixed(1)} > 阈值 ${rule.p50LimitMs} ms`);
  return reasons.length > 0 ? { kind: "fail", summary, reasons } : { kind: "pass", summary };
}
