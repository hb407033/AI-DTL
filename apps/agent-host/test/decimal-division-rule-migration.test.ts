import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import { buildDecisionPrompt, type TeachingDecision, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import beforeCompaction from "./fixtures/teaching-prompt-before-compaction.json" with { type: "json" };

const record: WorkspaceRecord = {
  schemaVersion: 2, sessionId: "migration-session", eventId: "initial", revision: 0,
  problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数除法" },
    statement: { text: "12.5÷0.5，先估，再计算。", revision: 0, confirmed: true } },
  phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] },
  submissions: [], feedback: [], openQuestions: [],
};
const base: TeachingInput = { record, turnId: "t", responseId: "r", permission: "review", child: "", history: [] };
function history(child: string, index = 0): TeachingDecision {
  return { problemId: "p", problemRevision: 0, turnId: `prior-${index}`, responseId: `prior-r-${index}`,
    child, focus: "invariance", observation: "孩子说明已有步骤", evidenceIds: [`prior-${index}`],
    resolved: [], utterance: "你准备怎么继续？", method: "scale_both", handoff: false };
}
const transformed = history("我把12.5和0.5同时乘10，变成125除以5。");
const cases: { name: string; input: TeachingInput; sha256: string; contains: string[] }[] = [
  { name: "base", input: base, sha256: "27201619ce1d7ed64b1c5a61bf7201d454e4cd8999a992670adb4ba080b73f46", contains: ["首次开场", "本轮focus允许"] },
  { name: "wrong-answer", input: { ...base, child: "我把12.5和0.5同时乘10，写成125除以5，算出205。" },
    sha256: "ad0a2df67cb07ac0013c0846547492b516b9571792f33a6d2009a9bc497f0bd1", contains: ["孩子最近报告的商=205", "孩子没有给出正确商"] },
  { name: "help2", input: { ...base, permission: "hint", history: [history("我不会，帮我一下。")], child: "还是不会，再帮我一下。" },
    sha256: "098096da4133eaec4c64422ed486e6f520faf507bb932a727698dc0a358fed3f", contains: ["当前最近会话第2次", "孩子再次求助"] },
  { name: "steps", input: { ...base, history: [transformed], child: "我想先算125除以5，怎么列竖式？" },
    sha256: "9d718b10cd97bbc5eebb791fef9f7a3f42ee6075155ebdcf53e08c44cdfa8baa", contains: ["孩子本轮具体要竖式/计算步骤", "孩子选择先算"] },
  { name: "unit-transfer", input: { ...base, history: [transformed,
    history("总量和每一组都扩大十倍，能分的组数没变，所以商不变。", 1),
    history("二十五乘零点五等于十二点五。", 2)],
    child: "我用钱来想，元换角只是单位变了；我自己试四点八除零点六，算出九。" },
    sha256: "deb01c7dfd8f316c4e02617dbbf14eecbad694c983a91a3af9a3c8afdbef4e27", contains: ["孩子已另举新例4.8÷0.6", "新例乘法检验还未核对一致", "换单位必须准确"] },
  { name: "operation-zero", input: { ...base, history: [transformed], child: "我是不是把小数点划掉，右边再补个零，然后当整数除？" },
    sha256: "231c12945f7b7eeca1ff9c4a3995b05ccea7b7a0d9edafd720c0817f6ddf017d", contains: ["完整操作待核对", "本轮执行的唯一教学动作"] },
  { name: "ordinary", input: { ...base, child: "我想先试试。", record: { ...record,
    problem: { ...record.problem!, statement: { text: "平行四边形底8高3求面积。", revision: 0, confirmed: true } } } },
    sha256: "8c4917acda7cab57303a4e9cd85ff0f95be39c985341a095a8c996acf362f789", contains: ["method用ordinary", "不能把某一题型的验算套给其他题"] },
];

const rulePrefixes = [
  ["method", "实际题目是小数除法"], ["visibleSteps", "有可见步骤或口述计算"],
  ["wrongQuotient", "若出现可核对的整数除法错商"], ["progress", "宿主已核对的理解证据="],
  ["focusChoice", "本轮不要默认选invariance"], ["transformationChoice", "还没有孩子正确变换的证据"],
  ["calculationSteps", "孩子本轮具体要竖式/计算步骤"], ["operationCheck", "完整操作待核对"],
  ["verifiedWithoutReason", "计算已经核对一致但理由证据不足"], ["withholdAnswer", "孩子没有给出正确商"],
  ["inviteCalculation", "孩子尚未提供商"], ["transfer", "孩子已另举新例"],
  ["reported", "孩子最近报告的商="], ["quantityMeaning", "解释商不变时"],
  ["transformation", "transformation且review"], ["checkInvitation", "孩子有结果后邀请用乘法检验"],
  ["verify", "verify焦点下"], ["operationAction", "本轮执行的唯一教学动作"],
] as const;

const extraCases = [
  { name: "focus-choice", input: { ...base, history: [transformed], child: "我已经把两边同时乘10了。" } },
  { name: "verified-without-reason", input: { ...base, history: [transformed,
    history("我算出25，25乘0.5等于12.5。", 1)], child: "接下来我自己试试。" } },
];

test("题族规则源码与精简前冻结版本完全一致，18槽位均有实际生成样例", () => {
  const source = readFileSync(new URL("../src/learning/families/decimal-division-rules.ts", import.meta.url));
  expect(createHash("sha256").update(source).digest("hex")).toBe("3b3e298ace6c75b6be874851ad0fdb65fce24bcc8701a790e3549d37471a5028");
  expect(new Set(beforeCompaction.flatMap(item => item.rules.filter(rule => rule.text).map(rule => rule.slot))).size).toBe(18);
});

// 7个完整SHA是2.2搬迁前后的历史等价证据，已在2.3改写前实际验证通过。
// 2.3允许改通用纪律，故不更新完整SHA；另冻结实际规则行、槽位顺序、空槽与facts。
test.each([...cases, ...extraCases])("通用精简保留除法规则原文、顺序及事实：$name", ({ name, input }) => {
  const prompt = buildDecisionPrompt(input);
  const baseline = beforeCompaction.find(item => item.name === name)!;
  const historical = cases.find(item => item.name === name);
  if (historical) expect(baseline.historicalFullPromptSha256).toBe(historical.sha256);
  for (const line of historical?.contains ?? []) expect(prompt).toContain(line);
  const lines = prompt.split("\n");
  expect(lines.at(-1)).toBe(baseline.facts);
  expect(rulePrefixes.map(([slot, prefix]) => ({ slot, text: lines.find(line => line.startsWith(prefix)) ?? "" }))).toEqual(baseline.rules);
  expect(lines.filter(line => baseline.rules.some(rule => rule.text && rule.text === line)))
    .toEqual(baseline.rules.filter(rule => rule.text).map(rule => rule.text));
});

test.each([...cases, ...extraCases])("通用prefix至少减少30%，事实不计入节省：$name", ({ name, input }) => {
  const baseline = beforeCompaction.find(item => item.name === name)!;
  const prompt = buildDecisionPrompt(input);
  const facts = prompt.split("\n").at(-1)!;
  const ruleLength = baseline.rules.reduce((total, rule) => total + rule.text.length, 0);
  const genericBefore = baseline.prefixLength - ruleLength;
  const genericAfter = prompt.length - facts.length - 1 - ruleLength;
  expect(genericAfter).toBeLessThanOrEqual(genericBefore * 0.7);
  expect(prompt.length).toBeLessThan(16000);
});

test("普通题不注入小数除法专属规则", () => {
  const prompt = buildDecisionPrompt(cases.find(item => item.name === "ordinary")!.input);
  for (const line of ["实际题目是小数除法", "method必须scale_both", "宿主已核对的理解证据=", "孩子没有给出正确商", "完整操作待核对", "本轮执行的唯一教学动作"])
    expect(prompt).not.toContain(line);
});
