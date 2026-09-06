// packages/plugin-math/test/plugin-math.test.ts
import { describe, expect, test } from "vitest";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { runPluginContract } from "@ai-scholar/learning-kernel";
import { MATH_HYPOTHESES, mathPlugin, parseNumbers } from "../src/index.js";

const challenge = mathPlugin.createChallenge({ curriculumAnchor: "人教版五上/小数乘法" });
let seq = 0;
function say(type: "UTTERANCE" | "ANSWER" | "EXPLAIN", text: string): EvidenceEvent {
  seq += 1;
  return { eventId: `e-${seq}`, clientSessionId: "s", deviceId: "d", clientSeq: seq, occurredAt: seq, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload: { type, text } };
}

describe("数学插件契约", () => {
  test("通过内核共用契约检查", () => {
    expect(runPluginContract(mathPlugin).filter((c) => !c.pass)).toEqual([]);
  });
  test("挑战是 2.4 × 0.3，迁移是 3.5 × 0.4，低难度带是 2 × 0.3", () => {
    expect(challenge.learnerPrompt).toContain("2.4 × 0.3");
    expect(mathPlugin.createTransfer(challenge).learnerPrompt).toContain("3.5 × 0.4");
    expect(mathPlugin.createChallenge({ curriculumAnchor: "x", difficultyBand: "lower" }).learnerPrompt).toContain("2 × 0.3");
  });
});

describe("证据解释（设计稿 6.2 区分性探针）", () => {
  test("说“比 2.4 小”削弱直觉断点；说“比 2.4 大”支持直觉断点", () => {
    const small = mathPlugin.interpretEvent(challenge, say("UTTERANCE", "我觉得会比 2.4 小"), []);
    expect(small[0]).toMatchObject({ kind: "magnitude_estimate", hypothesisSupport: [{ hypothesisId: "intuition_gap", direction: "weakens" }] });
    const big = mathPlugin.interpretEvent(challenge, say("UTTERANCE", "应该比 2.4 大吧"), []);
    expect(big[0]?.hypothesisSupport).toEqual([{ hypothesisId: "intuition_gap", direction: "supports" }]);
  });
  test("直觉正确却算出 7.2：支持严谨链条断点而不是直觉断点", () => {
    const history = mathPlugin.interpretEvent(challenge, say("UTTERANCE", "会比 2.4 小"), []);
    const wrong = mathPlugin.interpretEvent(challenge, say("ANSWER", "7.2"), history);
    expect(wrong[0]).toMatchObject({ kind: "wrong_answer", hypothesisSupport: [{ hypothesisId: "rigor_chain_gap", direction: "supports" }] });
  });
  test("没有大小判断就算出 7.2：同时支持直觉与严谨链条两个候选", () => {
    const wrong = mathPlugin.interpretEvent(challenge, say("ANSWER", "7.2"), []);
    expect(wrong[0]?.hypothesisSupport.map((s) => s.hypothesisId).sort()).toEqual(["intuition_gap", "rigor_chain_gap"]);
  });
  test("0.72 是正确答案；“十分之三”是意义证据", () => {
    expect(mathPlugin.interpretEvent(challenge, say("ANSWER", "0.72"), [])[0]?.kind).toBe("exact_answer");
    expect(mathPlugin.interpretEvent(challenge, say("UTTERANCE", "0.3 就是十分之三"), [])[0]?.kind).toBe("tenths_meaning");
  });
  test("期望证据齐全才算独立形成方案", () => {
    const evidence = [
      ...mathPlugin.interpretEvent(challenge, say("UTTERANCE", "比 2.4 小"), []),
      ...mathPlugin.interpretEvent(challenge, say("UTTERANCE", "0.3 是 3 个 0.1"), []),
    ];
    expect(mathPlugin.isExpectedEvidenceMet(challenge, evidence)).toBe(false);
    evidence.push(...mathPlugin.interpretEvent(challenge, say("ANSWER", "0.72"), evidence));
    expect(mathPlugin.isExpectedEvidenceMet(challenge, evidence)).toBe(true);
  });
});

describe("讲回与迁移", () => {
  test("讲回必须说明为什么变小和 0.3 的意义", () => {
    expect(mathPlugin.checkExplainBack(challenge, "因为 0.3 是十分之三，乘完只剩十分之三那么多，所以比 2.4 小").passed).toBe(true);
    expect(mathPlugin.checkExplainBack(challenge, "就是 24 乘 3 再点小数点").missing).toEqual(["why_smaller", "tenths_meaning"]);
  });
  test("迁移答案 1.4 通过，1.40 也通过，14 不通过", () => {
    const transfer = mathPlugin.createTransfer(challenge);
    expect(mathPlugin.checkTransferAnswer(transfer, "是 1.4")).toBe(true);
    expect(mathPlugin.checkTransferAnswer(transfer, "1.40")).toBe(true);
    expect(mathPlugin.checkTransferAnswer(transfer, "14")).toBe(false);
  });
  test("五类根因假设与数字解析", () => {
    expect(MATH_HYPOTHESES).toHaveLength(5);
    expect(parseNumbers("大概 0.7 或者 0.72 吧")).toEqual([0.7, 0.72]);
  });
});
