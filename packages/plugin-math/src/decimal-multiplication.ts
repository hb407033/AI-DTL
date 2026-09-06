// packages/plugin-math/src/decimal-multiplication.ts
// 数学心智插件的小数乘法薄切片（设计稿 6.2、6.3、14.1）：2.4 × 0.3 主路径、3.5 × 0.4 迁移、2 × 0.3 低难度带。
// 提示卡内容与家长 Wizard-of-Oz 指南（validation/wizard-of-oz/session-guide.md）保持一致。
// 不是固定题型分支：证据解释按“大小判断 / 意义 / 精确计算”三类证据工作，数字来自挑战对象而非写死。
import type { ChallengeInput, DisciplineEvidence, DisciplinePlugin, DiscriminatingProbe, EvidenceEvent, LearningChallenge } from "@ai-scholar/learning-kernel";

export const MATH_HYPOTHESES = ["representation_gap", "intuition_gap", "strategy_gap", "rigor_chain_gap", "verification_gap"] as const;

interface DecimalProduct { a: number; b: number; product: number; band: string }

const PRODUCTS: Record<string, DecimalProduct> = {
  base: { a: 2.4, b: 0.3, product: 0.72, band: "base" },
  lower: { a: 2, b: 0.3, product: 0.6, band: "lower" },
  transfer: { a: 3.5, b: 0.4, product: 1.4, band: "base" },
};

function fmt(n: number): string { return Number.isInteger(n) ? String(n) : String(n); }

export function parseNumbers(text: string): number[] {
  return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function buildChallenge(p: DecimalProduct, id: string, input: ChallengeInput): LearningChallenge {
  const expr = `${fmt(p.a)} × ${fmt(p.b)}`;
  const tenths = Math.round(p.b * 10);
  return {
    challengeId: id,
    discipline: "math",
    curriculumAnchor: input.curriculumAnchor,
    probeFamilyId: input.probeFamilyId ?? "decimal-times-tenths",
    difficultyBand: p.band,
    developmentGoal: "把小数乘法从规则变成大小直觉、位值意义与可校验的解释",
    learnerPrompt: `${expr}，结果大概是多少？先在画布上画出或说出你的想法。`,
    availableTools: ["tenthsBar", "numberLine", "label", "arrow", "highlight", "areaModel"],
    independencePolicy: { initialWindowMs: 30_000, hardCapMs: 240_000 },
    interventionBudget: { softEscalations: 2, hardEscalations: 4, maxHintLevel: 4 },
    expectedEvidence: ["magnitude_estimate", "tenths_meaning", "exact_answer"],
    hintLadder: {
      1: { spokenResponse: "你现在已经确定了什么？", learnerTask: "说说你已经确定的部分", canvasActions: [] },
      2: { spokenResponse: `${fmt(p.b)} 还能换成什么说法？`, learnerTask: `换一种说法说说 ${fmt(p.b)}`, canvasActions: [] },
      3: { spokenResponse: "这是一个空的十等份长条。", learnerTask: `在长条上标出 ${fmt(p.b)}`, canvasActions: [{ kind: "upsertObject", object: { id: "agent-tenths-bar", owner: "agent", kind: "tenthsBar", props: { segments: 10, filled: 0 } } }] },
      4: { spokenResponse: `我示范一遍 ${fmt(Math.floor(p.a))} × ${fmt(p.b)}：${fmt(p.b)} 是 ${tenths} 个 0.1，所以是 ${fmt(Math.floor(p.a) * p.b)}。`, learnerTask: `示范擦掉了，请你用自己的方式重新做 ${expr}`, canvasActions: [{ kind: "upsertObject", object: { id: "agent-demo", owner: "agent", kind: "areaModel", props: { a: Math.floor(p.a), b: p.b } } }] },
    },
    explainBackSpec: { prompt: `说说为什么 ${expr} 的结果比 ${fmt(p.a)} 小，${fmt(p.b)} 是什么意思？`, requiredElements: ["why_smaller", "tenths_meaning"] },
    transferSpec: { description: "换数字、保持“乘以十分之几”的结构，无提示完成", passCriteria: "精确答案正确" },
  };
}

function productOf(challenge: LearningChallenge): DecimalProduct {
  const nums = parseNumbers(challenge.learnerPrompt);
  const a = nums[0] ?? 0;
  const b = nums[1] ?? 0;
  return { a, b, product: Math.round(a * b * 1000) / 1000, band: challenge.difficultyBand };
}

function hasMagnitudeEvidence(history: DisciplineEvidence[]): boolean {
  return history.some((e) => e.kind === "magnitude_estimate" && e.hypothesisSupport.some((s) => s.hypothesisId === "intuition_gap" && s.direction === "weakens"));
}

function interpretText(challenge: LearningChallenge, event: EvidenceEvent, text: string, history: DisciplineEvidence[]): DisciplineEvidence[] {
  const p = productOf(challenge);
  const base = { evidenceId: `ev-${event.eventId}`, eventId: event.eventId };
  const tenths = Math.round(p.b * 10);
  const meaning = new RegExp(`十分之${["零","一","二","三","四","五","六","七","八","九"][tenths] ?? ""}|${tenths}\\s*个\\s*0\\.1|${tenths}/10`);
  if (meaning.test(text)) return [{ ...base, kind: "tenths_meaning", summary: `把 ${fmt(p.b)} 说成十分之几`, hypothesisSupport: [{ hypothesisId: "representation_gap", direction: "weakens" }] }];

  const smaller = /(比|比较|会|应该)?\s*(小|少|变小|小于)/.test(text) && !/大/.test(text);
  const larger = /(大|变大|大于|多)/.test(text) && !/小/.test(text);
  const nums = parseNumbers(text);
  const answer = nums.find((n) => n !== p.a && n !== p.b);

  if (answer !== undefined && event.payload.type !== "UTTERANCE") {
    if (Math.abs(answer - p.product) < 1e-9) return [{ ...base, kind: "exact_answer", summary: `算出 ${answer}`, hypothesisSupport: [{ hypothesisId: "rigor_chain_gap", direction: "weakens" }] }];
    // 错误答案的差异诊断：已知直觉正确 → 更支持严谨链条断点；否则两个候选并存
    const support = hasMagnitudeEvidence(history)
      ? [{ hypothesisId: "rigor_chain_gap" as const, direction: "supports" as const }]
      : [{ hypothesisId: "intuition_gap" as const, direction: "supports" as const }, { hypothesisId: "rigor_chain_gap" as const, direction: "supports" as const }];
    return [{ ...base, kind: "wrong_answer", summary: `算出 ${answer}`, hypothesisSupport: support }];
  }
  if (smaller) return [{ ...base, kind: "magnitude_estimate", summary: "判断结果会变小", hypothesisSupport: [{ hypothesisId: "intuition_gap", direction: "weakens" }] }];
  if (larger) return [{ ...base, kind: "magnitude_estimate", summary: "判断结果会变大", hypothesisSupport: [{ hypothesisId: "intuition_gap", direction: "supports" }] }];
  if (answer !== undefined) return [{ ...base, kind: Math.abs(answer - p.product) < 1e-9 ? "exact_answer" : "estimate", summary: `提到 ${answer}`, hypothesisSupport: [] }];
  return [{ ...base, kind: "utterance", summary: text.slice(0, 40), hypothesisSupport: [] }];
}

export const mathPlugin: DisciplinePlugin = {
  manifest: {
    id: "math",
    displayName: "数学心智插件",
    version: "0.1.0",
    semanticObjectKinds: ["tenthsBar", "numberLine", "label", "arrow", "highlight", "areaModel"],
    thinkingMoves: ["conjecture", "model", "experiment", "argue", "verify", "transfer"],
    artifactTypes: ["canvas", "explainBack"],
    curriculumVersions: ["人教版五上/小数乘法"],
  },
  createChallenge(input) {
    const band = input.difficultyBand === "lower" ? "lower" : "base";
    return buildChallenge(PRODUCTS[band] ?? PRODUCTS.base!, `math-decimal-${band}`, input);
  },
  interpretEvent(challenge, event, history) {
    const p = event.payload;
    if (p.type === "STROKE") return [{ evidenceId: `ev-${event.eventId}`, eventId: event.eventId, kind: "representation_attempt", summary: "画了表示", hypothesisSupport: [] }];
    if (p.type === "UTTERANCE" || p.type === "ANSWER" || p.type === "EXPLAIN") return interpretText(challenge, event, p.text, history);
    return [];
  },
  isExpectedEvidenceMet(challenge, evidence) {
    return challenge.expectedEvidence.every((k) => evidence.some((e) => e.kind === k && (k !== "magnitude_estimate" || e.hypothesisSupport.some((s) => s.direction === "weakens"))));
  },
  checkExplainBack(challenge, text) {
    const p = productOf(challenge);
    const missing: string[] = [];
    if (!/(小|少|变小|小于)/.test(text) || !/(因为|所以|才|只剩|只有)/.test(text)) missing.push("why_smaller");
    const tenths = Math.round(p.b * 10);
    if (!new RegExp(`十分之|${tenths}\\s*个\\s*0\\.1|0\\.1|位值`).test(text)) missing.push("tenths_meaning");
    return { passed: missing.length === 0, missing };
  },
  createTransfer(challenge) {
    const t = buildChallenge(PRODUCTS.transfer!, `${challenge.challengeId}-transfer`, { curriculumAnchor: challenge.curriculumAnchor, probeFamilyId: challenge.probeFamilyId });
    return { ...t, learnerPrompt: `换一个：${fmt(PRODUCTS.transfer!.a)} × ${fmt(PRODUCTS.transfer!.b)} 是多少？这次不给提示，直接说答案和你的想法。`, expectedEvidence: ["exact_answer"] };
  },
  checkTransferAnswer(transfer, text) {
    const p = productOf(transfer);
    return parseNumbers(text).some((n) => n !== p.a && n !== p.b && Math.abs(n - p.product) < 1e-9);
  },
  discriminatingProbes(challenge): DiscriminatingProbe[] {
    const p = productOf(challenge);
    return [
      { id: "magnitude-first", question: `算之前先说：结果会比 ${fmt(p.a)} 大还是小？`, outcomes: {
        smaller: [{ hypothesisId: "intuition_gap", direction: "weakens" }, { hypothesisId: "rigor_chain_gap", direction: "supports" }],
        larger: [{ hypothesisId: "intuition_gap", direction: "supports" }, { hypothesisId: "rigor_chain_gap", direction: "weakens" }],
      } },
      { id: "self-check", question: "你能自己检查一下这个结果吗？", outcomes: {
        selfCorrects: [{ hypothesisId: "verification_gap", direction: "weakens" }, { hypothesisId: "rigor_chain_gap", direction: "supports" }],
        noCheck: [{ hypothesisId: "verification_gap", direction: "supports" }, { hypothesisId: "rigor_chain_gap", direction: "weakens" }],
      } },
      { id: "no-decimal-point", question: `${fmt(Math.round(p.a * 10))} × ${fmt(Math.round(p.b * 10))} 呢？`, outcomes: {
        correct: [{ hypothesisId: "representation_gap", direction: "supports" }, { hypothesisId: "rigor_chain_gap", direction: "weakens" }],
        wrong: [{ hypothesisId: "representation_gap", direction: "weakens" }, { hypothesisId: "rigor_chain_gap", direction: "supports" }],
      } },
    ];
  },
};
