// packages/learning-kernel/test/bridges.test.ts
import { describe, expect, test } from "vitest";
import { ParentCoachBridge } from "../src/bridges/parent-coach-bridge.js";
import { ScriptedReplayBridge } from "../src/bridges/scripted-replay-bridge.js";
import type { TurnContext } from "../src/bridge.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

const challenge = fakePlugin.createChallenge({ curriculumAnchor: "fake/unit-1" });
const turn = (purpose: TurnContext["purpose"], allowedMaxHintLevel = 1): TurnContext => ({
  sessionId: "s-1", purpose, state: "INTERVENING", hintLevel: 0, allowedMaxHintLevel, challenge, recentEvidence: [], recentEvents: [], rejectionReasons: [],
});

describe("ScriptedReplayBridge", () => {
  test("按顺序返回脚本中的提案，purpose 不匹配时报错，脚本耗尽时报错", async () => {
    const bridge = new ScriptedReplayBridge({ scriptVersion: 1, turns: [
      { purpose: "hint", proposal: { proposalId: "p-1", spokenResponse: "一", learnerTask: "t", canvasActions: [], expectedEvidence: [], hintLevel: 1 } },
      { proposal: { proposalId: "p-2", spokenResponse: "二", learnerTask: "t", canvasActions: [], expectedEvidence: [], hintLevel: 2 } },
    ] });
    await bridge.start("s-1");
    expect((await bridge.requestProposal(turn("hint"))).proposalId).toBe("p-1");
    expect((await bridge.requestProposal(turn("explainBackPrompt"))).proposalId).toBe("p-2");
    await expect(bridge.requestProposal(turn("hint"))).rejects.toThrow(/脚本已耗尽/);
  });
  test("purpose 不匹配立即报错，不静默跳过", async () => {
    const bridge = new ScriptedReplayBridge({ scriptVersion: 1, turns: [{ purpose: "hint", proposal: { proposalId: "p-1", spokenResponse: "", learnerTask: "t", canvasActions: [], expectedEvidence: [], hintLevel: 1 } }] });
    await expect(bridge.requestProposal(turn("transferPrompt"))).rejects.toThrow(/purpose/);
  });
  test("kind 是 scripted，不冒充 codex", () => {
    expect(new ScriptedReplayBridge({ scriptVersion: 1, turns: [] }).kind).toBe("scripted");
  });
});

describe("ParentCoachBridge", () => {
  test("请求挂起直到家长提交；提交必须标注提示级别", async () => {
    const bridge = new ParentCoachBridge();
    const pending = bridge.requestProposal(turn("hint", 2));
    expect(bridge.pending()?.purpose).toBe("hint");
    expect(() => bridge.submit({ spokenResponse: "你确定了什么？", learnerTask: "说说", hintLevel: Number.NaN })).toThrow(/提示级别/);
    bridge.submit({ spokenResponse: "你确定了什么？", learnerTask: "说说", hintLevel: 1 });
    const proposal = await pending;
    expect(proposal).toMatchObject({ spokenResponse: "你确定了什么？", hintLevel: 1, canvasActions: [] });
    expect(proposal.proposalId).toMatch(/^parent-/);
    expect(bridge.pending()).toBeNull();
  });
  test("没有挂起请求时提交报错", () => {
    expect(() => new ParentCoachBridge().submit({ spokenResponse: "x", learnerTask: "y", hintLevel: 0 })).toThrow(/没有等待中的请求/);
  });
});
