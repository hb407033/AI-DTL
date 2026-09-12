// apps/agent-host/test/session-gateway.test.ts
import { describe, expect, test } from "vitest";
import { InMemorySessionStore, ScriptedReplayBridge } from "@ai-scholar/learning-kernel";
import { mathPlugin } from "@ai-scholar/plugin-math";
import type { ServerFrame } from "@ai-scholar/session-contracts";
import { createSessionHost } from "../src/session-gateway.js";

const frame = (id: string, clientSeq: number, payload: unknown) => JSON.stringify({
  protocolVersion: 1, type: "event", id, clientSeq, sessionId: "s-1", sentAt: 1,
  event: { eventId: id, clientSessionId: "s-1", deviceId: "ipad", clientSeq, occurredAt: 1, quality: "confirmed", source: "child_button", semanticObjectIds: [], payload },
});

const scripted = () => new ScriptedReplayBridge({ scriptVersion: 1, turns: [] });

describe("会话网关", () => {
  test("首次打开会话返回初始出站消息；事件帧立即 ack，教学输出随后经订阅推送；非法 JSON 与未知类型返回 error", async () => {
    const host = createSessionHost({ plugin: mathPlugin, store: new InMemorySessionStore(), makeBridge: scripted, clock: () => 5 });
    const opened = await host.open("s-1");
    expect(opened.map((f) => f.type)).toEqual(["outbound", "outbound"]);
    const pushed: ServerFrame[] = [];
    host.subscribe("s-1", (frames) => pushed.push(...frames));

    const replies = await host.handleFrame("s-1", frame("f-1", 1, { type: "DONE" }), 10);
    expect(replies).toEqual([{ protocolVersion: 1, type: "ack", id: "f-1", clientSeq: 1, serverReceivedAt: 10 }]);
    await host.idle("s-1");
    expect(pushed.map((f) => f.type)).toEqual(["outbound", "outbound"]);   // stateChanged + 讲回任务

    expect((await host.handleFrame("s-1", "{bad", 11))[0]).toMatchObject({ type: "error", reason: "invalidJson" });
    expect((await host.handleFrame("s-1", JSON.stringify({ protocolVersion: 1, type: "nope" }), 12))[0]).toMatchObject({ type: "error", reason: "invalidFrame" });
  });

  test("序号缺口回 nack；重放同一帧回原 ack 并补发当时的出站消息", async () => {
    const host = createSessionHost({ plugin: mathPlugin, store: new InMemorySessionStore(), makeBridge: scripted, clock: () => 5 });
    await host.open("s-1");
    const pushed: ServerFrame[] = [];
    host.subscribe("s-1", (frames) => pushed.push(...frames));
    const first = await host.handleFrame("s-1", frame("f-1", 1, { type: "PAUSE_REQUEST", by: "child" }), 10);
    await host.idle("s-1");
    expect(await host.handleFrame("s-1", frame("f-3", 3, { type: "RESUME_REQUEST" }), 11)).toEqual([{ protocolVersion: 1, type: "nack", reason: "seqGap", expectedSeq: 2 }]);
    const replay = await host.handleFrame("s-1", frame("f-1", 1, { type: "PAUSE_REQUEST", by: "child" }), 99);
    expect(replay[0]).toEqual(first[0]);            // serverReceivedAt 仍是 10
    expect(replay.slice(1)).toEqual(pushed);         // 补发当时推送过的出站消息
  });

  test("家长桥接：求助后 pending 可见，家长提交后教学输出推送出来", async () => {
    const host = createSessionHost({ plugin: mathPlugin, store: new InMemorySessionStore(), makeBridge: (id) => host.parentBridge(id), clock: () => 5 });
    await host.open("s-1");
    const pushed: ServerFrame[] = [];
    host.subscribe("s-1", (frames) => pushed.push(...frames));
    expect((await host.handleFrame("s-1", frame("f-1", 1, { type: "HELP_REQUEST" }), 10))[0]?.type).toBe("ack");
    await new Promise((r) => setTimeout(r, 0));
    expect(host.parentView("s-1")).toMatchObject({ state: "INTERVENING", pending: { purpose: "hint", allowedMaxHintLevel: 1 } });
    host.submitParentProposal("s-1", { spokenResponse: "你现在已经确定了什么？", learnerTask: "说说", hintLevel: 1 });
    await host.idle("s-1");
    expect(pushed.some((f) => f.type === "outbound" && f.message.type === "speak")).toBe(true);
    expect(host.parentView("s-1")).toMatchObject({ state: "INTERVENING", hintLevel: 1, pending: null });
  });
});

describe("断线暂停与重启续接（设计稿 13）", () => {
  const script = () => new ScriptedReplayBridge({ scriptVersion: 1, turns: [
    { purpose: "hint", proposal: { proposalId: "p-1", spokenResponse: "你现在已经确定了什么？", learnerTask: "说说", canvasActions: [{ kind: "upsertObject", object: { id: "agent-bar", owner: "agent", kind: "tenthsBar", props: {} } }], expectedEvidence: [], hintLevel: 1 } },
  ] });

  test("儿童端 socket 断开 → PAUSED_TECH；重新打开 → 回原状态并收到当前画面", async () => {
    const host = createSessionHost({ plugin: mathPlugin, store: new InMemorySessionStore(), makeBridge: script, clock: () => 5 });
    await host.open("s-1");
    await host.handleFrame("s-1", frame("f-1", 1, { type: "HELP_REQUEST" }), 10);
    await host.idle("s-1");
    expect(host.parentView("s-1").state).toBe("INTERVENING");

    host.onSocketClosed("s-1");
    expect(host.parentView("s-1").state).toBe("PAUSED_TECH");

    const reopened = await host.open("s-1");
    expect(host.parentView("s-1").state).toBe("INTERVENING");
    const kinds = reopened.map((f) => (f.type === "outbound" ? f.message.type : f.type));
    expect(kinds).toEqual(["stateChanged", "stateChanged", "learnerTask", "canvasAction", "speak"]);   // 先恢复，再构造恢复后的画面快照
    expect(reopened.slice(0, 2)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.objectContaining({ state: "INTERVENING" }) })]));
  });

  test("宿主重启：新 host 用同一个 store 打开旧会话，得到当前画面；旧帧重放仍是原 ack", async () => {
    const store = new InMemorySessionStore();
    const first = createSessionHost({ plugin: mathPlugin, store, makeBridge: script, clock: () => 5 });
    await first.open("s-1");
    const ack = await first.handleFrame("s-1", frame("f-1", 1, { type: "HELP_REQUEST" }), 10);
    await first.idle("s-1");

    const second = createSessionHost({ plugin: mathPlugin, store, makeBridge: script, clock: () => 99 });
    const frames = await second.open("s-1");
    expect(second.parentView("s-1")).toMatchObject({ state: "INTERVENING", hintLevel: 1 });
    expect(frames.some((f) => f.type === "outbound" && f.message.type === "canvasAction")).toBe(true);
    const replay = await second.handleFrame("s-1", frame("f-1", 1, { type: "HELP_REQUEST" }), 200);
    expect(replay[0]).toEqual(ack[0]);
    const next = await second.handleFrame("s-1", frame("f-2", 2, { type: "ANSWER", text: "0.72" }), 201);
    expect(next[0]).toMatchObject({ type: "ack", clientSeq: 2 });
  });
});
