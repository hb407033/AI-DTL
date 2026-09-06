// packages/learning-kernel/test/orchestrator.test.ts
import { describe, expect, test } from "vitest";
import type { ChildOutbound, EvidenceEvent, TeachingProposal } from "@ai-scholar/session-contracts";
import { ScriptedReplayBridge, type ReplayScript } from "../src/bridges/scripted-replay-bridge.js";
import { SessionOrchestrator } from "../src/orchestrator.js";
import { InMemorySessionStore } from "../src/store.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

// 用假插件：答案 42 正确，讲回含“因为”通过；提示阶梯来自挑战本身
const P = (id: string, hintLevel: number, patch: Partial<TeachingProposal> = {}): TeachingProposal => ({
  proposalId: id, spokenResponse: `提示${hintLevel}`, learnerTask: "试试看", canvasActions: [], expectedEvidence: [], hintLevel, ...patch,
});

function harness(turns: ReplayScript["turns"], now = { t: 0 }) {
  const bridge = new ScriptedReplayBridge({ scriptVersion: 1, turns });
  const store = new InMemorySessionStore();
  const orch = new SessionOrchestrator({ sessionId: "s-1", plugin: fakePlugin, bridge, store, clock: () => now.t, challengeInput: { curriculumAnchor: "fake/unit-1" } });
  let seq = 0;
  const send = (payload: EvidenceEvent["payload"], quality: EvidenceEvent["quality"] = "confirmed") => {
    seq += 1;
    return orch.handleEvent({ eventId: `e-${seq}`, clientSessionId: "s-1", deviceId: "d", clientSeq: seq, occurredAt: now.t, quality, source: "child_voice", semanticObjectIds: [], payload });
  };
  return { orch, bridge, store, send, now };
}

const types = (msgs: ChildOutbound[]) => msgs.map((m) => m.type);

describe("主路径：独立完成 → 讲回 → 迁移 → 完成", () => {
  test("孩子独立给出表示与答案，不经过评估直接讲回，迁移成功后 COMPLETED", async () => {
    const h = harness([]);
    const started = await h.orch.start();
    expect(h.orch.context.state).toBe("INDEPENDENT");
    expect(types(started)).toEqual(["stateChanged", "learnerTask"]);

    await h.send({ type: "STROKE", strokeId: "st-1", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    const done = await h.send({ type: "ANSWER", text: "42" });
    expect(h.orch.context.state).toBe("EXPLAIN_BACK");
    expect(done.outbound.find((m) => m.type === "learnerTask")).toMatchObject({ text: "说说为什么这样做成立。" });

    await h.send({ type: "EXPLAIN", text: "因为两边一样多" });
    expect(h.orch.context.state).toBe("TRANSFER");
    expect(h.orch.context.hintLevel).toBe(0);

    await h.send({ type: "ANSWER", text: "42" });
    expect(h.orch.context.state).toBe("COMPLETED");
    expect(h.orch.context.independentSuccess).toBe(true);
    expect(h.bridge.requests).toHaveLength(0);   // 全程没有请求过桥接
    expect(h.store.latestSnapshot("s-1")?.context.state).toBe("COMPLETED");
  });
});

describe("15.3 场景：答错但仍在有效探索", () => {
  test("错误本身不触发提示，孩子继续产出就一直 INDEPENDENT", async () => {
    const h = harness([]);
    await h.orch.start();
    await h.send({ type: "ANSWER", text: "41" });
    await h.send({ type: "STROKE", strokeId: "st-1", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    expect(h.orch.context.state).toBe("INDEPENDENT");
    expect(h.orch.evidence.map((e) => e.kind)).toEqual(["wrong_answer", "representation"]);
  });
});

describe("15.3 场景：沉默但正在画 / 窗口到期", () => {
  test("持续新笔迹延长窗口；擦掉后重画相同内容不算新策略；无新策略 30 秒后进入评估并给 1 级提示", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    h.now.t = 20_000;
    await h.send({ type: "STROKE", strokeId: "st-1", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    h.now.t = 45_000;
    expect(await h.orch.tick(45_000)).toEqual([]);           // 20s 时有新策略，窗口顺延到 50s
    await h.send({ type: "ERASE", strokeId: "st-1", contentHash: "h1" });
    await h.send({ type: "STROKE", strokeId: "st-2", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    h.now.t = 50_500;
    const out = await h.orch.tick(50_500);                    // 重画相同内容不延长
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 1, escalationCount: 1 });
    expect(types(out)).toEqual(["stateChanged", "stateChanged", "speak", "learnerTask"]);
    expect(h.bridge.requests[0]).toMatchObject({ purpose: "hint", allowedMaxHintLevel: 1 });
  });

  test("硬上限 240 秒即使一直有新笔迹也进入评估", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    for (let i = 1; i <= 9; i += 1) {
      h.now.t = i * 25_000;
      await h.send({ type: "STROKE", strokeId: `st-${i}`, contentHash: `h${i}`, bounds: { x: 0, y: 0, width: 1, height: 1 } });
    }
    await h.orch.tick(240_000);
    expect(h.orch.context.state).toBe("INTERVENING");
  });
});

describe("15.3 场景：主动求助与提示阶梯", () => {
  test("求助 → 1 级；新产出后撤回提示回到 0 级；再求助 → 2 级；第三次求助被软预算挡住直到有实质性尝试", async () => {
    const h = harness([
      { purpose: "hint", proposal: P("p-1", 1) },
      { purpose: "hint", proposal: P("p-2", 2, { canvasActions: [{ kind: "upsertObject", object: { id: "agent-frame", owner: "agent", kind: "label", props: {} } }] }) },
      { purpose: "hint", proposal: P("p-3", 3) },
    ]);
    await h.orch.start();
    await h.send({ type: "STROKE", strokeId: "st-0", contentHash: "h0", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 1 });

    const back = await h.send({ type: "STROKE", strokeId: "st-1", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    expect(h.orch.context).toMatchObject({ state: "INDEPENDENT", hintLevel: 0, maxHintLevelUsed: 1 });
    expect(types(back.outbound)).toEqual(["stateChanged"]);

    const second = await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 2, escalationCount: 2 });
    expect(second.outbound.filter((m) => m.type === "canvasAction")).toHaveLength(1);

    // 撤回 2 级提示时要把 Agent 放上去的对象删掉
    const withdraw = await h.send({ type: "ANSWER", text: "40" });
    expect(withdraw.outbound.find((m) => m.type === "canvasAction")).toMatchObject({ action: { kind: "removeObject", objectId: "agent-frame" } });

    // 第三次求助：软预算已用完，但有实质性尝试且再次求助 → 允许并标记非独立成功
    await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 3, independentSuccess: false });
  });

  test("上次提示后没有新产出时再求助：停在 ASSESSING 等待，不连续升级", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    await h.send({ type: "HELP_REQUEST" });
    await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "ASSESSING", hintLevel: 1 });
    expect(h.bridge.requests).toHaveLength(1);
  });

  test("4 级演示后进入 RECONSTRUCT，示范对象被立即撤下，重建后讲回", async () => {
    const h = harness([
      { purpose: "hint", proposal: P("p-1", 1) }, { purpose: "hint", proposal: P("p-2", 2) }, { purpose: "hint", proposal: P("p-3", 3) },
      { purpose: "hint", proposal: P("p-4", 4, { canvasActions: [{ kind: "upsertObject", object: { id: "agent-demo", owner: "agent", kind: "label", props: {} } }] }) },
    ]);
    await h.orch.start();
    for (let i = 1; i <= 4; i += 1) {
      await h.send({ type: "ANSWER", text: `${i}` });
      await h.send({ type: "HELP_REQUEST" });
    }
    expect(h.orch.context).toMatchObject({ state: "RECONSTRUCT", hintLevel: 4, maxHintLevelUsed: 4 });
    const last = h.store.getOutbound("s-1", "e-8") ?? [];
    expect(last.filter((m) => m.type === "canvasAction").map((m) => (m as { action: { kind: string } }).action.kind)).toEqual(["upsertObject", "removeObject"]);
    await h.send({ type: "ANSWER", text: "42" });
    expect(h.orch.context.state).toBe("EXPLAIN_BACK");
  });
});

describe("15.3 场景：语音转写错误", () => {
  test("unconfirmed 转写先请求确认，不参与证据；确认并修正后按修正文本解释", async () => {
    const h = harness([]);
    await h.orch.start();
    const r = await h.send({ type: "UTTERANCE", text: "四十一" }, "unconfirmed");
    expect(h.orch.context.state).toBe("WAITING_CONFIRMATION");
    expect(r.outbound.find((m) => m.type === "confirmTranscript")).toMatchObject({ targetEventId: "e-1", text: "四十一" });
    expect(h.orch.evidence).toEqual([]);
    await h.send({ type: "CONFIRM_TRANSCRIPT", targetEventId: "e-1", confirmed: true, correctedText: "42" });
    expect(h.orch.context.state).toBe("INDEPENDENT");
    expect(h.orch.evidence.map((e) => e.kind)).toEqual(["utterance"]);
  });
  test("60 秒无回应：回原状态，转写永久 unconfirmed", async () => {
    const h = harness([]);
    await h.orch.start();
    await h.send({ type: "UTTERANCE", text: "嗯" }, "unconfirmed");
    await h.orch.tick(61_000);
    expect(h.orch.context.state).toBe("INDEPENDENT");
    expect(h.orch.evidence).toEqual([]);
  });
});

describe("15.3 场景：模型越级与非法画布对象", () => {
  test("越级提案被拒并带原因重试；重试合规则采用", async () => {
    const h = harness([{ purpose: "hint", proposal: P("bad", 3) }, { purpose: "hint", proposal: P("good", 1) }]);
    await h.orch.start();
    await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 1 });
    expect(h.bridge.requests[1]?.rejectionReasons).toEqual(["hint:notOneLevelUp"]);
    expect(h.store.listProposals("s-1").map((p) => [p.proposalId, p.accepted])).toEqual([["bad", false], ["good", true]]);
  });
  test("两次都不合规：发等待提示，教学状态不变，级别仍为 0", async () => {
    const illegal = P("x", 1, { canvasActions: [{ kind: "upsertObject", object: { id: "z", owner: "agent", kind: "notAKind", props: {} } }] });
    const h = harness([{ purpose: "hint", proposal: illegal }, { purpose: "hint", proposal: { ...illegal, proposalId: "y" } }]);
    await h.orch.start();
    const r = await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 0, escalationCount: 0 });
    expect(r.outbound.find((m) => m.type === "notice")).toMatchObject({ text: "等我一下。" });
  });
});

describe("15.3 场景：孩子反驳 Agent", () => {
  test("异议冻结最近提案，停止追问并问“哪里和你的想法不一样？”，状态不变、不计提示", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    await h.send({ type: "HELP_REQUEST" });
    const r = await h.send({ type: "CONTEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 1, frozenTargetIds: ["p-1"] });
    expect(r.outbound.find((m) => m.type === "speak")).toMatchObject({ text: "哪里和你的想法不一样？", hintLevel: 0 });
  });
});

describe("15.3 场景：迁移失败与软着陆", () => {
  test("迁移失败 → 软着陆三选项；选“换简单的”进入辅助轮，新挑战难度带 lower，提示归零", async () => {
    const h = harness([]);
    await h.orch.start();
    await h.send({ type: "STROKE", strokeId: "s", contentHash: "h", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    await h.send({ type: "ANSWER", text: "42" });
    await h.send({ type: "EXPLAIN", text: "因为" });
    const failed = await h.send({ type: "ANSWER", text: "41" });
    expect(h.orch.context).toMatchObject({ state: "SOFT_LANDING", assistedRound: true });
    expect(failed.outbound.find((m) => m.type === "softLanding")).toMatchObject({ options: ["simpler", "hint", "stop"] });

    await h.send({ type: "SOFT_LANDING_CHOICE", choice: "simpler" });
    expect(h.orch.context).toMatchObject({ state: "INDEPENDENT", assistedRound: true, hintLevel: 0 });
    expect(h.orch.challenge.difficultyBand).toBe("lower");
  });
  test("辅助轮里迁移成功也只是 COMPLETED，且提案里的记忆候选会被拒", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1, { memoryCandidate: { description: "会了", evidenceEventIds: [] } }) }, { purpose: "hint", proposal: P("p-2", 1) }]);
    await h.orch.start();
    await h.send({ type: "ANSWER", text: "1" });
    await h.send({ type: "EXPLAIN", text: "因为" });     // INDEPENDENT 下 EXPLAIN 只是产出
    await h.send({ type: "DONE" });
    await h.send({ type: "EXPLAIN", text: "因为" });
    await h.send({ type: "ANSWER", text: "0" });          // 迁移失败
    await h.send({ type: "SOFT_LANDING_CHOICE", choice: "hint" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", assistedRound: true, hintLevel: 1 });
    expect(h.store.listProposals("s-1")[0]).toMatchObject({ proposalId: "p-1", accepted: false, reasons: ["memory:assistedRound"] });
  });
});

describe("暂停与恢复", () => {
  test("任何活动状态可暂停；继续后回原状态且不继承提示", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    await h.send({ type: "HELP_REQUEST" });
    const paused = await h.send({ type: "PAUSE_REQUEST", by: "child" });
    expect(h.orch.context).toMatchObject({ state: "PAUSED_CHILD", priorState: "INTERVENING" });
    expect(paused.outbound.find((m) => m.type === "stateChanged")).toMatchObject({ presence: "paused" });
    await h.send({ type: "RESUME_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 0 });
  });
});

describe("桥接不可用", () => {
  test("桥接抛错时不伪装正常：告诉孩子暂时没法提示，画布照常，教学状态不变", async () => {
    const h = harness([]);   // 空脚本 → 第一次请求即“脚本已耗尽”
    await h.orch.start();
    const r = await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 0 });
    expect(r.outbound.find((m) => m.type === "notice")).toMatchObject({ text: "现在没法给你提示，你可以先接着画。" });
  });
});

describe("幂等与序号", () => {
  test("重放同一事件返回同样的出站消息，不重复推进；序号缺口不进入教学逻辑", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    const first = await h.send({ type: "HELP_REQUEST" });
    const replay = await h.orch.handleEvent({ eventId: "e-1", clientSessionId: "s-1", deviceId: "d", clientSeq: 1, occurredAt: 0, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload: { type: "HELP_REQUEST" } });
    expect(replay.append.kind).toBe("duplicate");
    expect(replay.outbound).toEqual(first.outbound);
    const gap = await h.orch.handleEvent({ eventId: "e-9", clientSessionId: "s-1", deviceId: "d", clientSeq: 9, occurredAt: 0, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload: { type: "DONE" } });
    expect(gap.append).toEqual({ kind: "seqGap", expectedSeq: 2 });
    expect(h.orch.context.state).toBe("INTERVENING");
  });
});
