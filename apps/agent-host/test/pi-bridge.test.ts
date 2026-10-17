import { expect, test } from "vitest";
import { PiTeachingBridge } from "../src/ai/pi-bridge.js";
import { fakePlugin } from "../../../packages/learning-kernel/test/helpers/fake-plugin.js";
import type { TurnContext } from "@ai-scholar/learning-kernel";

const turn: TurnContext = { sessionId: "s", purpose: "hint", state: "INTERVENING", hintLevel: 0, allowedMaxHintLevel: 1,
  challenge: fakePlugin.createChallenge({ curriculumAnchor: "fake/unit-1" }), recentEvidence: [], recentEvents: [], rejectionReasons: [] };
const proposal = { proposalId: "generated", spokenResponse: "你确定了什么？", learnerTask: "说说想法", hintLevel: 1, canvasActions: [], expectedEvidence: [] };

test("Pi 收到教学上下文并返回结构化提案，ID 由宿主生成", async () => {
  const bridge = new PiTeachingBridge(async prompt => {
    expect(prompt).toContain('"allowedMaxHintLevel":1');
    return JSON.stringify(proposal);
  });
  expect(bridge.kind).toBe("pi");
  expect(await bridge.requestProposal(turn)).toMatchObject({ ...proposal, proposalId: expect.stringMatching(/^pi-/) });
});
test("不从散文猜测 JSON；不接受超预算提示", async () => {
  await expect(new PiTeachingBridge(async () => "答案是0.72").requestProposal(turn)).rejects.toThrow("piInvalidProposal");
  await expect(new PiTeachingBridge(async () => JSON.stringify({ ...proposal, hintLevel: 4 })).requestProposal(turn)).rejects.toThrow("piHintBudgetExceeded");
});
test("停止取消信号且拒绝迟到结果；并发请求不混入另一轮", async () => {
  let finish!: (s: string) => void;
  let signal!: AbortSignal;
  const bridge = new PiTeachingBridge(async (_prompt, s) => { signal = s; return new Promise(resolve => { finish = resolve; }); });
  const pending = bridge.requestProposal(turn);
  await expect(bridge.requestProposal(turn)).rejects.toThrow("piBusy");
  await bridge.stop();
  expect(signal.aborted).toBe(true);
  finish(JSON.stringify(proposal));
  await expect(pending).rejects.toThrow("piStopped");
});
