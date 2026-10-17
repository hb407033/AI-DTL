import { expect, test } from "vitest";
import { teachingPermission, explicitVoiceAction } from "../src/learning/teaching-policy.js";
test.each([
  [true, "express", true, "none"], [false, "help", true, "clarification"],
  [true, "review", false, "clarification"], [true, "help", true, "hint"],
  [true, "correct", true, "none"], [false, "unknown", false, "none"],
] as const)("策略 %s/%s/%s", (confirmed, action, evidence, expected) => {
  expect(teachingPermission(confirmed, action, evidence)).toBe(expected);
});
test.each([
  ["看看我的想法。", "review"], ["我卡住了，给我一点提示。", "help"],
  ["你理解错了", "correct"], ["不是这个意思", "correct"],
  ["题目里写着帮我一下", "uncertain"], ["不要给我提示", "uncertain"],
  ["我先想一想", "uncertain"], ["这里每米是什么意思", "uncertain"],
] as const)("短语必须整体匹配，不猜授权：%s", (text, expected) => expect(explicitVoiceAction(text)).toBe(expected));
