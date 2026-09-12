import type { LearningDatabase } from "../database.js";
import type { ChallengeRun, ClaimEvidenceLink, GrowthRecord, MemoryCandidate, MemoryCommitDecision } from "../types.js";
import type { ScaffoldPointRow, TrendGapRow } from "../scaffold-trend.js";

type Row = Record<string, string | number | null>;
const json = JSON.stringify;
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const writer = "GrowthLedgerService";

/** 写方法仅供账本服务持有；所有业务授权在服务层，存储不对外导出。 */
export class GrowthSqliteStore {
  constructor(private readonly db: LearningDatabase) {}

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = work(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private put(table: string, row: Row, key: string): void {
    const names = Object.keys(row);
    this.db.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})
      ON CONFLICT(${key}) DO UPDATE SET ${names.filter(name => name !== key).map(name => `${name}=excluded.${name}`).join(",")}`)
      .run(...Object.values(row));
  }

  saveRun(learnerId: string, run: ChallengeRun): void {
    const previous = this.db.prepare("SELECT * FROM challenge_runs WHERE run_id=?").get(run.runId);
    if (previous && (previous.learner_id !== learnerId || previous.session_id !== run.sessionId)) throw new Error("runIdentityConflict");
    this.db.prepare("INSERT OR IGNORE INTO learners VALUES (?,?)").run(learnerId, run.startedAt);
    this.put("challenge_runs", {
      run_id: run.runId, learner_id: learnerId, session_id: run.sessionId, challenge_id: run.challengeId,
      discipline: run.discipline, probe_family_id: run.probeFamilyId, difficulty_band: run.difficultyBand,
      difficulty_band_index: run.difficultyBandIndex, development_goal_id: run.developmentGoalId,
      child_facing_goal_phrase: run.childFacingGoalPhrase, surface_context_label: run.surfaceContextLabel,
      claim_key: run.claimKey, surface_context_key: run.surfaceContextKey, started_at: run.startedAt,
      ended_at: run.endedAt ?? (previous?.ended_at as number | null | undefined) ?? null, first_server_seq: run.firstServerSeq, last_server_seq: Math.max(run.lastServerSeq, Number(previous?.last_server_seq ?? 0)),
      max_hint_level_used: Math.max(run.maxHintLevelUsed, Number(previous?.max_hint_level_used ?? 0)), escalation_count: Math.max(run.escalationCount, Number(previous?.escalation_count ?? 0)), probes_issued: Math.max(run.probesIssued, Number(previous?.probes_issued ?? 0)),
      transfer_outcome: run.transferOutcome, transfer_hint_level_used: run.transferHintLevelUsed,
      transfer_tainted: +(run.transferTainted || !!previous?.transfer_tainted), reconstructed: +(run.reconstructed || !!previous?.reconstructed), assisted_round: +(run.assistedRound || !!previous?.assisted_round),
      self_correction_observed: +run.selfCorrectionObserved, time_to_first_productive_action_ms: run.timeToFirstProductiveActionMs,
      probe_resolved: +run.probeResolved, discriminates_json: json(run.discriminates),
    }, "run_id");
    for (const id of run.artifactVersionIds) this.db.prepare("INSERT OR IGNORE INTO run_artifacts VALUES (?,?)").run(run.runId, id);
  }

  runs(learnerId: string): ChallengeRun[] {
    return this.db.prepare("SELECT * FROM challenge_runs WHERE learner_id=? ORDER BY started_at,run_id").all(learnerId).map(row => ({
      runId: String(row.run_id), sessionId: String(row.session_id), challengeId: String(row.challenge_id),
      discipline: String(row.discipline), probeFamilyId: String(row.probe_family_id), difficultyBand: String(row.difficulty_band),
      difficultyBandIndex: Number(row.difficulty_band_index), developmentGoalId: String(row.development_goal_id),
      childFacingGoalPhrase: String(row.child_facing_goal_phrase), surfaceContextLabel: String(row.surface_context_label),
      claimKey: String(row.claim_key), surfaceContextKey: String(row.surface_context_key), startedAt: Number(row.started_at),
      endedAt: row.ended_at === null ? null : Number(row.ended_at), firstServerSeq: Number(row.first_server_seq), lastServerSeq: Number(row.last_server_seq),
      maxHintLevelUsed: Number(row.max_hint_level_used), escalationCount: Number(row.escalation_count), probesIssued: Number(row.probes_issued),
      transferOutcome: row.transfer_outcome as ChallengeRun["transferOutcome"], transferHintLevelUsed: Number(row.transfer_hint_level_used),
      transferTainted: !!row.transfer_tainted, reconstructed: !!row.reconstructed, assistedRound: !!row.assisted_round,
      selfCorrectionObserved: !!row.self_correction_observed, timeToFirstProductiveActionMs: row.time_to_first_productive_action_ms === null ? null : Number(row.time_to_first_productive_action_ms),
      probeResolved: !!row.probe_resolved, discriminates: parse<string[]>(row.discriminates_json),
      artifactVersionIds: this.db.prepare("SELECT artifact_version_id FROM run_artifacts WHERE run_id=?").all(row.run_id!).map(v => String(v.artifact_version_id)),
    }));
  }

  saveLink(link: ClaimEvidenceLink): void {
    if (this.db.prepare("SELECT 1 FROM claim_evidence_links WHERE link_id=?").get(link.linkId)) return;
    this.put("claim_evidence_links", { link_id: link.linkId, learner_id: link.learnerId, run_id: link.runId,
      event_id: link.eventId, evidence_id: link.evidenceId, claim_key: link.claimKey, hypothesis_key: link.hypothesisKey,
      direction: link.direction, surface_context_key: link.surfaceContextKey, from_probe_id: link.fromProbeId,
      self_correction: +link.selfCorrection, artifact_version_id: link.artifactVersionId, observed_at: link.observedAt,
      status: link.status, written_by: writer }, "link_id");
  }

  links(learnerId: string): ClaimEvidenceLink[] {
    return this.db.prepare("SELECT * FROM claim_evidence_links WHERE learner_id=? ORDER BY observed_at,link_id").all(learnerId).map(row => ({
      linkId: String(row.link_id), learnerId, runId: String(row.run_id), eventId: String(row.event_id), evidenceId: String(row.evidence_id),
      claimKey: String(row.claim_key), hypothesisKey: row.hypothesis_key === null ? null : String(row.hypothesis_key),
      direction: row.direction as ClaimEvidenceLink["direction"], surfaceContextKey: String(row.surface_context_key),
      fromProbeId: row.from_probe_id === null ? null : String(row.from_probe_id), selfCorrection: !!row.self_correction,
      artifactVersionId: row.artifact_version_id === null ? null : String(row.artifact_version_id),
      observedAt: Number(row.observed_at), status: row.status as ClaimEvidenceLink["status"],
    }));
  }

  saveCandidate(c: MemoryCandidate): void {
    this.put("memory_candidates", { candidate_id: c.candidateId, learner_id: c.learnerId, tier: c.tier, claim_key: c.claimKey,
      target_object_id: c.targetObject.id, target_object_label: c.targetObject.label, scope_probe_family_id: c.scope.probeFamilyId,
      scope_band_index: c.scope.difficultyBandIndex, scope_surfaces_json: json(c.scope.surfaceContextKeys), counts_json: json(c.counts),
      evidence_link_ids_json: json(c.evidenceLinkIds), hypothesis_keys_json: json(c.hypothesisKeys), transfer_refs_json: json(c.transferRefs),
      max_hint_level_at_achievement: c.maxHintLevelUsedAtAchievement, next_verification_json: json(c.nextVerification),
      child_facing_text: c.childFacingText, evidence_summary_text: c.evidenceSummaryText, proposed_by: c.proposedBy,
      preview_nonce: c.previewNonce, shown_at: c.shownAt, status: c.status, created_at: c.createdAt, written_by: writer }, "candidate_id");
  }

  candidates(learnerId: string): MemoryCandidate[] {
    return this.db.prepare("SELECT * FROM memory_candidates WHERE learner_id=? ORDER BY created_at,candidate_id").all(learnerId).map(row => ({
      candidateId: String(row.candidate_id), learnerId, tier: Number(row.tier) as 2 | 3, claimKey: String(row.claim_key),
      targetObject: { id: String(row.target_object_id), label: String(row.target_object_label) },
      scope: { probeFamilyId: String(row.scope_probe_family_id), difficultyBandIndex: Number(row.scope_band_index), surfaceContextKeys: parse<string[]>(row.scope_surfaces_json) },
      counts: parse(row.counts_json), evidenceLinkIds: parse(row.evidence_link_ids_json), hypothesisKeys: parse(row.hypothesis_keys_json),
      transferRefs: parse(row.transfer_refs_json), maxHintLevelUsedAtAchievement: Number(row.max_hint_level_at_achievement),
      nextVerification: parse(row.next_verification_json), childFacingText: String(row.child_facing_text), evidenceSummaryText: String(row.evidence_summary_text),
      contestTarget: { kind: "candidate", id: String(row.candidate_id) }, proposedBy: row.proposed_by as MemoryCandidate["proposedBy"],
      previewNonce: row.preview_nonce === null ? null : String(row.preview_nonce), shownAt: row.shown_at === null ? null : Number(row.shown_at),
      status: row.status as MemoryCandidate["status"], createdAt: Number(row.created_at),
    }));
  }

  saveDecision(d: MemoryCommitDecision, c: MemoryCandidate): void {
    this.put("memory_decisions", { decision_id: d.decisionId, learner_id: d.learnerId, candidate_id: d.candidateId, tier: d.tier,
      source_link_ids_json: json(c.evidenceLinkIds), source_run_ids_json: json(c.transferRefs.map(ref => ref.runId)),
      phase: d.phase, ruleset_id: d.rulesetId, rule_results_json: json(d.ruleResults), failures_json: json(d.failures), child_choice: d.childChoice,
      parent_review_id: d.parentReviewId, assisted_round: +d.assistedRound, committed: +d.outcome.committed, record_id: d.outcome.recordId,
      reason_code: d.outcome.reasonCode, child_facing_text: c.childFacingText, evidence_summary_text: c.evidenceSummaryText,
      decided_by: d.decidedBy, decided_at: d.decidedAt }, "decision_id");
  }

  saveRecord(r: GrowthRecord, run: ChallengeRun): void {
    this.put("growth_records", { record_id: r.recordId, learner_id: r.learnerId, tier: r.tier, claim_key: r.claimKey,
      discipline: run.discipline, probe_family_id: r.scope.probeFamilyId, development_goal_id: r.targetObject.id,
      target_object_id: r.targetObject.id, target_object_label: r.targetObject.label, scope_band_index: r.scope.difficultyBandIndex,
      scope_surfaces_json: json(r.scope.surfaceContextKeys), child_facing_text: r.childFacingText, evidence_summary_text: r.evidenceSummaryText,
      status: r.status, suppressed_reason: r.suppressedReason, evidence_link_ids_json: json(r.evidenceLinkIds),
      required_transfer_link_ids_json: json(r.evidenceLinkIds), hypothesis_keys_json: json(r.hypothesisKeys),
      c_supporting: r.counts.supportingChallenges, c_refuting: r.counts.refutingChallenges, c_distinct_surfaces: r.counts.distinctSurfaceContexts,
      c_independent_transfers: r.counts.independentTransferSuccesses, c_hinted_successes: r.counts.hintedSuccesses, last_observed_at: r.lastObservedAt,
      transfer_refs_json: json(r.transferRefs), trend_ref_json: r.trendRef === null ? null : json(r.trendRef),
      max_hint_level_at_achievement: r.maxHintLevelUsedAtAchievement, next_verification_json: json(r.nextVerification),
      next_verification_due_at: r.nextVerification.dueAt, expires_at: r.nextVerification.expiresAt,
      decision_id: r.decisionId, committed_at: r.committedAt, retracted_at: null, written_by: writer }, "record_id");
  }

  records(learnerId: string): GrowthRecord[] {
    return this.db.prepare("SELECT * FROM growth_records WHERE learner_id=? ORDER BY committed_at,record_id").all(learnerId).map(row => ({
      recordId: String(row.record_id), learnerId, tier: Number(row.tier) as 2 | 3, claimKey: String(row.claim_key),
      targetObject: { id: String(row.target_object_id), label: String(row.target_object_label) },
      scope: { probeFamilyId: String(row.probe_family_id), difficultyBandIndex: Number(row.scope_band_index), surfaceContextKeys: parse<string[]>(row.scope_surfaces_json) },
      evidenceLinkIds: parse(row.evidence_link_ids_json), hypothesisKeys: parse(row.hypothesis_keys_json),
      counts: { supportingChallenges: Number(row.c_supporting), refutingChallenges: Number(row.c_refuting), distinctSurfaceContexts: Number(row.c_distinct_surfaces), independentTransferSuccesses: Number(row.c_independent_transfers), hintedSuccesses: Number(row.c_hinted_successes) },
      lastObservedAt: Number(row.last_observed_at), status: row.status as GrowthRecord["status"], nextVerification: parse(row.next_verification_json),
      contests: [], transferRefs: parse(row.transfer_refs_json), maxHintLevelUsedAtAchievement: Number(row.max_hint_level_at_achievement),
      childFacingText: String(row.child_facing_text), evidenceSummaryText: String(row.evidence_summary_text),
      trendRef: row.trend_ref_json === null ? null : parse(row.trend_ref_json), decisionId: String(row.decision_id),
      committedAt: Number(row.committed_at), suppressedReason: row.suppressed_reason as GrowthRecord["suppressedReason"],
    }));
  }

  decision(id: string): MemoryCommitDecision | null {
    const row = this.db.prepare("SELECT * FROM memory_decisions WHERE decision_id=?").get(id);
    if (!row) return null;
    return { decisionId: id, learnerId: String(row.learner_id), candidateId: String(row.candidate_id), tier: Number(row.tier) as 2 | 3,
      phase: row.phase as MemoryCommitDecision["phase"], rulesetId: String(row.ruleset_id), ruleResults: parse(row.rule_results_json), failures: parse(row.failures_json),
      childChoice: row.child_choice as MemoryCommitDecision["childChoice"], parentReviewId: row.parent_review_id === null ? null : String(row.parent_review_id),
      assistedRound: !!row.assisted_round, outcome: { committed: !!row.committed, recordId: row.record_id === null ? null : String(row.record_id), reasonCode: row.reason_code === null ? null : String(row.reason_code) },
      decidedBy: "GrowthLedgerService", decidedAt: Number(row.decided_at) };
  }

  saveScaffoldPoint(learnerId: string, run: ChallengeRun): void {
    if (run.endedAt === null) return;
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO scaffold_points VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `point-${run.runId}`, learnerId, run.runId, run.challengeId, "developmentGoal", run.developmentGoalId, run.probeFamilyId,
      run.difficultyBand, run.difficultyBandIndex, run.maxHintLevelUsed, run.escalationCount, run.probesIssued,
      +(run.transferOutcome === "succeeded" && !run.assistedRound && run.transferHintLevelUsed === 0 && !run.transferTainted),
      run.timeToFirstProductiveActionMs, +run.selfCorrectionObserved, +run.assistedRound, run.endedAt, writer);
    if (Number(inserted.changes) > 0) this.db.prepare(`UPDATE trend_gaps SET added_since_count=added_since_count+1
      WHERE learner_id=? AND goal_id=? AND probe_family_id=? AND difficulty_band_index=? AND removed_at<?`)
      .run(learnerId, run.developmentGoalId, run.probeFamilyId, run.difficultyBandIndex, run.endedAt);
  }

  points(learnerId: string): ScaffoldPointRow[] {
    return this.db.prepare("SELECT * FROM scaffold_points WHERE learner_id=? ORDER BY occurred_at,point_id").all(learnerId).map(row => ({
      pointId: String(row.point_id), learnerId, runId: String(row.run_id), challengeId: String(row.challenge_id), goalKind: "developmentGoal",
      goalId: String(row.goal_id), probeFamilyId: String(row.probe_family_id), difficultyBand: String(row.difficulty_band), difficultyBandIndex: Number(row.difficulty_band_index),
      maxHintLevelUsed: Number(row.max_hint_level_used), escalationCount: Number(row.escalation_count), probesIssued: Number(row.probes_issued),
      independentTransferSucceeded: !!row.independent_transfer_succeeded, timeToFirstProductiveActionMs: row.time_to_first_productive_action_ms === null ? null : Number(row.time_to_first_productive_action_ms),
      selfCorrectionObserved: !!row.self_correction_observed, assistedRound: !!row.assisted_round, occurredAt: Number(row.occurred_at),
    }));
  }

  gaps(learnerId: string): TrendGapRow[] {
    return this.db.prepare("SELECT * FROM trend_gaps WHERE learner_id=? ORDER BY removed_at,gap_id").all(learnerId).map(row => ({
      gapId: String(row.gap_id), learnerId, goalId: String(row.goal_id), probeFamilyId: String(row.probe_family_id),
      difficultyBandIndex: Number(row.difficulty_band_index), removedCount: Number(row.removed_count), addedSinceCount: Number(row.added_since_count), removedAt: Number(row.removed_at),
    }));
  }
}
