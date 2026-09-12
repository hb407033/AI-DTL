// 成长记忆层的形状（设计稿 §2）。这里只有数据，没有行为。
import type { SessionState } from "../session-state.js";

export interface ContestTarget {
  kind: "proposal" | "hypothesis" | "candidate" | "record" | "session";
  id: string;
}

/**
 * 会话状态快照。编排器在「问孩子之前」与「孩子按下按钮那一刻」各现取一次交给账本。
 * 账本没有任何别的途径读到会话状态——否则 assisted_round 这类字段的取值时刻会悄悄错位：
 * 软着陆之后一路走到待确认时它仍应为真，取「开候选那一刻」的值就把门禁从正门绕过去了。
 */
export interface SessionGateSnapshot {
  sessionId: string;
  runId: string;
  takenAt: number;
  state: SessionState;
  /** 粘性口径：本轮曾经为真就一直为真 */
  assistedRound: boolean;
  frozenTargets: readonly ContestTarget[];
  maxHintLevelUsedInRound: number;
  transferHintLevelUsedInRound: number;
  transferTainted: boolean;
  probeResolved: boolean;
  previewNonce: string | null;
}

/** 一轮挑战的记账。run 关闭时落库，是证据链接与脚手架点的共同上下文。 */
export interface ChallengeRun {
  runId: string;
  sessionId: string;
  challengeId: string;
  discipline: string;
  probeFamilyId: string;
  difficultyBand: string;
  /** 记录时就固化，账本此后不再问插件 */
  difficultyBandIndex: number;
  developmentGoalId: string;
  childFacingGoalPhrase: string;
  surfaceContextKey: string;
  surfaceContextLabel: string;
  claimKey: string;
  startedAt: number;
  endedAt: number | null;
  firstServerSeq: number;
  lastServerSeq: number;
  artifactVersionIds: readonly string[];
  maxHintLevelUsed: number;
  escalationCount: number;
  probesIssued: number;
  transferOutcome: "succeeded" | "failed" | "none";
  transferHintLevelUsed: number;
  /** 迁移期间要过提示就置真，绕道评估再拿提示也算 */
  transferTainted: boolean;
  reconstructed: boolean;
  assistedRound: boolean;
  selfCorrectionObserved: boolean;
  timeToFirstProductiveActionMs: number | null;
  probeResolved: boolean;
  discriminates: readonly string[];
}

/**
 * 一条证据在账本里的落点。主张键必填，假设键可空——顺利成功的那条路上根本没有存活的根因假设，
 * 如果冻结和计数都只挂在假设上，这条路就永远算不出计数、也冻结不住。
 */
export interface ClaimEvidenceLink {
  linkId: string;
  learnerId: string;
  runId: string;
  eventId: string;
  evidenceId: string;
  claimKey: string;
  hypothesisKey: string | null;
  direction: "supports" | "weakens";
  surfaceContextKey: string;
  fromProbeId: string | null;
  selfCorrection: boolean;
  artifactVersionId: string | null;
  observedAt: number;
  status: "active" | "evidence_removed";
}

/** 五个离散计数。口径统一，有没有假设都算得出。 */
export interface DiscreteCounts {
  supportingChallenges: number;
  refutingChallenges: number;
  distinctSurfaceContexts: number;
  independentTransferSuccesses: number;
  hintedSuccesses: number;
}

/** 规范 9.4 的六态 */
export type JudgementStatus = "suspected" | "confirmed" | "refuted" | "contested" | "expired" | "evidence_removed";

export interface TransferRef {
  runId: string;
  challengeId: string;
  /** 类型锁死：用过提示的迁移进不来 */
  transferHintLevelUsed: 0;
  maxHintLevelUsedInRound: number;
  achievedVia: "independent" | "afterDemoRebuild";
  occurredAt: number;
}

/** 结构化的「下一次验证条件」；给人读的那句话由渲染函数生成，库里不存自由文本 */
export interface NextVerification {
  kind: "sameFamilyNewSurface" | "trendWindowRefresh";
  probeFamilyId: string;
  difficultyBandIndex: number;
  minSurfaceContexts: number;
  dueAt: number;
  expiresAt: number;
}

export type TrendVerdict = "withdrawing" | "flat" | "rising" | "incomplete" | "insufficient";

export interface GrowthRecord {
  recordId: string;
  learnerId: string;
  tier: 2 | 3;
  claimKey: string;
  targetObject: { id: string; label: string };
  scope: { probeFamilyId: string; difficultyBandIndex: number; surfaceContextKeys: readonly string[] };
  evidenceLinkIds: readonly string[];
  counts: DiscreteCounts;
  lastObservedAt: number;
  status: JudgementStatus;
  nextVerification: NextVerification;
  contests: readonly { contestId: string; at: number; resolvedAt: number | null }[];
  transferRefs: readonly TransferRef[];
  maxHintLevelUsedAtAchievement: number;
  childFacingText: string;
  evidenceSummaryText: string;
  hypothesisKeys: readonly string[];
  trendRef: { windowRunIds: readonly string[]; verdict: TrendVerdict } | null;
  decisionId: string;
  committedAt: number;
  suppressedReason: "deletionRequested" | null;
}

export interface RuleResult { ruleId: string; passed: boolean; detail: string }

export interface MemoryCommitDecision {
  decisionId: string;
  learnerId: string;
  candidateId: string;
  tier: 2 | 3;
  phase: "preflight" | "decide";
  rulesetId: string;
  ruleResults: readonly RuleResult[];
  failures: readonly string[];
  childChoice: "record" | "unsure" | "disagree" | null;
  parentReviewId: string | null;
  assistedRound: boolean;
  outcome: { committed: boolean; recordId: string | null; reasonCode: string | null };
  decidedBy: "GrowthLedgerService";
  decidedAt: number;
}

export type CandidateStatus = "awaiting_parent" | "awaiting_child" | "awaiting_reassent" | "held" |
  "declined_unsure" | "contested" | "committed" | "superseded";

export interface MemoryCandidate {
  candidateId: string;
  learnerId: string;
  tier: 2 | 3;
  claimKey: string;
  targetObject: GrowthRecord["targetObject"];
  scope: GrowthRecord["scope"];
  counts: DiscreteCounts;
  evidenceLinkIds: readonly string[];
  hypothesisKeys: readonly string[];
  transferRefs: readonly TransferRef[];
  maxHintLevelUsedAtAchievement: number;
  nextVerification: NextVerification;
  childFacingText: string;
  evidenceSummaryText: string;
  contestTarget: ContestTarget;
  proposedBy: "bridge" | "kernel" | "bridge+kernel";
  previewNonce: string | null;
  shownAt: number | null;
  status: CandidateStatus;
  createdAt: number;
}
