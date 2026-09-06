import { describe, expect, test } from "vitest";
import { createProbeSession, handleClientMessage } from "../src/probe-protocol.js";

// 处理器是纯函数：输入会话状态与一条消息，输出回复列表与新状态；不碰 socket，便于确定性测试
function ping(id: string, clientSeq: number) {
  return { protocolVersion: 1 as const, type: "ping" as const, id, clientSeq, sessionId: "sess-a", sentAt: 1_757_100_000_000 + clientSeq };
}

describe("网关探针协议处理", () => {
  test("正常序号的 ping 得到带 serverReceivedAt 的 ack", () => {
    const s0 = createProbeSession();
    const { replies, session } = handleClientMessage(s0, ping("c-1", 1), 1_000);
    expect(replies).toEqual([{ protocolVersion: 1, type: "ack", id: "c-1", clientSeq: 1, serverReceivedAt: 1_000 }]);
    expect(session.lastConfirmedSeq).toBe(1);
  });

  test("同一 id 重放只返回原来的 ack，不重复推进序号", () => {
    let state = createProbeSession();
    const first = handleClientMessage(state, ping("c-1", 1), 1_000);
    state = first.session;
    const replay = handleClientMessage(state, ping("c-1", 1), 5_000);
    expect(replay.replies).toEqual(first.replies);   // serverReceivedAt 仍是 1000
    expect(replay.session.lastConfirmedSeq).toBe(1);
  });

  test("序号出现缺口时返回 nack 并指出期望序号", () => {
    let state = createProbeSession();
    state = handleClientMessage(state, ping("c-1", 1), 1_000).session;
    const gap = handleClientMessage(state, ping("c-3", 3), 2_000);
    expect(gap.replies).toEqual([{ protocolVersion: 1, type: "nack", reason: "seqGap", expectedSeq: 2 }]);
    expect(gap.session.lastConfirmedSeq).toBe(1);
  });

  test("requestSemanticAction 得到 ack 加一条 upsertCircle 动作", () => {
    const s0 = createProbeSession();
    const req = { protocolVersion: 1 as const, type: "requestSemanticAction" as const, id: "c-1", clientSeq: 1, sessionId: "sess-a", sentAt: 1 };
    const { replies } = handleClientMessage(s0, req, 1_000);
    expect(replies[0]).toMatchObject({ type: "ack", id: "c-1" });
    expect(replies[1]).toMatchObject({ type: "semanticAction", inReplyTo: "c-1", action: { kind: "upsertCircle" } });
    const circle = (replies[1] as { action: { circle: { id: string; owner: string } } }).action.circle;
    expect(circle.owner).toBe("agent");
    expect(circle.id).toBeTruthy();
  });

  test("已确认 id 的集合有上限，不会无限增长", () => {
    let state = createProbeSession({ maxRememberedIds: 3 });
    for (let i = 1; i <= 5; i++) state = handleClientMessage(state, ping(`c-${i}`, i), i).session;
    expect(state.rememberedIds.size).toBeLessThanOrEqual(3);
  });
});
