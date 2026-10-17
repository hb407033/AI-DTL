import { expect, test } from "vitest";
import * as teaching from "../src/ai/workspace-teaching-context.js";
import { ChildExpressionContext, expressionFirstGuidance, shouldRephraseQuestion, OneAnswerFollowup, selectTeachingFocus, matchesTeachingQuestion, inquiryForTeaching } from "../src/ai/workspace-teaching-context.js";

test("对话上下文按孩子与老师逐轮排列，排除已否认和待完成回复，不伪造历史对应关系", () => {
  expect(typeof teaching.dialogueForTeaching).toBe("function");
  const result = teaching.dialogueForTeaching([
    { turnId: "t1", text: "我算出商6余8" }, { turnId: "t2", text: "怎么分？" }, { turnId: "t3", text: "我想每组再放一个" },
  ], [
    { turnId: "old", summary: "别的连接里的话", contested: false },
    { turnId: "t1", summary: "剩下8个，你想怎么处理？", contested: false },
    { turnId: "t2", summary: "你已经掌握了", contested: true },
    { turnId: "t3", summary: "", contested: true },
  ]);
  expect(result).toEqual([
    { role: "child", turnId: "t1", text: "我算出商6余8" },
    { role: "teacher", turnId: "t1", text: "剩下8个，你想怎么处理？" },
    { role: "child", turnId: "t2", text: "怎么分？" },
    { role: "child", turnId: "t3", text: "我想每组再放一个" },
  ]);
});

test("教学只读取孩子最新版本的表达，不把父母代记、旧猜想或证据索引当作已看到的解法", () => {
  const base = { kind: "conjecture" as const, author: "child" as const, text: "乘法一定变大", evidenceIds: ["ink"] };
  const context = inquiryForTeaching({ revision: 3, entries: [
    { ...base, entryId: "old" }, { ...base, entryId: "new", revises: "old", text: "乘小于一的数，我猜会变小" },
    { ...base, entryId: "parent", author: "parent", text: "他已经掌握了" },
  ] });
  expect(context.map(e => e.entryId)).toEqual(["new"]);
  expect(context[0]?.text).toBe("乘小于一的数，我猜会变小");
  expect(context[0]?.evidenceIds).toEqual(["ink"]);
  expect(expressionFirstGuidance).toContain("证据编号不代表你看到了旧快照");
});

test("报告结果只问理由，不判断正误；已有理由才邀请检验", () => {
  for (const text of ["我算了一分米是二角四分，三分米是七角二分。", "我算出7.2", "答案是0.72"]) {
    expect(selectTeachingFocus({ turnId: "child", text })).toEqual({ kind: "ask_reason", sourceTurnId: "child", question: "你是怎么得到这个结果的？" });
  }
  expect(selectTeachingFocus({ turnId: "reason", text: "我算出0.72，因为一米分十份，每份再乘三。" })).toEqual({
    kind: "invite_check", sourceTurnId: "reason", question: "你想用什么办法检查自己的结果？" });
  for (const text of ["我想用线表示彩带", "这条线表示一米", "我算不出来", "我算出7.2对吗？", "我不知道结果是多少", "题目说结果是2.4元", "我还没算出结果", "我算了一下", "我算出7.2但不确定", "不要问我结果", "我想休息"]) {
    expect(selectTeachingFocus({ turnId: "t", text }), text).toBeUndefined();
  }
  expect(selectTeachingFocus(undefined)).toBeUndefined();
});

test("已明确报告等分方法和每份数量时邀请检验，不重复索要每份多少", () => {
  expect(selectTeachingFocus({ turnId: "after-hide", text: "提示藏起来了。我自己把一升分成相等的两份，半升就是一份。六元八角也分成相等的两份，每份三元四角。" }))
    .toEqual({ kind: "invite_check", sourceTurnId: "after-hide", question: "你想用什么办法检查自己的结果？" });
  for (const text of ["题目说分成相等的两份，每份三元四角", "我想把六元八角分成两份，每份是多少？",
    "我准备把六元八角分成相等的两份，每份三元四角", "我把它分成相等的两份，但不知道每份是多少"]) {
    expect(selectTeachingFocus({ turnId: "not-result", text }), text).toBeUndefined();
  }
});

test("焦点播报只能匹配选定问题，不允许偷换成给定条件或解题步骤", () => {
  const question = "你是怎么得到这个结果的？";
  expect(matchesTeachingQuestion("你是怎么得到这个结果的?", question)).toBe(true);
  expect(matchesTeachingQuestion("2.4元怎么来的？", question)).toBe(false);
  expect(matchesTeachingQuestion("先分十份。你是怎么得到这个结果的？", question)).toBe(false);
  expect(matchesTeachingQuestion("", question)).toBe(false);
});

test("孩子表达有界、同题同版本、空转写不占位，同轮不重复", () => {
  const context = new ChildExpressionContext();
  for (let n = 0; n < 8; n++) context.add("p", 1, `t${n}`, `想法${n}`);
  context.add("p", 1, "t7", "最后的想法");
  context.add("p", 1, "empty", "  ");
  expect(context.forProblem("p", 1)).toHaveLength(6);
  expect(context.forProblem("p", 1)[0]?.turnId).toBe("t2");
  expect(context.forProblem("p", 1).at(-1)?.text).toBe("最后的想法");
  expect(context.forProblem("p", 2)).toEqual([]);
  expect(context.forProblem("other", 1)).toEqual([]);
  context.add("other", 0, "new", "长".repeat(2000));
  expect(context.forProblem("other", 0)[0]?.text).toHaveLength(1000);
  expect(context.forProblem("p", 1)).toEqual([]);
});

test("自然回答只接续一次；异议、换题、过期和主动休息均作废", () => {
  const followup = new OneAnswerFollowup();
  const last = { responseId: "r", contested: false };
  expect(followup.take("p", 1, last, "这是一米", 1)).toBe(false);
  followup.offer("p", 1, "r", 0);
  expect(followup.take("p", 1, last, "这是一米", 1)).toBe(true);
  expect(followup.take("p", 1, last, "我继续想", 2)).toBe(false);
  for (const text of ["我想休息", "我先自己想", "不要提示", "帮我一下", "你理解错了", ""]) {
    followup.offer("p", 1, "r", 0);
    expect(followup.take("p", 1, last, text, 1)).toBe(false);
  }
  followup.offer("p", 1, "r", 0);
  expect(followup.take("p", 1, { ...last, contested: true }, "一米", 1)).toBe(false);
  followup.offer("p", 1, "r", 0);
  expect(followup.take("p", 2, last, "一米", 1)).toBe(false);
  followup.offer("p", 1, "r", 0);
  expect(followup.take("other", 1, last, "一米", 1)).toBe(false);
  followup.offer("p", 1, "r", 0);
  expect(followup.take("p", 1, { ...last, responseId: "newer" }, "一米", 1)).toBe(false);
  followup.offer("p", 1, "r", 0);
  expect(followup.take("p", 1, last, "一米", 300001)).toBe(false);
  followup.offer("p", 1, "r", 0); followup.clear();
  expect(followup.take("p", 1, last, "一米", 1)).toBe(false);
});

test("教学说明要求以表达为依据，不预设工具和解法，不将推测写成能力判断", () => {
  expect(expressionFirstGuidance).toContain("不要预设等分图");
  expect(expressionFirstGuidance).toContain("转写可能有误");
  expect(expressionFirstGuidance).toContain("只选一个");
  expect(expressionFirstGuidance).toContain("不贴根因或能力标签");
});

test("上一问题未获新表达时，笼统求助不能自动升级提示；有新表达则重新依据证据", () => {
  const previous = { turnId: "review", summary: "这条线代表什么？", contested: false };
  expect(shouldRephraseQuestion(previous, [{ turnId: "review", text: "看看我的想法" }, { turnId: "help", text: "帮我一下" }])).toBe(true);
  expect(shouldRephraseQuestion(previous, [{ turnId: "review", text: "看看我的想法" }, { turnId: "answer", text: "这是一米" }, { turnId: "help", text: "帮我一下" }])).toBe(false);
  expect(shouldRephraseQuestion({ ...previous, contested: true }, [{ turnId: "review", text: "看看我的想法" }, { turnId: "help", text: "帮我一下" }])).toBe(false);
  expect(shouldRephraseQuestion(previous, [{ turnId: "help", text: "帮我一下" }])).toBe(false);
});
