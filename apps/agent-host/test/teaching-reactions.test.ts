import { expect, test } from "vitest";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import { validateTeachingDecision, buildDecisionPrompt, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import { divisionProgress, spokenMath } from "../src/learning/decimal-division-policy.js";

const record: WorkspaceRecord = { schemaVersion: 2, sessionId: "reactions", eventId: "initial", revision: 0,
  problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数除法" },
    statement: { text: "12.5÷0.5", revision: 0, confirmed: true } }, phase: "exploring",
  childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
const input: TeachingInput = { record, turnId: "t", responseId: "r", permission: "review", child: "", history: [] };
const reason = "总量和每一组都扩大十倍，能分的组数没变，所以商不变。";
const raw = { focus: "invariance", observation: "本轮孩子自己的表达", evidenceIds: ["t"],
  utterance: "你准备怎样检查？", method: "scale_both", handoff: false };

test("不懂词语先澄清，不强迫回答商不变", () => {
  expect(validateTeachingDecision({ ...raw, focus: "clarify", utterance: "商就是除法算出的结果。" },
    { ...input, child: "商是什么意思？" }).focus).toBe("clarify");
});
test("不会时提示聚焦一处，不重复上轮同义问题", () => {
  const previous = validateTeachingDecision({ ...raw, utterance: "为什么商不变？" }, input);
  expect(() => validateTeachingDecision({ ...raw, utterance: "商为什么不变呢？" },
    { ...input, child: "我不会", permission: "hint", history: [previous] })).toThrow();
  expect(buildDecisionPrompt({ ...input, child: "我不会", permission: "hint", history: [previous] })).toContain("具体小动作");
});
test("猜中答案不算解释，但应先检验猜测而非强制旧焦点", () => {
  expect(validateTeachingDecision({ ...raw, focus: "verify", utterance: "先不急着确定，你想怎么检查这个猜测？" },
    { ...input, child: "我猜是二十五，不知道为什么。" }).focus).toBe("verify");
});
test("错误商不会被肯定，算错检验会撤销已完成状态", () => {
  expect(() => validateTeachingDecision({ ...raw, utterance: "二百零五算对了。" },
    { ...input, child: "算出205" })).toThrow();
  expect(divisionProgress("12.5÷0.5", [reason, "25乘0.5等于12.5", "不对，我检验25乘0.5等于13。"] )?.next).not.toBe("return");
});
test("只改一个数是变换问题，不误判为独立新例", () => {
  const state = divisionProgress("12.5÷0.5", ["我只把0.5乘10，算12.5÷5，可以吗？"]);
  expect(state?.transfer).toBeUndefined();
  expect(state?.next).toBe("transformation");
  expect(() => validateTeachingDecision({ ...raw, focus: "transformation",
    utterance: "被除数和除数同时乘10，变成125÷5，这样商才不变。" },
    { ...input, child: "我只把0.5乘10，算12.5÷5，可以吗？" })).toThrow();
});
test("儿童换单位解释与分组解释等价，不要求背指定句式", () => {
  const state = divisionProgress("12.5÷0.5", ["我按钱来想，十二点五元换成一百二十五角，每份零点五元换成五角，单位一起变了，份数没变。"]);
  expect(state?.resolved).toContain("invariance");
  expect(state?.next).toBe("place_value");
});
test("数值正确且解释钱没增加只是单位变细，不要求补说指定的份数句式", () => {
  expect(divisionProgress("12.5÷0.5", ["是单位变了！12.5元变成125角，0.5元变成5角。钱总数没多，只是数得更细了，所以商还是25。"])
    ?.resolved).toContain("invariance");
  expect(divisionProgress("12.5÷0.5", ["单位变了，12.5元变成125角，0.5元变成50角。钱没增加。"])
    ?.resolved).not.toContain("invariance");
});
test("孩子主动换图示或指出歧义时允许先核对，不偷改题干", () => {
  for (const child of ["我不想画图，我想用钱来想。", "我想把12.5米按每段0.5米剪，数一数。", "我说的不是12月5日，是12.5这个小数。"]) {
    expect(validateTeachingDecision({ ...raw, focus: "clarify", utterance: "好，先按你的意思说说这个数量表示什么。" },
      { ...input, child }).focus).toBe("clarify");
  }
  expect(record.problem!.statement.text).toBe("12.5÷0.5");
});
test("退回不理解或表示只跟读时，不保留虚假的毕业状态", () => {
  for (const child of ["我其实还是没懂为什么商不变。", "刚才那句是照着你说的，我不知道为什么。"]) {
    expect(divisionProgress("12.5÷0.5", [reason, "25乘0.5等于12.5", child])?.next).not.toBe("return");
  }
});
test("计划、假设和否定的乘法等式不能成为检验完成证据", () => {
  for (const child of ["我准备算25乘0.5等于12.5。", "如果25乘0.5等于12.5呢？", "25乘0.5不是等于12.5吗？", "我还没算，不知道25乘0.5等于12.5对不对。"]) {
    expect(divisionProgress("12.5÷0.5", [reason, child])?.resolved, child).not.toContain("verify");
  }
});
test("新例先答错再自行修正，不让旧错误答案阻止本轮正确检验", () => {
  const state = divisionProgress("12.5÷0.5", ["我想换一道4.8÷0.6", "我算出九", "我改成八了，八乘零点六等于四点八。"]);
  expect(state?.transfer?.reported).toBe(8);
  expect(state?.next).toBe("return");
});
test("孩子已经自己选择乘法检验时，可以接着检查他的乘法，不强迫重选方法", () => {
  const previous = { ...validateTeachingDecision(raw, input), child: reason + "我改成25了。" };
  expect(validateTeachingDecision({ ...raw, focus: "verify", utterance: "你选择了乘法检验，那25乘0.5的结果再核对一下？" },
    { ...input, child: "我算25乘0.5等于13。", history: [previous] }).focus).toBe("verify");
});
test("乘法检验算错时指出不一致，不替孩子直接报出正确乘积", () => {
  const previous = { ...validateTeachingDecision(raw, input), child: reason + "我改成25了。" };
  expect(() => validateTeachingDecision({ ...raw, focus: "verify", utterance: "25乘0.5是12.5，不是13。" },
    { ...input, child: "我算25乘0.5等于13。", history: [previous] })).toThrow();
});
test("新题错误商只能作为孩子的猜测引用，不能被老师直接宣布为结果", () => {
  const previous = { ...validateTeachingDecision(raw, input), child: "我想换一道4.8÷0.6。" };
  expect(() => validateTeachingDecision({ ...raw, focus: "transfer", utterance: "结果是9，你想怎么检验？" },
    { ...input, child: "我算出九。", history: [previous] })).toThrow();
});
test("没提供商时，不预填商的数字或数位；新题也让孩子自己选检验方法", () => {
  for (const utterance of ["商的2和5分别对应哪个数位？", "商的百位和十位分别表示什么？"]) {
    expect(() => validateTeachingDecision({ ...raw, focus: "place_value", utterance }, { ...input, child: reason })).toThrow();
  }
  const previous = { ...validateTeachingDecision(raw, input), child: "我换一道4.8÷0.6。" };
  expect(() => validateTeachingDecision({ ...raw, focus: "transfer", utterance: "你算出九，用乘法检验一下？" },
    { ...input, history: [previous], child: "我算出九。" })).toThrow();
});
test("孩子说另一边也乘十并给出整数式时，解除上一轮单边变换错误", () => {
  expect(divisionProgress("12.5÷0.5", ["我只把0.5乘10，算12.5÷5。", "那把12.5也乘10变成125，再除以5，是不是才对？"])?.next).toBe("invariance");
});
test("ASR逐位读出的幺零和二零保留十与二十的数学含义", () => {
  expect(spokenMath("幺零乘二零等于二百")).toBe("10×20=200");
});
test("孩子拒绝继续解释理由时先协商，不把知识点进度变成强迫追问", () => {
  const previous = { ...validateTeachingDecision(raw, input), child: "两个数都乘十，变成125除以5。" };
  const current = { ...input, child: "我都说别问为什么了！我就想知道125除以5，您直接告诉我答案行不行？", history: [previous] };
  const decision = validateTeachingDecision({ ...raw, focus: "clarify", utterance: "好，先不解释理由。你想先试算，还是先歇一会儿？" }, current);
  expect(decision.focus).toBe("clarify");
  expect(decision.resolved).not.toContain("invariance");
  expect(validateTeachingDecision({ ...raw, focus: "clarify", utterance: "好的，那我们先暂停讨论理由。你按刚才转换的式子自己算算看吧。" }, current).focus).toBe("clarify");
  for (const utterance of ["好，先不急着讨论为什么。你想自己算算看吗？", "咱们先把为什么放一边，你想自己试算吗？", "先不纠结理由。你愿意先试算吗？"])
    expect(validateTeachingDecision({ ...raw, focus: "clarify", utterance }, current).focus).toBe("clarify");
  expect(() => validateTeachingDecision({ ...raw, focus: "clarify", utterance: "两个数都扩大十倍，分出来的份数为什么没变？" }, current)).toThrow("declinedExplanation");
  expect(() => validateTeachingDecision({ ...raw, focus: "clarify", utterance: "再说说为什么商不变。" }, current)).toThrow("declinedExplanation");
});
test("换单位的提示不能把米换厘米说成十倍", () => {
  expect(() => validateTeachingDecision({ ...raw, utterance: "把两个数看成米，同时扩大10倍变成厘米，分的段数会变吗？" },
    { ...input, child: "我不会", permission: "hint" })).toThrow("unitConversionMismatch");
});
