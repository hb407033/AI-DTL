// packages/learning-kernel/src/challenge.ts
// 学科无关的挑战与证据结构（设计稿 10.1、9.1）。学科内容全部由插件填入，这里只定义形状。
import type { CanvasAction, EvidenceEvent } from "@ai-scholar/session-contracts";
import type { InterventionBudget } from "./hint-budget.js";

export interface HintContent {
  spokenResponse: string;
  learnerTask: string;
  canvasActions: CanvasAction[];
}

export interface LearningChallenge {
  challengeId: string;
  discipline: string;
  curriculumAnchor: string;
  probeFamilyId: string;
  difficultyBand: string;
  developmentGoal: string;
  learnerPrompt: string;
  availableTools: string[];
  independencePolicy: { initialWindowMs: number; hardCapMs: number };
  interventionBudget: InterventionBudget;
  expectedEvidence: string[];
  hintLadder: Record<1 | 2 | 3 | 4, HintContent>;
  explainBackSpec: { prompt: string; requiredElements: string[] };
  transferSpec: { description: string; passCriteria: string };
}

export interface ChallengeInput {
  curriculumAnchor: string;
  probeFamilyId?: string | undefined;
  difficultyBand?: string | undefined;
}

export interface HypothesisSupport {
  hypothesisId: string;
  direction: "supports" | "weakens";
}

/** 本轮证据：由插件对已确认事件赋予有限的学科含义 */
export interface DisciplineEvidence {
  evidenceId: string;
  eventId: string;
  kind: string;
  summary: string;
  hypothesisSupport: HypothesisSupport[];
}

export interface DiscriminatingProbe {
  id: string;
  question: string;
  /** 不同回答类别 → 对各假设的支持/反驳 */
  outcomes: Record<string, HypothesisSupport[]>;
}

export interface ExplainBackVerdict {
  passed: boolean;
  missing: string[];
}

export type { EvidenceEvent };
