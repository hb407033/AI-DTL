import { describe, expect, test } from "vitest";
import type { ChildOutbound, EvidenceEvent, TeachingProposal } from "@ai-scholar/session-contracts";
import { ScriptedReplayBridge, type ReplayScript } from "../src/bridges/scripted-replay-bridge.js";
import { SessionOrchestrator, type OrchestratorDeps } from "../src/orchestrator.js";
import { InMemorySessionStore } from "../src/store.js";
import { resolveConfirmedEvents } from "../src/transcript-confirmation.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

// 会话状态 = 可重放事件 + 明确快照（设计稿 13「服务重启」）：重启后从最新快照重建，快照之后的事件只灌回日志与证据
const P = (id: string, hintLevel: number, patch: Partial<TeachingProposal> = {}): TeachingProposal => ({
  proposalId: id, spokenResponse: `提示${hintLevel}`, learnerTask: "试试看", canvasActions: [], expectedEvidence: [], hintLevel, ...patch,
});
const hintWithObject = P("p-1", 1, { canvasActions: [{ kind: "upsertObject", object: { id: "agent-frame", owner: "agent", kind: "label", props: { text: "空表示" } } }] });

function harness(turns: ReplayScript["turns"], store = new InMemorySessionStore(), now = { t: 0 }) {
  const deps: OrchestratorDeps = { sessionId: "s-1", plugin: fakePlugin, bridge: new ScriptedReplayBridge({ scriptVersion: 1, turns }), store, clock: () => now.t, challengeInput: { curriculumAnchor: "fake/unit-1" } };
  const orch = new SessionOrchestrator(deps);
  const seq = { n: 0 };
  const ev = (payload: EvidenceEvent["payload"], n = ++seq.n): EvidenceEvent => ({ eventId: `e-${n}`, clientSessionId: "s-1", deviceId: "d", clientSeq: n, occurredAt: now.t, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload });
  return { orch, deps, store, now, seq, ev, send: (payload: EvidenceEvent["payload"]) => orch.handleEvent(ev(payload)) };
}

const types = (msgs: ChildOutbound[]) => msgs.map((m) => m.type);

describe("宿主重启后从快照重建", () => {
  test("重建后的上下文、证据、Agent 层与最近一句都与原实例一致；旧事件重放为 duplicate；新事件序号接续", async () => {
    const h = harness([{ purpose: "hint", proposal: hintWithObject }]);
    await h.orch.start();
    await h.send({ type: "ANSWER", text: "41" });
    await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 1 });

    const restored = SessionOrchestrator.restore({ ...h.deps, bridge: new ScriptedReplayBridge({ scriptVersion: 1, turns: [] }) });
    expect(restored).not.toBeNull();
    expect(restored!.context).toEqual(h.orch.context);
    expect(restored!.challenge).toEqual(h.orch.challenge);
    expect(restored!.evidence).toEqual(h.orch.evidence);
    expect(restored!.viewSnapshot()).toEqual(h.orch.viewSnapshot());
    expect(types(restored!.viewSnapshot())).toEqual(["stateChanged", "learnerTask", "canvasAction", "speak"]);

    const replay = await restored!.handleEvent(h.ev({ type: "HELP_REQUEST" }, 2));
    expect(replay.append.kind).toBe("duplicate");
    const next = await restored!.handleEvent(h.ev({ type: "ANSWER", text: "42" }, 3));
    expect(next.append.kind).toBe("appended");
    expect(restored!.context.state).toBe("INDEPENDENT");   // 新产出撤回提示
    expect(next.outbound.find((m) => m.type === "canvasAction")).toMatchObject({ action: { kind: "removeObject", objectId: "agent-frame" } });
  });

  test("快照之后又来了不改状态的事件：重建时只灌回日志与证据，不碰桥接", async () => {
    const h = harness([]);
    await h.orch.start();                                   // 状态变化 → 快照 1
    await h.send({ type: "ANSWER", text: "40" });           // 不改状态，不快照
    await h.send({ type: "ANSWER", text: "39" });
    const restored = SessionOrchestrator.restore(h.deps)!;
    expect(restored.evidence.map((e) => e.summary)).toEqual(["40", "39"]);
    expect(restored.context.state).toBe("INDEPENDENT");
    const next = await restored.handleEvent(h.ev({ type: "HELP_REQUEST" }, 3));
    expect(next.append.kind).toBe("appended");
  });

  test("库里没有这个会话时返回 null", () => {
    const h = harness([]);
    expect(SessionOrchestrator.restore(h.deps)).toBeNull();
  });
});

describe("技术中断（设计稿 5.0 PAUSED_TECH）", () => {
  test("中断后停计时、不做能力判断；恢复回原状态且窗口从恢复时刻重新计", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    h.now.t = 5_000;
    await h.send({ type: "STROKE", strokeId: "s", contentHash: "h", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    const paused = h.orch.techInterrupted();
    expect(h.orch.context).toMatchObject({ state: "PAUSED_TECH", priorState: "INDEPENDENT" });
    expect(paused.find((m) => m.type === "stateChanged")).toMatchObject({ presence: "paused" });

    h.now.t = 600_000;
    expect(await h.orch.tick(600_000)).toEqual([]);       // 断线十分钟不算“没新策略”
    const resumed = h.orch.techRecovered();
    expect(h.orch.context).toMatchObject({ state: "INDEPENDENT", priorState: null });
    expect(types(resumed)).toEqual(["stateChanged"]);
    h.now.t = 629_000;
    expect(await h.orch.tick(629_000)).toEqual([]);       // 恢复后 29 s 内不评估
    h.now.t = 630_500;
    await h.orch.tick(630_500);
    expect(h.orch.context.state).toBe("INTERVENING");
  });

  test("已完成或非活动状态下的中断被拒绝且不改状态", async () => {
    const h = harness([]);
    await h.orch.start();
    await h.send({ type: "PAUSE_REQUEST", by: "child" });
    expect(h.orch.techInterrupted()).toEqual([]);
    expect(h.orch.context.state).toBe("PAUSED_CHILD");
  });
});

describe("当前画面快照", () => {
  test("讲回阶段的任务是讲回问句；迁移阶段的任务是迁移题", async () => {
    const h = harness([]);
    await h.orch.start();
    await h.send({ type: "STROKE", strokeId: "s", contentHash: "h", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    await h.send({ type: "ANSWER", text: "42" });
    expect(h.orch.viewSnapshot().find((m) => m.type === "learnerTask")).toMatchObject({ text: "说说为什么这样做成立。" });
    await h.send({ type: "EXPLAIN", text: "因为" });
    expect(h.orch.viewSnapshot().find((m) => m.type === "learnerTask")).toMatchObject({ text: "换一个情境：请回答 43 减 1。" });
  });
});

describe("旧快照兼容", () => {
  test("快照没有 runtime 时，当前画面仍按状态给出任务文字", async () => {
    const h = harness([]);
    await h.orch.start();
    const snapshot = h.store.latestSnapshot("s-1")!;
    h.store.saveSnapshot("s-1", { ...snapshot, snapshotSeq: snapshot.snapshotSeq + 1, runtime: undefined });
    const restored = SessionOrchestrator.restore(h.deps)!;
    expect(restored.viewSnapshot().find((m) => m.type === "learnerTask")).toMatchObject({ text: h.orch.challenge.learnerPrompt });
  });
});

describe("重启后的出站消息编号与转写确认", () => {
  test("出站消息编号接着原来往下走，不与重启前的编号撞号", async () => {
    const h = harness([]);
    const started = await h.orch.start();
    const lastId = started[started.length - 1]!.id;
    const restored = SessionOrchestrator.restore(h.deps)!;
    const next = await restored.handleEvent(h.ev({ type: "PAUSE_REQUEST", by: "child" }, 1));
    expect(next.outbound[0]!.id).not.toBe(lastId);
    expect(Number(next.outbound[0]!.id.replace("o-", ""))).toBeGreaterThan(Number(lastId.replace("o-", "")));
  });

  test("孩子确认过的转写在事件日志里也算数，后来的读者不会当它没确认", async () => {
    // 确认结果是一条独立事件，原事件不可变；任何后来的读者（成长账本）都要靠推导拿到有效质量
    const h = harness([]);
    await h.orch.start();
    const unconfirmed = { ...h.ev({ type: "UTTERANCE", text: "四十一" }, 1), quality: "unconfirmed" as const };
    await h.orch.handleEvent(unconfirmed);
    await h.orch.handleEvent(h.ev({ type: "CONFIRM_TRANSCRIPT", targetEventId: unconfirmed.eventId, confirmed: true, correctedText: "42" }, 2));
    const stored = h.store.listEvents("s-1").map((e) => e.event);
    expect(stored[0]?.quality).toBe("unconfirmed");   // 原事件保持不变
    const resolved = resolveConfirmedEvents(stored);
    expect(resolved[0]).toMatchObject({ quality: "corrected", payload: { type: "UTTERANCE", text: "42" } });
  });
});
