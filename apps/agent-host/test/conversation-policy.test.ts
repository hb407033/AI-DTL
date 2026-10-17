import { expect, test } from "vitest";
import { conversationAction, isPauseRequest } from "../src/learning/conversation-policy.js";

test("开启对话后自然的短句求助可给一步提示，引用、否定和独立模式不能借此升级", () => {
  for (const text of ["怎么分？", "嗯，怎么分呀。", "怎么分？怎么分。", "我不知道怎么分", "能给我一点提示吗？"]) {
    expect(conversationAction("dialogue", text), text).toBe("help");
    expect(conversationAction("independent", text), text).toBe("uncertain");
  }
  for (const text of ["不要告诉我怎么分", "他问我怎么分", "我知道怎么分", "题目问怎么分", "如果我问怎么分呢"]) {
    expect(conversationAction("dialogue", text), text).toBe("review");
  }
});

test("对话模式：开放表达允许核对含义，不要求固定求助口令", () => {
  expect(conversationAction("dialogue", "这里的每米是什么意思？")).toBe("review");
  expect(conversationAction("dialogue", "我觉得是7.2，因为我先算24乘3。")).toBe("review");
  expect(conversationAction("dialogue", "你理解错了")).toBe("correct");
  // 明确纠正开头+补充内容必须 correct，不能被对话默认 review 覆盖
  expect(conversationAction("dialogue", "你理解错了，我说的是0.3米。")).toBe("correct");
  expect(conversationAction("dialogue", "不是这个意思，应该是0.3米")).toBe("correct");
  expect(conversationAction("dialogue", "帮我一下")).toBe("help");
});

test("明确暂停优先于对话默认 review，且独立模式也识别暂停", () => {
  expect(conversationAction("dialogue", "不要给我提示。")).toBe("pause");
  expect(conversationAction("dialogue", "我先想一想")).toBe("pause");
  expect(conversationAction("dialogue", "我想想，先别说")).toBe("pause");
  expect(conversationAction("independent", "停一下")).toBe("pause");
  expect(isPauseRequest("等一下！")).toBe(true);
});

test("独立模式：开放表达不自动升级为 review 或 hint，纠正开头也不放宽", () => {
  expect(conversationAction("independent", "我觉得是7.2。")).toBe("uncertain");
  expect(conversationAction("independent", "这里的每米是什么意思？")).toBe("uncertain");
  // 独立模式不放宽：纠正开头+补充内容不自动 correct，仍需完整短语
  expect(conversationAction("independent", "你理解错了，我说的是0.3米。")).toBe("uncertain");
});

test("空或纯标点不构成表达，对话模式也不给 review", () => {
  expect(conversationAction("dialogue", "")).toBe("uncertain");
  expect(conversationAction("dialogue", "，。！？")).toBe("uncertain");
});

test("明确求助/纠正不被对话默认 review 覆盖", () => {
  expect(conversationAction("dialogue", "看看我的想法")).toBe("review");
  expect(conversationAction("dialogue", "你理解错了")).toBe("correct");
  expect(conversationAction("dialogue", "我卡住了")).toBe("help");
});

test("对话模式不凭通用否定/引用误触发 correct", () => {
  // "不是这样的"不是纠正开头，归 review（开放表达）
  expect(conversationAction("dialogue", "不是这样的")).toBe("review");
  // "你说的是0.3米"是引用不是纠正，归 review
  expect(conversationAction("dialogue", "你说的是0.3米")).toBe("review");
  expect(conversationAction("dialogue", "我觉得不对")).toBe("review");
});

test("真实的不会与没听懂是求助，但引用、否定和独立状态不升级", () => {
  for (const text of ["我不会", "不知道", "我还是不会。", "没听懂", "我不明白为什么", "我不会，你给我一点提示吧。", "我不想画图，能用钱来想吗？", "我其实还是没懂为什么商不变。", "刚才那句是照着你说的，我不知道为什么。", "我说我不会这道题。"]) {
    expect(conversationAction("dialogue", text), text).toBe("help");
    expect(conversationAction("independent", text), text).toBe("uncertain");
  }
  for (const text of ["我不是不会", "同学说他不会", "如果我不会呢", "不要给我答案", "我不会，但先别提示，我想自己试试"]) {
    expect(conversationAction("dialogue", text), text).not.toBe("help");
  }
});
test("孩子要求先别提示、自己试试时暂停，不继续追问", () => {
  for (const child of ["先别提示，我想自己试试。", "我不会，但先别提示，我想自己试试。", "先别说，我想自己想想。"])
    expect(conversationAction("dialogue", child)).toBe("pause");
});
