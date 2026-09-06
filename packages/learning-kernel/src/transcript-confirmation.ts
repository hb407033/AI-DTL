// 转写确认的推导（设计稿 10.2、13「转写不确定」）。
// 确认本身是一条独立事件，原事件永不改写——事件日志是幂等可重放的，改写历史会让重放得出不同结论。
// 因此「这条转写到底确认了没有」由「原事件 + 后续 CONFIRM_TRANSCRIPT」推导出来，
// 任何后来的读者（会话恢复、成长账本的证据计数）都必须走这个函数，而不是直接读原事件的 quality。
import type { EvidenceEvent } from "@ai-scholar/session-contracts";

/** 能被确认或修正的事件类型：都带一段来自语音识别的文本 */
type TextPayload = Extract<EvidenceEvent["payload"], { text: string }>;

function isTextPayload(payload: EvidenceEvent["payload"]): payload is TextPayload {
  return payload.type === "UTTERANCE" || payload.type === "ANSWER" || payload.type === "EXPLAIN";
}

/**
 * 把确认事件折叠回被确认的事件上，返回等长的新数组（顺序不变）。
 * 未确认、被孩子否认、或没有对应确认事件的，一律保持原样（仍是 unconfirmed，不参与证据计数）。
 * 同一条转写被确认多次时以最后一次为准。
 */
export function resolveConfirmedEvents(events: readonly EvidenceEvent[]): EvidenceEvent[] {
  const confirmations = new Map<string, { confirmed: boolean; correctedText?: string | undefined }>();
  for (const event of events) {
    if (event.payload.type !== "CONFIRM_TRANSCRIPT") continue;
    confirmations.set(event.payload.targetEventId, { confirmed: event.payload.confirmed, correctedText: event.payload.correctedText });
  }
  if (confirmations.size === 0) return [...events];

  return events.map((event) => {
    const decision = confirmations.get(event.eventId);
    if (!decision || !decision.confirmed || !isTextPayload(event.payload)) return event;
    const text = decision.correctedText ?? event.payload.text;
    return {
      ...event,
      quality: decision.correctedText === undefined ? "confirmed" : "corrected",
      payload: { ...event.payload, text },
    };
  });
}
