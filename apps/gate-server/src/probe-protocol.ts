// 网关探针协议的纯逻辑：给定会话状态和一条客户端消息，算出回复与新状态。不碰 socket，便于确定性测试。
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "@ai-scholar/gate-contracts";

export interface ProbeSession {
  /** 最后一条被确认的 clientSeq；下一条必须恰好是它 + 1，否则要求重放 */
  lastConfirmedSeq: number;
  /** 已确认的 id → 当时的回复。同一 id 重放只返回原回复，不重复推进序号（幂等） */
  rememberedIds: Map<string, ServerMessage[]>;
  maxRememberedIds: number;
  issuedActions: number;
}

export function createProbeSession(options: { maxRememberedIds?: number } = {}): ProbeSession {
  return { lastConfirmedSeq: 0, rememberedIds: new Map(), maxRememberedIds: options.maxRememberedIds ?? 1000, issuedActions: 0 };
}

export function handleClientMessage(
  session: ProbeSession,
  message: ClientMessage,
  nowMs: number,
): { replies: ServerMessage[]; session: ProbeSession } {
  const remembered = session.rememberedIds.get(message.id);
  if (remembered) return { replies: remembered, session };

  const expectedSeq = session.lastConfirmedSeq + 1;
  if (message.clientSeq !== expectedSeq) {
    return { replies: [{ protocolVersion: PROTOCOL_VERSION, type: "nack", reason: "seqGap", expectedSeq }], session };
  }

  const replies: ServerMessage[] = [
    { protocolVersion: PROTOCOL_VERSION, type: "ack", id: message.id, clientSeq: message.clientSeq, serverReceivedAt: nowMs },
  ];
  if (message.type === "requestSemanticAction") {
    session.issuedActions += 1;
    const n = session.issuedActions;
    replies.push({
      protocolVersion: PROTOCOL_VERSION,
      type: "semanticAction",
      id: `s-${n}`,
      inReplyTo: message.id,
      // 圆的位置按序号铺开，肉眼能看出是第几个；阶段 0 不要求有教学含义
      action: { kind: "upsertCircle", circle: { id: `circle-${n}`, owner: "agent", center: { x: 160 + (n % 8) * 90, y: 200 + Math.floor(n / 8) * 90 }, radius: 40 } },
    });
  }

  session.lastConfirmedSeq = message.clientSeq;
  session.rememberedIds.set(message.id, replies);
  while (session.rememberedIds.size > session.maxRememberedIds) {
    const oldest = session.rememberedIds.keys().next().value;
    if (oldest === undefined) break;
    session.rememberedIds.delete(oldest);   // Map 保持插入顺序，先删最早的
  }
  return { replies, session };
}
