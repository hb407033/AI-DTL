// 门禁结果 JSON 的运行时校验。iPad 导出与探针输出进入报告器前都先过这里，防止字段名或枚举悄悄漂移。
import { z } from "zod";
import { METRIC_NAMES } from "./metrics.js";

export const metricNameSchema = z.enum(METRIC_NAMES);

export const metricSampleSchema = z.object({
  metric: metricNameSchema,
  elapsedMs: z.number().nonnegative(),
  success: z.boolean(),
});

export const metricSummarySchema = z.object({
  count: z.number().int().positive(),
  successCount: z.number().int().nonnegative(),
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  maxMs: z.number().nonnegative(),
});

export type MetricSampleInput = z.infer<typeof metricSampleSchema>;
export type MetricSummaryInput = z.infer<typeof metricSummarySchema>;
