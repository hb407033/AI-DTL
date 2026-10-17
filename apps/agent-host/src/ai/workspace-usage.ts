// 第一阶段 T4：用量归一化。只保留模型、用途、时间、字节/Token 计数、状态与标识；
// 不存 PCM、照片、密钥、完整转写。未知 usage 不能记 0，价格未知记 null 而非“免费”。
export interface UsageRecord {
  sessionId: string;
  turnId: string;
  callId: string;
  responseId?: string;
  purpose: "transcription" | "teaching" | "decision";
  model: string;
  status: "completed" | "failed" | "cancelled";
  usage: Record<string, unknown> | null;
  estimatedCostCny: number | null;
}

/** 只接受对象形式的 usage；缺失、null、原始值一律记 null，绝不补 0。 */
export function completedUsage(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** 已知 token 计数的粗估；任一缺失或非有限数返回 null，不臆造费用。 */
export function estimateCostCny(
  usage: Record<string, unknown> | null,
  inputPricePerMTokens?: number,
  outputPricePerMTokens?: number,
): number | null {
  if (!usage || inputPricePerMTokens == null || outputPricePerMTokens == null) return null;
  const input = numberOrUndefined(usage.input_tokens) ?? numberOrUndefined(usage.inputTokens);
  const output = numberOrUndefined(usage.output_tokens) ?? numberOrUndefined(usage.outputTokens);
  if (input == null || output == null) return null;
  return (input / 1_000_000) * inputPricePerMTokens + (output / 1_000_000) * outputPricePerMTokens;
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** 追加一行用量元数据到 JSONL；只含标识/模型/用途/时间/状态/计数，不含 PCM/照片/密钥/完整转写。 */
export async function appendUsageJsonl(filePath: string, record: UsageRecord): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const line = JSON.stringify({ ...record, ts: Date.now() }) + "\n";
  await appendFile(filePath, line, { encoding: "utf8" });
}
