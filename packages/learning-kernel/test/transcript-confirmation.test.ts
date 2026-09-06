import { describe, expect, test } from "vitest";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { resolveConfirmedEvents } from "../src/transcript-confirmation.js";

// 确认结果本身是一条独立事件（10.2），原事件不可变。有效质量由「原事件 + 后续 CONFIRM_TRANSCRIPT」推导，
// 这样宿主重启后重放同一批事件仍得到同一结论，不依赖某次内存里的临时对象。
function ev(eventId: string, clientSeq: number, payload: EvidenceEvent["payload"], quality: EvidenceEvent["quality"] = "confirmed"): EvidenceEvent {
  return { eventId, clientSessionId: "s", deviceId: "d", clientSeq, occurredAt: clientSeq, quality, source: "child_voice", semanticObjectIds: [], payload };
}

describe("转写确认的推导（设计稿 10.2、13）", () => {
  test("孩子确认后，原本 unconfirmed 的转写变成 confirmed", () => {
    const events = [
      ev("e-1", 1, { type: "UTTERANCE", text: "四十一" }, "unconfirmed"),
      ev("e-2", 2, { type: "CONFIRM_TRANSCRIPT", targetEventId: "e-1", confirmed: true }),
    ];
    const resolved = resolveConfirmedEvents(events);
    expect(resolved[0]).toMatchObject({ eventId: "e-1", quality: "confirmed", payload: { type: "UTTERANCE", text: "四十一" } });
  });

  test("孩子修正后质量是 corrected，文本换成修正稿", () => {
    const events = [
      ev("e-1", 1, { type: "UTTERANCE", text: "四十一" }, "unconfirmed"),
      ev("e-2", 2, { type: "CONFIRM_TRANSCRIPT", targetEventId: "e-1", confirmed: true, correctedText: "0.72" }),
    ];
    expect(resolveConfirmedEvents(events)[0]).toMatchObject({ quality: "corrected", payload: { type: "UTTERANCE", text: "0.72" } });
  });

  test("孩子说不是这样，转写永久停在 unconfirmed", () => {
    const events = [
      ev("e-1", 1, { type: "UTTERANCE", text: "四十一" }, "unconfirmed"),
      ev("e-2", 2, { type: "CONFIRM_TRANSCRIPT", targetEventId: "e-1", confirmed: false }),
    ];
    expect(resolveConfirmedEvents(events)[0]?.quality).toBe("unconfirmed");
  });

  test("没有确认事件时原样返回；已确认的事件不被改写", () => {
    const events = [ev("e-1", 1, { type: "UTTERANCE", text: "嗯" }, "unconfirmed"), ev("e-2", 2, { type: "ANSWER", text: "0.72" })];
    const resolved = resolveConfirmedEvents(events);
    expect(resolved[0]?.quality).toBe("unconfirmed");
    expect(resolved[1]).toEqual(events[1]);
  });

  test("同一条转写被确认两次时以最后一次为准", () => {
    const events = [
      ev("e-1", 1, { type: "UTTERANCE", text: "a" }, "unconfirmed"),
      ev("e-2", 2, { type: "CONFIRM_TRANSCRIPT", targetEventId: "e-1", confirmed: true }),
      ev("e-3", 3, { type: "CONFIRM_TRANSCRIPT", targetEventId: "e-1", confirmed: true, correctedText: "b" }),
    ];
    expect(resolveConfirmedEvents(events)[0]).toMatchObject({ quality: "corrected", payload: { type: "UTTERANCE", text: "b" } });
  });

  test("确认指向不存在的事件时不报错，也不产生新事件", () => {
    const events = [ev("e-2", 2, { type: "CONFIRM_TRANSCRIPT", targetEventId: "nope", confirmed: true })];
    expect(resolveConfirmedEvents(events)).toEqual(events);
  });
});
