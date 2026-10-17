import { expect, test } from "vitest";
import { dialogueReplyIssue } from "../src/ai/workspace-dialogue-reply.js";

const expressions = ["我先把二点四乘三，得到七点二。", "但是零点三比一小，七点二太大了。"];
test("孩子已解释计算来源，不再换词追问来源", () => {
  expect(dialogueReplyIssue("你发现得对。那7.2是怎么来的呢？", "review", expressions)).toBe("repeatedReason");
  expect(dialogueReplyIssue("能说说你是怎么算出这个数的吗？", "review", expressions)).toBe("repeatedReason");
  expect(dialogueReplyIssue("你是怎么得到这个结果的？", "review", ["我得到7.2"])).toBeUndefined();
  expect(dialogueReplyIssue("你是怎么得到这个结果的？", "review", ["我打算先把2.4乘3"])).toBeUndefined();
  expect(dialogueReplyIssue("你是怎么得到这个结果的？", "review", [...expressions, "我后来得到8"])).toBeUndefined();
});
test("查看权限不播报未求助的计算规则，但允许引用孩子已用的规则", () => {
  const procedure = "接下来需要看因数里一共有几位小数，再调整积的小数点位置。";
  expect(dialogueReplyIssue(procedure, "review", expressions)).toBe("unsolicitedProcedure");
  expect(dialogueReplyIssue(procedure, "hint", expressions)).toBeUndefined();
  expect(dialogueReplyIssue("你解释了小数点位置的调整。继续检验吧。", "review", ["我调整积的小数点位置"])).toBeUndefined();
});
test("保留基于新发现的自然引导，不判能力、正误或追问所有相似句", () => {
  expect(dialogueReplyIssue("你发现7.2太大了，接下来想怎样调整？", "review", expressions)).toBeUndefined();
  expect(dialogueReplyIssue("这个结果符合你的大小检验，可以继续独立试试。", "review", expressions)).toBeUndefined();
  expect(dialogueReplyIssue("", "review", expressions)).toBe("length");
  expect(dialogueReplyIssue("你想怎么做？为什么？", "review", expressions)).toBe("multipleQuestions");
});
