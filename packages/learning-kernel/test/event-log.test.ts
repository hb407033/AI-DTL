// packages/learning-kernel/test/event-log.test.ts
import { describe, expect, test } from "vitest";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { EventLog, canonicalJson, contentHashOf } from "../src/event-log.js";

function ev(eventId: string, clientSeq: number, text = "hi"): EvidenceEvent {
  return { eventId, clientSessionId: "s-1", deviceId: "d-1", clientSeq, occurredAt: 1_757_200_000_000 + clientSeq, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload: { type: "UTTERANCE", text } };
}

describe("幂等事件日志（设计稿 10.2）", () => {
  test("规范化 JSON 与键顺序无关，哈希因此稳定", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
    expect(contentHashOf(ev("e-1", 1))).toBe(contentHashOf({ ...ev("e-1", 1), semanticObjectIds: [] }));
    expect(contentHashOf(ev("e-1", 1, "a"))).not.toBe(contentHashOf(ev("e-1", 1, "b")));
  });

  test("顺序追加得到递增 serverSeq 并推进 lastConfirmedSeq", () => {
    const log = new EventLog();
    const r1 = log.append(ev("e-1", 1), 1_000);
    const r2 = log.append(ev("e-2", 2), 1_001);
    expect(r1).toMatchObject({ kind: "appended", stored: { serverSeq: 1, receivedAt: 1_000 } });
    expect(r2).toMatchObject({ kind: "appended", stored: { serverSeq: 2 } });
    expect(log.lastConfirmedSeq).toBe(2);
  });

  test("同一 event_id 重放返回原记录，不重复计入", () => {
    const log = new EventLog();
    log.append(ev("e-1", 1), 1_000);
    const replay = log.append(ev("e-1", 1), 9_000);
    expect(replay).toMatchObject({ kind: "duplicate", stored: { receivedAt: 1_000 } });
    expect(log.all()).toHaveLength(1);
  });

  test("同一 event_id 但负载不同：冲突", () => {
    const log = new EventLog();
    log.append(ev("e-1", 1, "a"), 1_000);
    const r = log.append(ev("e-1", 1, "b"), 1_001);
    expect(r.kind).toBe("conflict");
  });

  test("序号缺口要求从 lastConfirmedSeq + 1 重放", () => {
    const log = new EventLog();
    log.append(ev("e-1", 1), 1_000);
    expect(log.append(ev("e-3", 3), 1_002)).toEqual({ kind: "seqGap", expectedSeq: 2 });
    expect(log.all()).toHaveLength(1);
  });

  test("可以从已落盘记录恢复", () => {
    const log = new EventLog();
    log.append(ev("e-1", 1), 1_000);
    const restored = new EventLog(log.all());
    expect(restored.lastConfirmedSeq).toBe(1);
    expect(restored.append(ev("e-1", 1), 5).kind).toBe("duplicate");
  });
});
