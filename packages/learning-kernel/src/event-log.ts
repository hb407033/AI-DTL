// packages/learning-kernel/src/event-log.ts
// 幂等事件日志（设计稿 10.2）：event_id 唯一；重放返回原记录；负载不同即冲突；client_seq 必须连续，缺口要求从 lastConfirmedSeq + 1 重放。
// 内容哈希基于键排序后的规范化 JSON，与客户端序列化的键顺序无关。
import { createHash } from "node:crypto";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";

export interface StoredEvent {
  event: EvidenceEvent;
  serverSeq: number;
  receivedAt: number;
  contentHash: string;
}

export type AppendResult =
  | { kind: "appended"; stored: StoredEvent }
  | { kind: "duplicate"; stored: StoredEvent }
  | { kind: "conflict"; existingHash: string; incomingHash: string }
  | { kind: "seqGap"; expectedSeq: number };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHashOf(event: EvidenceEvent): string {
  const { eventId, clientSeq, occurredAt, quality, payload, semanticObjectIds } = event;
  return createHash("sha256").update(canonicalJson({ eventId, clientSeq, occurredAt, quality, payload, semanticObjectIds })).digest("hex");
}

export class EventLog {
  private readonly events: StoredEvent[] = [];
  private readonly byEventId = new Map<string, StoredEvent>();

  constructor(initial: StoredEvent[] = []) {
    for (const stored of [...initial].sort((a, b) => a.serverSeq - b.serverSeq)) {
      this.events.push(stored);
      this.byEventId.set(stored.event.eventId, stored);
    }
  }

  get lastConfirmedSeq(): number {
    const last = this.events[this.events.length - 1];
    return last ? last.event.clientSeq : 0;
  }

  append(event: EvidenceEvent, receivedAt: number): AppendResult {
    const incomingHash = contentHashOf(event);
    const existing = this.byEventId.get(event.eventId);
    if (existing) {
      return existing.contentHash === incomingHash
        ? { kind: "duplicate", stored: existing }
        : { kind: "conflict", existingHash: existing.contentHash, incomingHash };
    }
    const expectedSeq = this.lastConfirmedSeq + 1;
    if (event.clientSeq !== expectedSeq) return { kind: "seqGap", expectedSeq };
    const stored: StoredEvent = { event, serverSeq: this.events.length + 1, receivedAt, contentHash: incomingHash };
    this.events.push(stored);
    this.byEventId.set(event.eventId, stored);
    return { kind: "appended", stored };
  }

  all(): StoredEvent[] { return [...this.events]; }
  byId(eventId: string): StoredEvent | undefined { return this.byEventId.get(eventId); }
}
