import { renderChildFacingText, renderEvidenceSummaryText } from "./child-text.js";
import { EXPIRE_INTERVAL_MS, VERIFY_INTERVAL_MS } from "./constants.js";
import { assertDiscreteOnly } from "./discrete-guard.js";
import { summarizeClaim } from "./evidence-fold.js";
import { screenChildFacingText } from "./forbidden-labels.js";
import type { ChallengeRun, ClaimEvidenceLink, MemoryCandidate } from "./types.js";

export interface BridgeCandidate {
  description: string;
  evidenceEventIds: readonly string[];
  hypothesisKeys: readonly string[];
}

export interface CandidateDraftInput {
  learnerId: string;
  candidateId: string;
  run: ChallengeRun;
  links: readonly ClaimEvidenceLink[];
  now: number;
  knownHypothesisKeys: readonly string[];
  forbiddenClaimPatterns: readonly string[];
  bridgeCandidate?: BridgeCandidate | null | undefined;
  /** 仅供账本构造拒绝审计，绝不能将此结果直接展示或提交。 */
  auditOnly?: boolean | undefined;
}

export function foldCapabilityClaim(run: ChallengeRun, links: readonly ClaimEvidenceLink[]): boolean {
  return run.transferOutcome === "succeeded" && run.transferHintLevelUsed === 0 &&
    !run.transferTainted && !run.assistedRound &&
    links.every(link => link.runId === run.runId && link.claimKey === run.claimKey);
}

/** 同一轮只创建一个主张；桥接来源未通过时不偷偷改成另一来源。 */
export function buildCandidateDraft(input: CandidateDraftInput): MemoryCandidate | null {
  const { run, now, bridgeCandidate } = input;
  const links = input.links.filter(link => link.runId === run.runId && link.claimKey === run.claimKey && link.status === "active");
  if (!input.auditOnly && !foldCapabilityClaim(run, links)) return null;
  // 自由句不能可靠地被猜成某项主张；只接受插件登记的精确短语或稳定主张键。
  if (!input.auditOnly && bridgeCandidate && ![run.claimKey, run.childFacingGoalPhrase].includes(bridgeCandidate.description.trim())) return null;
  const hypothesisKeys = [...new Set(bridgeCandidate?.hypothesisKeys ?? [])];
  if (!input.auditOnly && (hypothesisKeys.some(key => !input.knownHypothesisKeys.includes(key)) ||
      (hypothesisKeys.length === 1 && !run.probeResolved))) return null;
  if (!input.auditOnly && bridgeCandidate?.evidenceEventIds.some(id => !links.some(link => link.eventId === id))) return null;
  const counts = summarizeClaim(links, [run]);
  const childFacingText = renderChildFacingText({ ...run, counts });
  const evidenceSummaryText = renderEvidenceSummaryText({ counts, selfCorrectionRuns: run.selfCorrectionObserved ? 1 : 0 });
  if (!input.auditOnly && screenChildFacingText({ childFacingText, evidenceSummaryText, targetObjectLabel: run.childFacingGoalPhrase,
    scopeLabel: run.surfaceContextLabel }, input.forbiddenClaimPatterns).length) return null;
  const candidate: MemoryCandidate = {
    candidateId: input.candidateId, learnerId: input.learnerId, tier: 2, claimKey: run.claimKey,
    targetObject: { id: run.developmentGoalId, label: run.childFacingGoalPhrase },
    scope: { probeFamilyId: run.probeFamilyId, difficultyBandIndex: run.difficultyBandIndex,
      surfaceContextKeys: [...new Set([run.surfaceContextKey, ...links.map(link => link.surfaceContextKey)])] },
    counts, evidenceLinkIds: [...new Set(links.map(link => link.linkId))], hypothesisKeys,
    transferRefs: [{ runId: run.runId, challengeId: run.challengeId, transferHintLevelUsed: 0,
      maxHintLevelUsedInRound: run.maxHintLevelUsed, achievedVia: run.reconstructed ? "afterDemoRebuild" : "independent", occurredAt: now }],
    maxHintLevelUsedAtAchievement: run.maxHintLevelUsed,
    nextVerification: { kind: "sameFamilyNewSurface", probeFamilyId: run.probeFamilyId,
      difficultyBandIndex: run.difficultyBandIndex, minSurfaceContexts: 2,
      dueAt: now + VERIFY_INTERVAL_MS, expiresAt: now + EXPIRE_INTERVAL_MS },
    childFacingText, evidenceSummaryText, contestTarget: { kind: "candidate", id: input.candidateId },
    proposedBy: bridgeCandidate ? "bridge+kernel" : "kernel", previewNonce: null, shownAt: null,
    status: input.auditOnly ? "held" : "awaiting_child", createdAt: now,
  };
  assertDiscreteOnly(candidate);
  return candidate;
}
