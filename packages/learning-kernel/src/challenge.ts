// packages/learning-kernel/src/challenge.ts
// 学科无关的挑战与证据结构（设计稿 10.1、9.1）。学科内容全部由插件填入，这里只定义形状。
import type { CanvasAction, EvidenceEvent } from "@ai-scholar/session-contracts";
import type { InterventionBudget } from "./hint-budget.js";

export interface HintContent {
  spokenResponse: string;
  learnerTask: string;
  canvasActions: CanvasAction[];
}

/** 活动成长模型里已确认的记录，交给插件生成挑战时参考（只读，不含未同意的候选） */
export interface KnownRecordRef {
  recordId: string;
  claimKey: string;
  developmentGoalId: string;
  probeFamilyId: string;
  difficultyBandIndex: number;
  surfaceContextKeys: readonly string[];
}

/** 到期复习项（规范 9.3「毕业并低频回看」、5.1「到期复习项」） */
export interface DueReview {
  recordId: string;
  claimKey: string;
  developmentGoalId: string;
  probeFamilyId: string;
  surfaceContextKeys: readonly string[];
  dueAt: number;
}

export interface LearningChallenge {
  challengeId: string;
  discipline: string;
  curriculumAnchor: string;
  probeFamilyId: string;
  difficultyBand: string;
  /** 面向家长与 Agent 的目标描述；孩子看到的一律是 childFacingGoalPhrase */
  developmentGoal: string;
  /** 发展目标的稳定 id，跨轮不变，是主张标识的组成部分 */
  developmentGoalId: string;
  /** 发展目标的儿童版说法，例如「说清楚这一步为什么成立」。内核只搬运，不改写 */
  childFacingGoalPhrase: string;
  /** 表面情境键：同一深层结构下的表面变体标识，跨轮可比的最小单位 */
  surfaceContextKey: string;
  /** 表面情境的儿童版说法，例如「换了数字的这种题」 */
  surfaceContextLabel: string;
  /** 本挑战承载的区分性探针（由 requiredProbeId 驱动生成时非空） */
  probeId?: string | undefined;
  /** 本挑战能区分开的候选 id */
  discriminates?: readonly string[] | undefined;
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
  knownRecords?: readonly KnownRecordRef[] | undefined;
  dueReviews?: readonly DueReview[] | undefined;
  /** 要求本挑战承载某个探针；插件据此生成能区分候选的题目 */
  requiredProbeId?: string | undefined;
  competingHypothesisIds?: readonly string[] | undefined;
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
  /** 表面情境键：离散摘要里「不同表面情境数」这一项靠它去重 */
  surfaceContextKey: string;
  /** 这条证据是否来自区分性探针；非探针证据不填 */
  fromProbeId?: string | undefined;
  /** 孩子在没有提示的情况下自己发现不对并改过来 */
  selfCorrection: boolean;
}

export interface DiscriminatingProbe {
  id: string;
  /** 儿童可读，不超过 40 字，最多一个问号 */
  question: string;
  /** 不同回答类别 → 对各假设的支持/反驳 */
  outcomes: Record<string, HypothesisSupport[]>;
  /** 每个回答类别至少给一条样例回答，供契约测试验证 classifyProbeOutcome 归得回去 */
  samples: Record<string, readonly string[]>;
}

export interface ExplainBackVerdict {
  passed: boolean;
  missing: string[];
}

export type { EvidenceEvent };
