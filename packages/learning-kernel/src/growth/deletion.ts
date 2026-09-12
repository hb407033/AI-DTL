import type { ChallengeRun, ClaimEvidenceLink, GrowthRecord, MemoryCandidate, MemoryCommitDecision } from "./types.js";
import type { ScaffoldPointRow, TrendGapRow } from "./scaffold-trend.js";

/** 归属全部来自同一份存储快照；计划器不读取外部状态。 */
export interface DeletionInput {
  subject: { kind: "artifact" | "growth_record"; id: string };
  artifactVersions: readonly { artifactId: string; artifactVersionId: string; contentRef: string }[];
  runs: readonly ChallengeRun[];
  links: readonly ClaimEvidenceLink[];
  records: readonly (GrowthRecord & { requiredTransferLinkIds?: readonly string[] })[];
  candidates: readonly MemoryCandidate[];
  points: readonly ScaffoldPointRow[];
  assents: readonly { assentId: string; candidateId: string }[];
  reviews: readonly { reviewId: string; candidateId: string }[];
  decisions: readonly (MemoryCommitDecision & { sourceLinkIds?: readonly string[]; sourceRunIds?: readonly string[] })[];
  hypotheses: readonly { hypothesisKey: string }[];
  events: readonly { sessionId: string; eventId: string; serverSeq: number; artifactVersionId: string | null }[];
  snapshots: readonly { sessionId: string; snapshotSeq: number }[];
  proposals: readonly { sessionId: string; proposalId: string; runId: string | null }[];
  now: number;
}

export interface DeletionActions {
  redactEventIds: string[];
  redactOutboundKeys: { sessionId: string; eventId: string }[];
  redactSnapshotKeys: { sessionId: string; snapshotSeq: number }[];
  redactProposalIds: string[];
  removeArtifactVersionIds: string[];
  removeContentRefs: string[];
  evidenceRemovedLinkIds: string[];
  invalidatedRecordIds: string[];
  retiredHypothesisKeys: string[];
  removeScaffoldPointIds: string[];
  newTrendGaps: TrendGapRow[];
  voidedAssentIds: string[];
  voidedReviewIds: string[];
  redactedDecisionIds: string[];
  redactedCandidateIds: string[];
  affectedRunIds: string[];
  affectedClaimKeys: string[];
}
export type DeletionPreview = { [K in keyof DeletionActions]: number };
export interface DeletionAuditEntry {
  subject: DeletionInput["subject"];
  at: number;
  counts: DeletionPreview;
  ids: Omit<DeletionActions, "removeContentRefs" | "newTrendGaps"> & { newTrendGapIds: string[] };
}
export interface DeletionPlan extends DeletionActions { audit: DeletionAuditEntry }
const unique = (ids: readonly string[]) => [...new Set(ids)].sort();
const countsOf = (actions: DeletionActions): DeletionPreview => Object.fromEntries(
  Object.entries(actions).map(([key, values]) => [key, values.length]),
) as DeletionPreview;

export function planDeletionCascade(input: DeletionInput): DeletionPlan {
  const artifact = input.subject.kind === "artifact";
  const versions = input.artifactVersions.filter(v => artifact && v.artifactId === input.subject.id);
  const versionIds = new Set(versions.map(v => v.artifactVersionId));
  const runs = input.runs.filter(r => artifact && (r.artifactVersionIds.some(id => versionIds.has(id))
    || input.links.some(l => l.runId === r.runId && l.artifactVersionId !== null && versionIds.has(l.artifactVersionId))
    || input.events.some(e => e.sessionId === r.sessionId && e.serverSeq >= r.firstServerSeq && e.serverSeq <= r.lastServerSeq
      && e.artifactVersionId !== null && versionIds.has(e.artifactVersionId))));
  const runIds = new Set(runs.map(r => r.runId));
  const events = input.events.filter(e => artifact && ((e.artifactVersionId !== null && versionIds.has(e.artifactVersionId))
    || runs.some(r => r.sessionId === e.sessionId && e.serverSeq >= r.firstServerSeq && e.serverSeq <= r.lastServerSeq)));
  const eventIds = new Set(events.map(e => e.eventId));
  const removed = input.links.filter(l => artifact && (runIds.has(l.runId) || eventIds.has(l.eventId)
    || (l.artifactVersionId !== null && versionIds.has(l.artifactVersionId))));
  const removedIds = new Set(removed.map(l => l.linkId));
  const affectedRecords = input.records.filter(r => artifact
    ? r.evidenceLinkIds.some(id => removedIds.has(id)) || r.transferRefs.some(ref => runIds.has(ref.runId))
      || r.trendRef?.windowRunIds.some(id => runIds.has(id))
    : r.recordId === input.subject.id);
  const affectedRecordIds = new Set(affectedRecords.map(r => r.recordId));
  // 重新同意可替换当前记录的引用，但旧决策仍指向当时的作品，不能沿当前候选反查而遗漏历史文本。
  const historicalDecisions = new Set(input.decisions.filter(d => artifact &&
    (d.sourceLinkIds?.some(id => removedIds.has(id)) || d.sourceRunIds?.some(id => runIds.has(id)))).map(d => d.decisionId));
  const candidateIds = new Set(input.decisions.filter(d => affectedRecordIds.has(d.outcome.recordId ?? "")
    || affectedRecords.some(r => r.decisionId === d.decisionId)).map(d => d.candidateId));
  for (const c of input.candidates) if (artifact && (c.evidenceLinkIds.some(id => removedIds.has(id))
    || c.transferRefs.some(ref => runIds.has(ref.runId)))) candidateIds.add(c.candidateId);
  const points = input.points.filter(p => runIds.has(p.runId));
  const groups = new Map<string, ScaffoldPointRow[]>();
  for (const p of points) {
    const key = JSON.stringify([p.learnerId, p.goalId, p.probeFamilyId, p.difficultyBandIndex]);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const gaps: TrendGapRow[] = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => {
    const p = rows[0]!;
    return { gapId: `deletion:${encodeURIComponent(input.subject.id)}:${input.now}:${encodeURIComponent(key)}`,
      learnerId: p.learnerId, goalId: p.goalId, probeFamilyId: p.probeFamilyId, difficultyBandIndex: p.difficultyBandIndex,
      removedCount: rows.length, addedSinceCount: 0, removedAt: input.now };
  });
  const sessions = new Set([...runs.map(r => r.sessionId), ...events.map(e => e.sessionId)]);
  const actions: DeletionActions = {
    redactEventIds: unique(events.map(e => e.eventId)),
    // 后续讲解可能复述先前作品；清除同会话衍生展示，原始事件仍仅按作品归属删除。
    redactOutboundKeys: input.events.filter(e => sessions.has(e.sessionId)).map(e => ({ sessionId: e.sessionId, eventId: e.eventId })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    // 后续快照仍可能包含前面轮次的证据和教学文本。
    redactSnapshotKeys: input.snapshots.filter(s => sessions.has(s.sessionId)).map(s => ({ ...s })),
    redactProposalIds: unique(input.proposals.filter(p => sessions.has(p.sessionId)).map(p => p.proposalId)),
    removeArtifactVersionIds: unique([...versionIds]), removeContentRefs: unique(versions.map(v => v.contentRef)),
    evidenceRemovedLinkIds: unique([...removedIds]),
    // 证据集合发生变化后，即使仍有其它支持证据，也必须重新取得同意。
    invalidatedRecordIds: unique([...affectedRecordIds]),
    retiredHypothesisKeys: unique(input.hypotheses.filter(h => removed.some(l => l.hypothesisKey === h.hypothesisKey)
      && !input.links.some(l => l.hypothesisKey === h.hypothesisKey && l.status === "active" && !removedIds.has(l.linkId))).map(h => h.hypothesisKey)),
    removeScaffoldPointIds: unique(points.map(p => p.pointId)), newTrendGaps: gaps,
    voidedAssentIds: unique(input.assents.filter(a => candidateIds.has(a.candidateId) || historicalDecisions.has(a.assentId)).map(a => a.assentId)),
    voidedReviewIds: unique(input.reviews.filter(r => candidateIds.has(r.candidateId)).map(r => r.reviewId)),
    redactedDecisionIds: unique(input.decisions.filter(d => candidateIds.has(d.candidateId) || historicalDecisions.has(d.decisionId)).map(d => d.decisionId)),
    redactedCandidateIds: unique([...candidateIds]), affectedRunIds: unique([...runIds]),
    affectedClaimKeys: unique([...removed.map(l => l.claimKey), ...affectedRecords.map(r => r.claimKey)].filter(Boolean)),
  };
  const { removeContentRefs: _refs, newTrendGaps: _gaps, ...ids } = actions;
  return { ...actions, audit: { subject: { ...input.subject }, at: input.now, counts: countsOf(actions),
    ids: { ...ids, newTrendGapIds: gaps.map(g => g.gapId) } } };
}

export function previewDeletion(input: DeletionInput): DeletionPreview { return planDeletionCascade(input).audit.counts; }
