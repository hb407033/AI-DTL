// packages/learning-kernel/test/helpers/fake-plugin.ts
// 测试用假插件：不含任何真实学科内容，只满足契约形状；内核测试全部用它，避免内核测试依赖数学插件。
import type { DisciplinePlugin, LearningChallenge } from "../../src/plugin.js";

const challenge: LearningChallenge = {
  challengeId: "c-fake-1", discipline: "fake", curriculumAnchor: "fake/unit-1", probeFamilyId: "fake-family", difficultyBand: "base",
  developmentGoal: "示例目标", developmentGoalId: "goal-fake-1", childFacingGoalPhrase: "把这件事说清楚",
  surfaceContextKey: "fake-surface-a", surfaceContextLabel: "这种样子的题",
  learnerPrompt: "请在画布上表示这个问题。", availableTools: ["label"],
  independencePolicy: { initialWindowMs: 30_000, hardCapMs: 240_000 },
  interventionBudget: { softEscalations: 2, hardEscalations: 4, maxHintLevel: 4 },
  expectedEvidence: ["representation", "answer"],
  hintLadder: {
    1: { spokenResponse: "你现在已经确定了什么？", learnerTask: "说说你确定的部分", canvasActions: [] },
    2: { spokenResponse: "试试更简单的例子？", learnerTask: "换一个更小的数试试", canvasActions: [] },
    3: { spokenResponse: "这是一个空的表示。", learnerTask: "把它填完整", canvasActions: [{ kind: "upsertObject", object: { id: "agent-frame", owner: "agent", kind: "label", props: {} } }] },
    4: { spokenResponse: "我示范一遍。", learnerTask: "现在示范擦掉了，用你自己的方式重做", canvasActions: [{ kind: "upsertObject", object: { id: "agent-demo", owner: "agent", kind: "label", props: {} } }] },
  },
  explainBackSpec: { prompt: "说说为什么这样做成立。", requiredElements: ["why"] },
  transferSpec: { description: "换一个表面不同的情境", passCriteria: "答案正确" },
};

export const fakePlugin: DisciplinePlugin = {
  manifest: {
    id: "fake", displayName: "假插件", version: "0.0.1", semanticObjectKinds: ["label"], thinkingMoves: ["represent"],
    artifactTypes: ["canvas"], curriculumVersions: ["fake/unit-1"],
    difficultyBands: ["lower", "base", "upper"],
    forbiddenClaimPatterns: ["示例贬义说法"],
    hypothesisCatalog: [
      { id: "h1", childFacingGuess: "你可能还没把关系理清楚", parentFacingLabel: "关系表征断点" },
      { id: "h2", childFacingGuess: "你可能算的时候漏了一步", parentFacingLabel: "链条断点" },
    ],
    developmentGoals: [{ id: "goal-fake-1", childFacingGoalPhrase: "把这件事说清楚" }],
  },
  createChallenge: (input) => ({ ...challenge, difficultyBand: input.difficultyBand ?? "base", challengeId: `c-fake-${input.difficultyBand ?? "base"}` }),
  interpretEvent: (challenge, event) => {
    const p = event.payload;
    const base = { evidenceId: `ev-${event.eventId}`, eventId: event.eventId, surfaceContextKey: challenge.surfaceContextKey, selfCorrection: false };
    if (p.type === "STROKE") return [{ ...base, kind: "representation", summary: "画了表示", hypothesisSupport: [] }];
    if (p.type === "ANSWER") return [{ ...base, kind: p.text === "42" ? "answer" : "wrong_answer", summary: p.text, hypothesisSupport: p.text === "42" ? [] : [{ hypothesisId: "h1", direction: "supports" as const }] }];
    if (p.type === "UTTERANCE" || p.type === "EXPLAIN") return [{ ...base, kind: "utterance", summary: p.text, hypothesisSupport: [] }];
    return [];
  },
  isExpectedEvidenceMet: (c, evidence) => c.expectedEvidence.every((k) => evidence.some((e) => e.kind === k)),
  checkExplainBack: (_c, text) => (text.includes("因为") ? { passed: true, missing: [] } : { passed: false, missing: ["why"] }),
  createTransfer: (c) => ({ ...c, challengeId: `${c.challengeId}-transfer`, learnerPrompt: "换一个情境：请回答 43 减 1。", expectedEvidence: ["answer"] }),
  checkTransferAnswer: (_c, text) => text.trim() === "42",
  discriminatingProbes: () => [{
    id: "probe-1", question: "答案会比 10 大还是小？",
    outcomes: {
      larger: [{ hypothesisId: "h1", direction: "supports" }, { hypothesisId: "h2", direction: "weakens" }],
      smaller: [{ hypothesisId: "h1", direction: "weakens" }, { hypothesisId: "h2", direction: "supports" }],
    },
    samples: { larger: ["会比 10 大"], smaller: ["会比 10 小"] },
  }],
  classifyProbeOutcome: (_probe, text) => (/大/.test(text) ? "larger" : /小/.test(text) ? "smaller" : null),
};
