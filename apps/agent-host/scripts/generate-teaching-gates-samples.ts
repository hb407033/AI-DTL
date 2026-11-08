// 从现有 validateTeachingDecision 抽出两端共用样例。只写判断结果，不含录音或密钥。
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { keepOneQuestion, validateTeachingDecision, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";

const record = {
  schemaVersion: 2, sessionId: "gates", eventId: "initial", revision: 0,
  problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "植树问题" },
    statement: { text: "60米的小路一侧，每隔5米栽一棵，两端都栽，一共多少棵？", revision: 0, confirmed: true } },
  phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [],
};
const divisionRecord = {
  ...record,
  problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数除法" },
    statement: { text: "12.5÷0.5", revision: 0, confirmed: true } },
};
const prior = {
  problemId: "p", problemRevision: 0, turnId: "prior", responseId: "prior-r",
  child: "六十除以五是十二，我先答十二棵。", focus: "verify", observation: "孩子把间隔当棵数",
  evidenceIds: ["prior"], resolved: [] as string[], utterance: "先拿10米、每隔5米两端都栽的小路试试，看有几段、几棵树？",
  method: "ordinary", handoff: false,
};
type Ctx = Record<string, unknown>;
const base = (extra: Ctx = {}): Ctx => ({
  record, turnId: "t", responseId: "r", permission: "hint",
  child: "我不会区分间隔和树，给一个小例子吧。", history: [], imageAttached: false, ocrNumbers: [], ...extra,
});
const okDraft = {
  focus: "clarify", observation: "孩子求助区分间隔和树", evidenceIds: ["t"],
  utterance: "先只画一段短路，在起点点一个点表示树。", method: "ordinary", handoff: false,
};
function asInput(context: Ctx): TeachingInput {
  const { imageAttached, ocrNumbers: _ocr, ...rest } = context;
  return { ...(rest as unknown as TeachingInput), image: imageAttached ? Buffer.from([1]) : undefined };
}
function judge(draft: unknown, context: Ctx) {
  try {
    return { ok: true, draft: validateTeachingDecision(draft, asInput(context)) };
  } catch (error) {
    const reason = error instanceof z.ZodError ? "invalidStructure" : error instanceof Error ? error.message : "invalidStructure";
    const utterance = draft && typeof draft === "object" && typeof (draft as { utterance?: unknown }).utterance === "string"
      ? (draft as { utterance: string }).utterance : "";
    return { ok: false, reason, ...(reason === "questionLimit_onlyOneQuestion" ? { rewrite: keepOneQuestion(utterance) } : {}) };
  }
}
const cases: { name: string; draft: unknown; context: Ctx }[] = [
  { name: "正常通过-小例子", draft: okDraft, context: base() },
  { name: "正常通过-核对问法", draft: { ...okDraft, utterance: "你写的是不是12吗？" }, context: base({ permission: "review", child: "我先写了一步。" }) },
  { name: "正常通过-承接想法", draft: { ...okDraft, utterance: "你说先标出两端，这两端各有一棵，中间还有几段？" }, context: base({ permission: "review", child: "我先标出两端。" }) },
  { name: "正常通过-澄清词义", draft: { ...okDraft, utterance: "间隔是两棵树中间空着的那段路。" }, context: base({ permission: "clarification", child: "间隔是什么意思？" }) },
  { name: "正常通过-交还", draft: { ...okDraft, focus: "return", handoff: true, utterance: "接下来你自己试试。" }, context: base({ permission: "review", child: "我明白了，自己再试一题。" }) },
  { name: "多问-两问号", draft: { ...okDraft, utterance: "有几段？有几棵树？" }, context: base() },
  { name: "多问-一问加一问", draft: { ...okDraft, utterance: "先数有几段？再数有几棵？" }, context: base() },
  { name: "抢答-报出题干没有的棵数", draft: { ...okDraft, utterance: "要栽13棵。" }, context: base({ permission: "review", child: "我还没算。" }) },
  { name: "抢答-答案是", draft: { ...okDraft, utterance: "答案是13。" }, context: base({ permission: "review", child: "我还没算。" }) },
  { name: "口诀-移动小数点", draft: { ...okDraft, utterance: "试着把3.6的小数点向左移一位，再乘4看看？" }, context: base() },
  { name: "口诀-末尾添零", draft: { ...okDraft, utterance: "末尾添0再乘就行，你先试试？" }, context: base() },
  { name: "口诀-当成整数来乘", draft: { ...okDraft, utterance: "先当成整数来乘，再看小数点。" }, context: base({ permission: "review", child: "这题怎么做？" }) },
  { name: "断言孩子写的数", draft: { ...okDraft, utterance: "你算出的商是209。" }, context: base({ permission: "review", child: "我算完了。", imageAttached: true, ocrNumbers: ["209"] }) },
  { name: "断言卷子上的数", draft: { ...okDraft, utterance: "卷子上写的是209。" }, context: base({ permission: "review", child: "我写好了。", imageAttached: true, ocrNumbers: ["209"] }) },
  { name: "核对问法不拦", draft: { ...okDraft, utterance: "你写的是不是209？" }, context: base({ permission: "review", child: "我写好了。", imageAttached: true, ocrNumbers: ["209"] }) },
  { name: "重复上问", draft: { ...okDraft, utterance: prior.utterance }, context: base({ permission: "review", child: "我数了段数。", history: [prior] }) },
  { name: "明确重听不算重复", draft: { ...okDraft, utterance: prior.utterance }, context: base({ permission: "clarification", child: "我没听清，刚才那句再说一遍。", history: [prior] }) },
  { name: "字数超过90", draft: { ...okDraft, utterance: "我们先只看一小段路，从起点开始一棵一棵点，点到这一小段结束，再回头数有几段空格、有几棵树，先不要算整条路。".repeat(2) }, context: base() },
  { name: "空洞应声", draft: { ...okDraft, utterance: "好的。" }, context: base() },
  { name: "是非问接不住", draft: { ...okDraft, utterance: "这样好算吗？" }, context: base() },
  { name: "能力标签", draft: { ...okDraft, utterance: "你已经掌握了。" }, context: base({ permission: "review", child: "我做对了。" }) },
  { name: "动作名念出来", draft: { ...okDraft, utterance: "请做 represent 这一步。" }, context: base() },
  { name: "没有图却说看见画了", draft: { ...okDraft, utterance: "你画了一棵树，再数数有几段？" }, context: base({ imageAttached: false }) },
  { name: "证据编号不存在", draft: { ...okDraft, evidenceIds: ["missing"] }, context: base() },
  { name: "漏引本轮", draft: { ...okDraft, evidenceIds: ["problem"] }, context: base() },
  { name: "澄清权限答成别的焦点", draft: { ...okDraft, focus: "verify", utterance: "你想用什么办法检查？" }, context: base({ permission: "clarification", child: "间隔是什么意思？" }) },
  { name: "交还却还在问", draft: { ...okDraft, focus: "return", handoff: true, utterance: "接下来你自己试试吗？" }, context: base({ permission: "review", child: "我想自己试试。" }) },
  { name: "为什么原样抛回", draft: { ...okDraft, utterance: "为什么间隔和树不一样？" }, context: base({ child: "我不懂为什么要多算一棵？" }) },
  { name: "开场直接指错", draft: { ...okDraft, utterance: "这个零是多余的吗？" }, context: base({ permission: "review", child: "", history: [] }) },
  { name: "小数除法抢答正确商", draft: { ...okDraft, focus: "transformation", method: "scale_both", utterance: "先看看被除数，商是25。" }, context: base({ record: divisionRecord, permission: "review", child: "我还没算出来。" }) },
];
if (cases.length !== 30) throw Error(`需要 30 条，实际 ${cases.length}`);
const samples = cases.map(item => ({ ...item, expect: judge(item.draft, item.context) }));
const blocked = samples.filter(s => !s.expect.ok).map(s => `${s.name}:${s.expect.reason}`);
console.error(blocked.join("\n"));
await writeFile(new URL("../test/fixtures/teaching-gates-samples.json", import.meta.url), JSON.stringify(samples, null, 2) + "\n");
