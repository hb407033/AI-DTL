import { createHash } from "node:crypto";
import type { TeachingInput, TeachingDecision } from "../src/ai/workspace-teaching-decision.js";

export interface ProductionBudget { calls: number; maxCalls: number; deadline: number; knownCostCny: number; costLimitCny: number }
export function reserveProductionCall(b: ProductionBudget, now: number) {
  if (now >= b.deadline) throw Error("deadline");
  if (b.calls >= b.maxCalls) throw Error("callBudget");
  if (b.knownCostCny >= b.costLimitCny) throw Error("costBudget");
  b.calls++;
}
export interface ArchiveFixture { id: string; input: TeachingInput; imageBase64: string; provenance?: unknown }
export interface ProductionCase extends ArchiveFixture { category: "original" | "regression" | "move"; source: string }
export interface Trajectory { id: string; baseId: string; problem: string; correctFrom: number; turns: string[] }
const idFor = (id: string, kind: string) => createHash("sha256").update(id + kind).digest("hex").slice(0, 32);

/** 固定快照与脚本，既不从模型选择下一句，也不把未来回复泄入当前输入。 */
export function buildProductionCases(originals: ArchiveFixture[], previousResults: { case: string; arm: string; stage: string; child: string; parsed?: Partial<TeachingDecision>; id?: string }[]) {
  if (originals.length !== 8) throw Error("eightOriginalCasesRequired");
  const base = (id: string) => structuredClone(originals.find(f => f.id === id)!);
  const initial: ProductionCase[] = originals.map(f => ({ ...structuredClone(f), category: "original", source: "2026-10-11 archived input" }));
  const add = (id: string, from: string, child: string, category: ProductionCase["category"], parentArm?: string) => {
    const f = base(from);
    if (!f) throw Error("missingSourceCase");
    const parent = previousResults.find(r => r.case === from && r.stage === "initial" && r.arm === parentArm);
    if (parent?.parsed) {
      const d = { ...parent.parsed, problemId: f.input.record.problem!.problemId,
        problemRevision: f.input.record.problem!.statement.revision, turnId: f.input.turnId,
        responseId: f.input.responseId, child: f.input.child, resolved: [] } as TeachingDecision;
      f.input.history.push(d);
      f.input.record.feedback.push({ turnId: d.turnId, responseId: d.responseId, summary: d.utterance, contested: false });
    }
    f.input.child = child; f.input.turnId = idFor(id, "turn"); f.input.responseId = idFor(id, "response");
    f.input.permission = /我(?:还是)?不会|给我.*(?:动作|提示)|我还是不明白/u.test(child) ? "hint" : "review";
    initial.push({ ...f, id, category, source: parent ? `archived parent ${parent.id}` : "fixed simulated child variant" });
  };
  add("regression-area-leak", "area-why", "我觉得是高变小了，里面格子少了。可把斜边看成宽，为什么就多算了？我不会画，你给我一个具体小动作。", "regression", "thinking");
  add("regression-help-ignored", "trees-missing-zero", "我补了零米，一数是三棵、两个间隔。可我还是不明白原题为什么要加一，给我一个具体小动作。", "regression", "realtime");
  add("regression-fabricated-image", "trees-missing-zero", "我换成十米的短小路，在五米和十米画了两棵树，是两个间隔，我还是分不清，是不是漏了什么地方。", "regression");
  const moves = [
    ["understand", "trees-missing-zero", "我还没读清楚，两端都栽到底是哪两个地方？"],
    ["represent", "area-why", "我口头说不清底和高，我想换个看得见的办法。给我一点提示。"],
    ["specialize", "trees-missing-zero", "六十米太长，我还是不会，给我一个小例子试试。"],
    ["vary", "area-why", "我觉得斜边越长面积越大。可我不懂为什么不能用斜边。"],
    ["conjecture", "multiply-no-answer", "我先猜零点四千克的钱比三点六元少，但还没算出来。"],
    ["use_data", "trees-missing-zero", "我算六十除五得十二，但题目里两端都栽这个条件还没有用上。"],
    ["justify", "division-one-side", "我只把零点六乘十变六，五点四不变，我觉得这样也能除。"],
    ["look_back", "equation-resume", "我解出十四元并代回去了，三乘十四加八等于五十。我还想自己检验一个变化。"],
  ];
  for (const [move, from, child] of moves) add(`move-${move}`, from!, child!, "move");
  const multiturn: Trajectory[] = [
    { id: "divide", baseId: "division-one-side", problem: "一根长5.4米的彩带，每段0.6米，可以剪成几段？", correctFrom: 3,
      turns: ["我只把零点六乘十变六，五点四不变，算出零点九段。", "我还是不会，能给一个小动作让我检查这样变行不行？", "总长换成五十四分米，每段换成六分米，只换单位，真实彩带不变，段数也不变。", "我自己算五十四除以六等于九，所以九段。", "我用零点六乘九得五点四，能乘回总长。", "我换六点六米每段零点六，算十一段，用零点六乘十一得六点六。我想自己再试。"] },
    { id: "multiply", baseId: "multiply-no-answer", problem: "每千克苹果3.6元，买0.4千克要多少元？", correctFrom: 4,
      turns: ["我算十四点四元，乘法不是都会变多吗？", "我还是不会理解乘零点四，你给我一个小动作。", "我把一千克分十份，零点四是四份，钱也跟着分十份。", "每份零点三六元，只取四份，这样对应得对吗？", "我自己算四份共一点四四元，比三点六少，和四份比十份少对得上。", "我自己换零点二千克，只取两份是零点七二元，刚才四份的钱是一倍多。我想自己继续试。"] },
    { id: "area", baseId: "area-why", problem: "一块平行四边形花坛，底8米，高3米，斜边5米。面积是多少平方米？", correctFrom: 4,
      turns: ["我用八乘五得四十，因为它们都是边。", "我不懂为什么不能用斜边，别只让我背底乘高。", "我还是不会画，你给我一个具体小动作。", "我把它压扁，底和斜边不变，里面格子变少，高变了。", "我沿高剪拼成长方形，不少一块不重叠，底八高三，所以面积二十四平方米。", "我再把斜边改成六，底和高不变，面积仍二十四，因为剪拼后的长方形没变。我想自己试。"] },
    { id: "planting", baseId: "trees-missing-zero", problem: "在一条长60米的小路一侧，每隔5米栽一棵树，两端都栽。一共要栽多少棵树？", correctFrom: 3,
      turns: ["六十除以五是十二，我先答十二棵。", "我不会区分间隔和树，给一个小例子吧。", "我试十米小路，画零、五、十，三棵树只有两个间隔。", "回到六十米是十二个间隔，开始多一棵，所以十三棵。", "我自己改成只栽一端就十二棵，两端不栽就十一棵，间隔仍十二个。", "我会先画短路核对端点，不直接背加一减一。我想自己试下一题。"] },
    { id: "equation", baseId: "equation-resume", problem: "一本故事书x元，买3本，付50元，找回8元。每本故事书多少元？", correctFrom: 3,
      turns: ["我列三乘x等于五十加八，不知道对不对。", "我不会分清花掉的和找回的，给我一个小动作。", "五十元里一部分花掉一部分找回八元，买书花四十二，所以三乘x加八等于五十。", "两边减八再都除三，x等于十四元。", "我代回，三乘十四加八等于五十，和付的钱一样。", "我自己换买两本十四元的书，付五十找回二十二，两乘十四加二十二还是五十。我想自己继续。"] },
  ];
  return { initial, multiturn };
}

export function productionGate(results: { caseId: string; mode: string; error: string | null; decision?: { move?: string } }[],
  grades: { caseId: string; mode: string; t1: number; t2: number; hard: string[] }[]) {
  const missing = results.filter(r => !grades.some(g => g.caseId === r.caseId && g.mode === r.mode));
  const errors = results.filter(r => r.error || !r.decision);
  const scored = grades.length === results.length && !missing.length && grades.every(g => [0, 1, 2].includes(g.t1) && [0, 1, 2].includes(g.t2) && Array.isArray(g.hard));
  const t1 = scored ? grades.reduce((n, g) => n + g.t1, 0) / grades.length : null;
  const t2 = scored ? grades.reduce((n, g) => n + g.t2, 0) / grades.length : null;
  return { passed: false, eligibleForReview: scored && !errors.length && !grades.some(g => g.hard.length) && t1! >= 1.5 && t2! >= 1.5,
    reason: "默认切换还需两模式完整覆盖、逐题look_back和真机等待验收，不由单次自动计数决定", missingGrades: missing.length, errors: errors.length, t1, t2 };
}
