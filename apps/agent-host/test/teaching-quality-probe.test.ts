import { expect, test } from "vitest";
import { classifyFaultReview, nextQualityInput, claimQualityBudget } from "../scripts/probe-teaching-quality.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TeachingInput, TeachingDecision } from "../src/ai/workspace-teaching-decision.js";

test("坏稿对照只有明确且有效的拒绝才算检出，格式错误不得算成功", () => {
  expect(classifyFaultReview('{"allowed":false,"reason":"help_not_reduced"}')).toBe(false);
  expect(classifyFaultReview('```json\n{"allowed":false,"reason":"repeated_question"}\n```')).toBe(false);
  expect(classifyFaultReview('{"allowed":true,"reason":"none"}')).toBe(true);
  expect(classifyFaultReview('{"allowed":false,"reason":"unknown"}')).toBe(null);
  expect(classifyFaultReview('{"allowed":false,"reason":"none"}')).toBe(null);
  expect(classifyFaultReview('not json')).toBe(null);
});

test("续聊只追加实际交付历史，不修改冻结输入；求助为hint而换思路为review", () => {
  const input = { history: [], child: "原话", imageId: "photo", record: { problem: { problemId: "p", statement: { revision: 0 } },
    board: { revision: 0 }, submissions: [], feedback: [] } } as unknown as TeachingInput;
  const decision = { turnId: "t", responseId: "r", utterance: "实际交付" } as TeachingDecision;
  const before = JSON.stringify(input);
  const next = nextQualityInput(input, decision, "我不会，帮我一下", "case-1");
  expect(next.permission).toBe("hint");
  expect(next.history).toEqual([decision]);
  expect(next.record.feedback[0]!.summary).toBe("实际交付");
  expect(next.record.submissions[0]!.explanation).toBe("我不会，帮我一下");
  expect(next.imageId).toBe("photo");
  expect(nextQualityInput(next, decision, "我想用手指当树，先自己试", "case-2").permission).toBe("review");
  expect(JSON.stringify(input)).toBe(before);
});

test("补验继承原调用数/费用/截止时间，不能重置额度或重复启动", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "quality-budget-"));
  const output = path.join(parent, "followup"); await fs.mkdir(output);
  const original = { calls: 33, maxCalls: 60, deadline: Date.now() + 100000, knownCostCny: 0.1, costLimitCny: 0.6 };
  await fs.writeFile(path.join(parent, "quality-ledger.json"), JSON.stringify(original));
  try {
    expect(await claimQualityBudget(output, parent)).toEqual(original);
    await expect(claimQualityBudget(output, parent)).rejects.toThrow();
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
