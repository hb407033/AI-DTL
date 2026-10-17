import { randomUUID } from "node:crypto";
import type { QwenConfig } from "./config.js";
import { completedUsage, type UsageRecord } from "./workspace-usage.js";

/** 思考模式 SSE 累加器：只保留文本和存在性标志，不保存思维链内容。 */
export class SseAccumulator {
  private pending = "";
  text = ""; usage: Record<string, unknown> | null = null; done = false; finishReason: string | null = null;
  reasoningObserved = false;
  push(chunk: string) {
    this.pending += chunk;
    let separator: RegExpExecArray | null;
    while ((separator = /\r?\n\r?\n/u.exec(this.pending))) {
      const frame = this.pending.slice(0, separator.index);
      this.pending = this.pending.slice(separator.index + separator[0].length);
      const data = frame.split(/\r?\n/u).filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      if (data === "[DONE]") { this.done = true; continue; }
      const event = JSON.parse(data);
      if (event.error) throw Error("providerStreamError");
      if (event.usage) this.usage = event.usage;
      for (const c of event.choices ?? []) {
        if (typeof c.delta?.content === "string") this.text += c.delta.content;
        // 只保留存在性，不保留思维链内容。
        if (c.delta?.reasoning_content) this.reasoningObserved = true;
        if (c.finish_reason) this.finishReason = c.finish_reason;
      }
      if (this.text.length > 16000) throw Error("responseTooLong");
    }
  }
  finish() { if (!this.done || this.pending.trim()) throw Error("incompleteSse"); }
}

/** 思考通道的模型与参数。与消融脚本保持一致。 */
const THINKING_MODEL = "qwen3.8-omni-flash";
const REASONING_EFFORT = "medium" as const;
const MAX_TOKENS = 4096;

/**
 * 非实时思考文本请求：通过 compatible-mode HTTP 接口调用思考模型，
 * 返回纯文本。与 requestWorkspaceText 签名兼容，可互换注入决策 provider。
 * 用量记录通过 onUsage 回调上报，与实时通道一致。
 */
export async function requestThinkingText(
  config: QwenConfig,
  instructions: string,
  image?: Buffer,
  signal?: AbortSignal,
  context?: {
    sessionId: string; turnId: string; purpose: "decision";
    onUsage?: ((record: UsageRecord) => void) | undefined;
    onReasoningObserved?: ((observed: boolean) => void) | undefined;
    onFinishReason?: ((reason: string | null) => void) | undefined;
  },
): Promise<string> {
  if (image && (!image.length || image.length > 180000)) throw Error("imageSize");
  if (!instructions.trim() || instructions.length > 16000) throw Error("invalidInstructions");
  if (signal?.aborted) throw Error("aborted");
  const url = new URL("/compatible-mode/v1/chat/completions", "https://" + new URL(config.url).hostname);
  const boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(45000)]);
  const stream = new SseAccumulator();
  let status: UsageRecord["status"] = "failed";
  const callId = randomUUID();
  try {
  const response = await fetch(url, {
    method: "POST", signal: boundedSignal,
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: THINKING_MODEL, reasoning_effort: REASONING_EFFORT, max_tokens: MAX_TOKENS,
      modalities: ["text"], stream: true, stream_options: { include_usage: true },
      messages: [{ role: "user", content: image
        ? [{ type: "text", text: instructions },
           { type: "image_url", image_url: { url: `data:${image[0] === 255 && image[1] === 216 ? "image/jpeg" : "image/png"};base64,${image.toString("base64")}` } }]
        : [{ type: "text", text: instructions }] }],
    }),
  });
  if (!response.ok) throw Error(`http_${response.status}`);
  if (!response.body) throw Error("missingStream");
  const decoder = new TextDecoder();
    for await (const chunk of response.body) stream.push(decoder.decode(chunk, { stream: true }));
    stream.push(decoder.decode()); stream.finish();
    if (stream.finishReason !== "stop") throw Error("incompleteThinkingResponse");
    status = "completed";
    return stream.text.trim();
  } catch (error) {
    if (boundedSignal.aborted) status = "cancelled";
    throw error;
  } finally {
    if (context?.onUsage) {
      try {
        context.onUsage({
          sessionId: context.sessionId, turnId: context.turnId, callId,
          purpose: context.purpose, model: THINKING_MODEL, status,
          usage: stream.usage, estimatedCostCny: null,
        });
      } catch { /* 用量记录失败不改变教学结果。 */ }
    }
    try {
      context?.onReasoningObserved?.(stream.reasoningObserved);
      context?.onFinishReason?.(stream.finishReason);
    } catch { /* 遥测异常不能改写调用结果。 */ }
  }
}
