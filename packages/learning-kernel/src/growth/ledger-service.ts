import { createHash, randomUUID } from "node:crypto";
import type { LearningDatabase } from "./database.js";
import { GrowthSqliteStore } from "./store/growth-sqlite.js";
import { buildCandidateDraft } from "./candidate.js";
import { buildEvidenceLinks } from "./evidence-fold.js";
import { summarizeClaim } from "./evidence-fold.js";
import { analyzeScaffoldTrend } from "./scaffold-trend.js";
import { renderChildFacingText, renderEvidenceSummaryText } from "./child-text.js";
import { screenChildFacingText } from "./forbidden-labels.js";
import { childFacingView, agentFacingView, type HypothesisRow } from "./views.js";
import { canUnfreeze, recomputeHypothesisState } from "./hypothesis.js";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { planDeletionCascade, previewDeletion, type DeletionInput, type DeletionPreview } from "./deletion.js";
import { RETENTION_MS, planRetentionPrune, redactEventPayload, redactSnapshot, redactProposalForStorage } from "./retention.js";
import type { SessionSnapshot, ProposalRecord } from "../store.js";
import { DELETION_SLA_MS } from "./constants.js";
import { decide, evaluateTier1Gate, preflight, type GateInput } from "./gate-rules.js";
import type { AssentInput, BuildCandidateInput, ContestInput, GrowthAssentPort, GrowthChildPort, GrowthParentPort, GrowthSessionPort, RecordAssentInput } from "./ports.js";
import type { GrowthRecord, MemoryCandidate, MemoryCommitDecision, SessionGateSnapshot } from "./types.js";

const idOf = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
export const FIRST_USE_NOTICE = "我会把你画的东西、说的话和做出来的题，存在家里这台电脑上，这样下次我们能接着做。\n\n我还会自己猜‘你可能是在哪一步卡住了’。这些猜想是我用来决定出什么题的，你随时可以看，也可以说‘不是这样’，我就不再用它。\n\n如果我觉得你学会了什么，我会先写成一句话给你看，你说‘记下来’我才会记；你说‘不确定’或‘不是这样’，我就不记。有一种话是关于你好几次的表现的，这种爸爸妈妈会比你先看到，他们同意了我才来问你。\n\n爸爸妈妈能看到你的作品、你做题的过程、我记下来的那些话，还有我对你的猜想。\n\n你随时可以看我记了什么。你可以让我删掉，不过删掉要爸爸妈妈一起决定；在他们决定之前，我先不用那句话了。";

/** 长期记录只能在孩子同意的专用入口中创建。 */
export class GrowthLedgerService {
  readonly #store: GrowthSqliteStore;
  private readonly deletionListeners = new Set<(sessionIds: readonly string[]) => void>();
  private constructor(private readonly db: LearningDatabase, private readonly clock: () => number) {
    this.#store = new GrowthSqliteStore(db);
  }
  static open(input: { db: LearningDatabase; clock: () => number }): GrowthLedgerService {
    return new GrowthLedgerService(input.db, input.clock);
  }
  close(): void { this.db.close(); }
  /** 原笔迹专用端口，绝不交给教学 Agent。服务端从会话选择唯一稳定的画布作品。 */
  drawingPort() {
    const binding = (learnerId: string, sessionId: string) => {
      if (this.sessionDeleted(sessionId) || this.db.prepare("SELECT 1 FROM ledger_audit a JOIN artifacts b ON a.subject_id=b.artifact_id WHERE b.session_id=? AND a.reason_code='artifact_deleted'").get(sessionId)) throw new Error("drawingDeleted");
      const row = this.db.prepare("SELECT a.artifact_id FROM artifacts a WHERE learner_id=? AND session_id=? ORDER BY EXISTS(SELECT 1 FROM artifact_versions v JOIN drawing_blobs b USING(artifact_version_id) WHERE v.artifact_id=a.artifact_id) DESC,created_at,artifact_id LIMIT 1").get(learnerId, sessionId);
      if (!row) throw new Error("drawingNotFound");
      return String(row.artifact_id);
    };
    const latest = (artifactId: string) => this.db.prepare("SELECT v.artifact_id,v.artifact_version_id,v.version_no,b.revision,b.drawing,b.preview FROM artifact_versions v JOIN drawing_blobs b USING(artifact_version_id) WHERE artifact_id=? ORDER BY version_no DESC LIMIT 1").get(artifactId);
    const serialize = (row: NonNullable<ReturnType<typeof latest>>) => ({ artifactId: String(row.artifact_id), artifactVersionId: String(row.artifact_version_id), versionNo: Number(row.version_no), revision: String(row.revision), drawing: Buffer.from(row.drawing as Uint8Array).toString("base64"), preview: Buffer.from(row.preview as Uint8Array).toString("base64") });
    return {
      restore: (learnerId: string, sessionId: string) => { const row = latest(binding(learnerId, sessionId)); return row ? serialize(row) : null; },
      preview: (learnerId: string, artifactId: string) => {
        if (!this.db.prepare("SELECT 1 FROM artifacts WHERE learner_id=? AND artifact_id=?").get(learnerId, artifactId)) return null;
        const row = latest(artifactId); return row ? Buffer.from(row.preview as Uint8Array) : null;
      },
      save: (learnerId: string, sessionId: string, revision: string, drawing: Buffer, preview: Buffer) => this.#store.transaction(() => {
        const artifactId = binding(learnerId, sessionId), versionId = idOf("drawing", artifactId, revision);
        const hash = createHash("sha256").update(`${drawing.length}:${preview.length}:`).update(drawing).update(preview).digest("hex");
        const existing = this.db.prepare("SELECT content_hash,version_no FROM artifact_versions WHERE artifact_version_id=?").get(versionId);
        if (existing && existing.content_hash !== hash) throw new Error("drawingRevisionConflict");
        const versionNo = existing ? Number(existing.version_no) : Number(this.db.prepare("SELECT MAX(version_no) AS n FROM artifact_versions WHERE artifact_id=?").get(artifactId)?.n ?? 0) + 1;
        if (!existing) {
          this.db.prepare("INSERT INTO artifact_versions VALUES (?,?,?,?,?,?,?,?)").run(versionId, artifactId, versionNo, "child_upload", `sqlite-drawing:${versionId}`, hash, this.clock(), "GrowthLedgerService");
          this.db.prepare("INSERT INTO drawing_blobs VALUES (?,?,?,?)").run(versionId, revision, drawing, preview);
        }
        return { artifactId, artifactVersionId: versionId, versionNo, revision };
      }),
    };
  }
  onDeletion(listener: (sessionIds: readonly string[]) => void): () => void { this.deletionListeners.add(listener); return () => this.deletionListeners.delete(listener); }

  sessionPort(): GrowthSessionPort {
    return Object.freeze({
      blockedHypothesisKeys: (learnerId: string, discipline: string) => {
        const suppressed = this.deletionSuppressedClaims(learnerId), links = this.#store.links(learnerId);
        return this.hypotheses(learnerId).filter(row => row.discipline === discipline && (row.stopsDrivingPersonalization || !["suspected", "confirmed"].includes(row.status) || (row.expiresAt !== null && row.expiresAt <= this.clock()) || links.some(link => link.hypothesisKey === row.hypothesisKey && suppressed.has(link.claimKey)))).map(row => row.hypothesisKey);
      },
      activeModel: (learnerId: string, discipline: string) => {
        const claims = new Set(this.#store.runs(learnerId).filter(run => run.discipline === discipline).map(run => run.claimKey));
        return this.#store.records(learnerId).filter(record => claims.has(record.claimKey) && record.status === "confirmed" && record.suppressedReason === null && record.nextVerification.expiresAt > this.clock());
      },
      referencedEventIds: () => new Set(this.db.prepare(`SELECT DISTINCT l.event_id FROM claim_evidence_links l WHERE l.status='active' AND EXISTS
        (SELECT 1 FROM growth_records r, json_each(r.evidence_link_ids_json) j WHERE j.value=l.link_id AND r.status!='evidence_removed' AND r.retracted_at IS NULL)`).all().map(row => String(row.event_id))),
      personalizationInputs: (learnerId: string, discipline: string) => this.hypotheses(learnerId).filter(row => row.discipline === discipline && !row.stopsDrivingPersonalization &&
        !this.#store.links(learnerId).some(link => link.hypothesisKey === row.hypothesisKey && this.deletionSuppressedClaims(learnerId).has(link.claimKey)) &&
        ["suspected", "confirmed"].includes(row.status) && (row.expiresAt === null || row.expiresAt > this.clock())).slice(0, 3),
      dueReviews: (learnerId: string, discipline: string, now: number) => this.sessionPort().activeModel(learnerId, discipline).filter(record => record.nextVerification.dueAt <= now)
        .map(record => ({ recordId: record.recordId, claimKey: record.claimKey, developmentGoalId: record.targetObject.id, probeFamilyId: record.scope.probeFamilyId,
          surfaceContextKeys: record.scope.surfaceContextKeys, dueAt: record.nextVerification.dueAt })),
      ingestRun: (input: Parameters<GrowthSessionPort["ingestRun"]>[0]) => this.#store.transaction(() => {
        if (this.sessionDeleted(input.run.sessionId)) return { linkCount: 0 };
        this.#store.saveRun(input.learnerId, input.run);
        if (input.pluginPolicy) this.db.prepare("UPDATE challenge_runs SET plugin_policy_json=? WHERE run_id=?").run(JSON.stringify(input.pluginPolicy), input.run.runId);
        const { links } = buildEvidenceLinks(input);
        for (const link of links) this.#store.saveLink({ ...link, learnerId: input.learnerId });
        this.refreshHypotheses(input.learnerId, input.run.discipline);
        this.resolveContests(input.learnerId);
        this.#store.saveScaffoldPoint(input.learnerId, input.run);
        this.refreshTrend(input.learnerId, input.run);
        return { linkCount: links.length };
      }),
      ingestArtifactVersion: (input: Parameters<GrowthSessionPort["ingestArtifactVersion"]>[0]) => {
        if (this.sessionDeleted(input.sessionId)) throw new Error("sessionContentDeleted");
        const result = evaluateTier1Gate({ ...input, payload: input.payload as Record<string, unknown> });
        if (!result.ok) throw new Error(result.failures.join(","));
        return this.#store.transaction(() => {
          this.db.prepare("INSERT OR IGNORE INTO artifacts VALUES (?,?,?,?,?)").run(input.artifactId, input.learnerId, input.sessionId, input.discipline, this.clock());
          this.db.prepare("INSERT OR IGNORE INTO artifact_versions VALUES (?,?,?,?,?,?,?,?)").run(input.artifactVersionId, input.artifactId, input.versionNo, input.writer, input.contentRef, input.contentHash, this.clock(), "GrowthLedgerService");
          return { artifactVersionId: input.artifactVersionId };
        });
      },
      buildAndPreflight: (input: BuildCandidateInput) => this.buildAndPreflight(input),
      recordProposalContext: (learnerId: string, proposalId: string, keys: readonly string[]) => {
        const known = new Set(this.hypotheses(learnerId).map(row => row.hypothesisKey));
        for (const key of keys.filter(key => known.has(key))) this.db.prepare("INSERT OR IGNORE INTO proposal_hypotheses VALUES (?,?,?)").run(proposalId, key, this.clock());
      },
      nextCandidateToAsk: (learnerId: string, discipline: string, snapshot: SessionGateSnapshot) => {
        const run = this.#store.runs(learnerId).find(row => row.runId === snapshot.runId);
        if (!run || run.discipline !== discipline) return null;
        const candidates = this.#store.candidates(learnerId).filter(candidate => candidate.claimKey === run.claimKey &&
          ((candidate.tier === 3 && candidate.status === "awaiting_child") || candidate.status === "awaiting_reassent"))
          .sort((a, b) => Number(b.status === "awaiting_reassent") - Number(a.status === "awaiting_reassent"));
        for (let candidate of candidates) {
          if (candidate.status === "awaiting_reassent") {
            if (run.difficultyBandIndex !== candidate.scope.difficultyBandIndex || !candidate.scope.surfaceContextKeys.includes(run.surfaceContextKey)) continue;
            const correction = this.db.prepare("SELECT MAX(voided_at) AS at FROM child_assents WHERE candidate_id=? AND voided_reason='parent_narrowed_scope'").get(candidate.candidateId);
            if (correction?.at == null || run.startedAt <= Number(correction.at)) continue;
            if (candidate.previewNonce) {
              if (!candidate.transferRefs.some(ref => ref.runId === run.runId)) continue;
            } else {
              const rebuilt = buildCandidateDraft({ learnerId, candidateId: candidate.candidateId, run,
                links: this.#store.links(learnerId).filter(link => candidate.scope.surfaceContextKeys.includes(link.surfaceContextKey)),
                now: this.clock(), knownHypothesisKeys: candidate.hypothesisKeys, forbiddenClaimPatterns: [] });
              if (!rebuilt) continue;
              candidate = { ...rebuilt, scope: candidate.scope, status: "awaiting_reassent" };
              this.#store.saveCandidate(candidate);
            }
          }
          const gate = this.gateInput({ learnerId, candidateId: candidate.candidateId, previewNonce: "", choice: "record", eventId: "", answeredAt: snapshot.takenAt, snapshot }, false, snapshot.state);
          const decision = { ...preflight(gate), decisionId: randomUUID() };
          this.#store.saveDecision(decision, candidate);
          if (!decision.failures.length) return candidate;
        }
        return null;
      },
      markPreviewShown: (learnerId: string, candidateId: string, nonce: string, shownAt: number) => {
        const candidate = this.candidate(learnerId, candidateId);
        if (candidate.status !== "awaiting_child" && candidate.status !== "awaiting_reassent") throw new Error("candidateNotAwaitingChild");
        if (candidate.previewNonce && candidate.previewNonce !== nonce) throw new Error("previewNonceAlreadyAssigned");
        this.#store.saveCandidate({ ...candidate, previewNonce: nonce, shownAt: candidate.shownAt ?? shownAt });
      },
      evaluateAssent: (input: AssentInput) => {
        const draft = decide(this.gateInput(input, true, "COMPLETED"));
        return { wouldCommit: draft.outcome.committed, draft };
      },
      contest: (input: ContestInput) => this.contest(input),
      holdCandidate: (learnerId: string, candidateId: string) => {
        const candidate = this.candidate(learnerId, candidateId);
        if (candidate.status !== "committed") this.#store.saveCandidate({ ...candidate, status: "held" });
      },
    });
  }

  assentPort(): GrowthAssentPort { return Object.freeze({ recordAssent: (input: RecordAssentInput) => this.recordAssent(input) }); }
  childPort(): GrowthChildPort {
    return Object.freeze({
      acknowledgeFirstUse: (learnerId: string) => { this.db.prepare("INSERT OR REPLACE INTO first_use_notices VALUES (?,?,?,?)").run(learnerId, 1, idOf(FIRST_USE_NOTICE), this.clock()); },
      firstUseAcknowledged: (learnerId: string) => !!this.db.prepare("SELECT 1 FROM first_use_notices WHERE learner_id=? AND version=1 AND text_hash=?").get(learnerId, idOf(FIRST_USE_NOTICE)),
      records: (learnerId: string) => this.#store.records(learnerId),
      contest: (input: ContestInput) => this.contest(input),
      understanding: (learnerId: string, manifest: Parameters<GrowthChildPort["understanding"]>[1]) => childFacingView({
        events: this.db.prepare(`SELECT e.event_json FROM events e WHERE EXISTS (SELECT 1 FROM artifacts a WHERE a.session_id=e.session_id AND a.learner_id=?) ORDER BY e.received_at,e.server_seq`).all(learnerId)
          .map(row => JSON.parse(String(row.event_json)) as EvidenceEvent),
        records: this.#store.records(learnerId), hypotheses: this.hypotheses(learnerId).map(row => ({ ...row, stopsDrivingPersonalization: this.sessionPort().blockedHypothesisKeys(learnerId, row.discipline).includes(row.hypothesisKey) })), points: this.#store.points(learnerId), manifest,
        artifacts: this.db.prepare("SELECT a.artifact_id,v.version_no,v.created_at FROM artifact_versions v JOIN artifacts a USING(artifact_id) WHERE a.learner_id=?").all(learnerId)
          .map(row => ({ artifactId: String(row.artifact_id), versionNo: Number(row.version_no), at: Number(row.created_at) })),
        deletionRequests: this.db.prepare("SELECT request_id,status,outcome_code FROM deletion_requests WHERE learner_id=? ORDER BY requested_at").all(learnerId)
          .map(row => ({ requestId: String(row.request_id), status: String(row.status), outcomeText: row.outcome_code === null ? null : row.outcome_code === "deleted" ? "已经删除了。" : "内容暂时保留，这条判断仍不会用于安排学习。" })),
        firstUseAcknowledged: this.childPort().firstUseAcknowledged(learnerId),
      }),
      deletionPreview: (learnerId: string, subject: DeletionInput["subject"]) => this.deletionPreview(learnerId, subject),
      requestDeletion: (learnerId: string, subject: DeletionInput["subject"]) => this.requestDeletion(learnerId, subject),
      deletionRequests: (learnerId: string) => this.deletionRequests(learnerId),
      withdrawDeletion: (learnerId: string, requestId: string) => this.withdrawDeletion(learnerId, requestId),
      notifications: (learnerId: string) => this.db.prepare("SELECT * FROM child_notifications WHERE learner_id=? ORDER BY created_at").all(learnerId)
        .map(row => ({ notificationId: String(row.notification_id), text: row.text_key === "deleted" ? "已经按你的要求删除了。" : "爸爸妈妈已经看过了，这条判断仍暂时停用。", read: row.read_at !== null })),
      readNotification: (learnerId: string, notificationId: string) => { this.db.prepare("UPDATE child_notifications SET read_at=? WHERE learner_id=? AND notification_id=?").run(this.clock(), learnerId, notificationId); },
    });
  }
  parentPort(): GrowthParentPort {
    return Object.freeze({ candidates: (learnerId: string) => this.#store.candidates(learnerId),
      pendingReviews: (learnerId: string, manifest: Parameters<GrowthParentPort["pendingReviews"]>[1]) => {
        const allRuns = this.#store.runs(learnerId), links = this.#store.links(learnerId), hypotheses = this.hypotheses(learnerId);
        return this.#store.candidates(learnerId).filter(candidate => candidate.tier === 3 && ["awaiting_parent", "contested"].includes(candidate.status)).map(candidate => {
          const trend = this.parentPort().trends(learnerId).find(row => row.goalId === candidate.targetObject.id && row.probeFamilyId === candidate.scope.probeFamilyId)?.report ?? null;
          const runIds = new Set([...candidate.transferRefs.map(ref => ref.runId), ...(trend?.windowRunIds ?? [])]);
          const runs = allRuns.filter(run => runIds.has(run.runId)).sort((a, b) => a.startedAt - b.startedAt);
          const keys = new Set([...candidate.hypothesisKeys, ...links.filter(link => runIds.has(link.runId)).flatMap(link => link.hypothesisKey ? [link.hypothesisKey] : [])]);
          const sessionIds = new Set(runs.map(run => run.sessionId));
          const artifactLinks = this.db.prepare("SELECT artifact_id,session_id FROM artifacts WHERE learner_id=?").all(learnerId)
            .filter(row => sessionIds.has(String(row.session_id))).map(row => ({ artifactId: String(row.artifact_id), href: `/parent/artifacts/${encodeURIComponent(String(row.artifact_id))}` }));
          const blocked: string[] = [];
          if (candidate.status === "contested" || this.claimContested(learnerId, candidate.claimKey)) blocked.push("孩子已提出异议，需先用新的区分性证据解决异议。");
          if (this.deletionSuppressedClaims(learnerId).has(candidate.claimKey)) blocked.push("相关证据有删除申请，当前判断已停用。");
          if (trend?.verdict === "incomplete") blocked.push("作品删除后，趋势证据尚不完整。");
          return { candidate, trend, runs, artifactLinks, childFacingText: candidate.childFacingText, blocked,
            hypotheses: hypotheses.filter(row => keys.has(row.hypothesisKey)).map(row => ({ ...row,
              parentFacingLabel: manifest.hypothesisCatalog.find(entry => entry.id === row.hypothesisKey)?.parentFacingLabel ?? row.hypothesisKey })) };
        });
      },
      artifactEvidence: (learnerId: string, artifactId: string) => {
        const artifact = this.db.prepare("SELECT session_id FROM artifacts WHERE learner_id=? AND artifact_id=?").get(learnerId, artifactId);
        if (!artifact) return null;
        const sessionId = String(artifact.session_id);
        const previewAvailable = !!this.drawingPort().preview(learnerId, artifactId);
        return { artifactId, sessionId, previewAvailable,
          previewReason: previewAvailable ? "以下预览来自孩子原始笔迹，不含 Agent 图层。" : "未保存可渲染的 PKDrawing 原始内容，无法预览笔迹；以下为实际保存的事件证据与版本元数据。",
          versions: this.db.prepare("SELECT artifact_version_id,version_no,writer,content_ref,content_hash,created_at FROM artifact_versions WHERE artifact_id=? ORDER BY version_no").all(artifactId),
          events: this.db.prepare("SELECT event_json FROM events WHERE session_id=? ORDER BY server_seq").all(sessionId).map(row => JSON.parse(String(row.event_json)) as unknown) };
      },
      records: (learnerId: string) => this.#store.records(learnerId),
      narrowScope: (learnerId: string, recordId: string, scope: { toBandIndex?: number; toSurfaceContextKey?: string }) => this.narrowScope(learnerId, recordId, scope),
      downgrade: (learnerId: string, recordId: string) => {
        const record = this.correctableRecord(learnerId, recordId);
        this.#store.transaction(() => {
          const decision = this.#store.decision(record.decisionId);
          if (decision) this.db.prepare("UPDATE memory_candidates SET status='held' WHERE candidate_id=? AND status='awaiting_reassent'").run(decision.candidateId);
          this.db.prepare("UPDATE growth_records SET status='suspected' WHERE record_id=? AND learner_id=?").run(recordId, learnerId);
          this.db.prepare("INSERT INTO ledger_audit (audit_id,learner_id,occurred_at,actor,reason_code,subject_kind,subject_id,n_records) VALUES (?,?,?,'parent','record_downgraded','growth_record',?,1)").run(randomUUID(), learnerId, this.clock(), recordId);
        });
      },
      retract: (learnerId: string, recordId: string) => {
        const record = this.correctableRecord(learnerId, recordId);
        this.#store.transaction(() => {
          const decision = this.#store.decision(record.decisionId);
          if (decision) this.db.prepare("UPDATE memory_candidates SET status='held' WHERE candidate_id=? AND status='awaiting_reassent'").run(decision.candidateId);
          this.db.prepare("UPDATE growth_records SET status='suspected',retracted_at=? WHERE record_id=? AND learner_id=?").run(this.clock(), recordId, learnerId);
          this.db.prepare("INSERT INTO ledger_audit (audit_id,learner_id,occurred_at,actor,reason_code,subject_kind,subject_id,n_records) VALUES (?,?,?,'parent','record_retracted','growth_record',?,1)").run(randomUUID(), learnerId, this.clock(), recordId);
        });
      },
      exportArchive: (learnerId: string) => ({ learnerId, exportedAt: this.clock(), records: this.#store.records(learnerId), candidates: this.#store.candidates(learnerId),
        runs: this.#store.runs(learnerId), links: this.#store.links(learnerId), hypotheses: this.hypotheses(learnerId), points: this.#store.points(learnerId), gaps: this.#store.gaps(learnerId),
        artifacts: this.db.prepare("SELECT a.*,v.artifact_version_id,v.content_ref,v.content_hash FROM artifacts a LEFT JOIN artifact_versions v USING(artifact_id) WHERE learner_id=?").all(learnerId),
        events: this.db.prepare("SELECT e.event_json FROM events e WHERE EXISTS (SELECT 1 FROM artifacts a WHERE a.session_id=e.session_id AND a.learner_id=?)").all(learnerId).map(row => JSON.parse(String(row.event_json))),
        decisions: this.db.prepare("SELECT * FROM memory_decisions WHERE learner_id=?").all(learnerId), contests: this.db.prepare("SELECT * FROM contests WHERE learner_id=?").all(learnerId),
        deletionRequests: this.deletionRequests(learnerId), audit: this.db.prepare("SELECT * FROM ledger_audit WHERE learner_id=?").all(learnerId) }),
      acknowledgeAlert: (learnerId: string, signalId: string) => { this.db.prepare("UPDATE parent_signals SET acknowledged_at=? WHERE learner_id=? AND signal_id=?").run(this.clock(), learnerId, signalId); },
      agentView: (learnerId: string) => agentFacingView({ hypotheses: this.hypotheses(learnerId), records: this.#store.records(learnerId), points: this.#store.points(learnerId) }),
      review: (learnerId: string, candidateId: string, decision: "approved" | "rejected", parentNote?: string) => {
        const candidate = this.candidate(learnerId, candidateId);
        if (candidate.status === "contested" || this.claimContested(learnerId, candidate.claimKey)) throw new Error("parent.cannotOverrideChildContest");
        if (candidate.tier !== 3 || candidate.status !== "awaiting_parent") throw new Error("parent.candidateNotAwaitingReview");
        const trend = this.parentPort().trends(learnerId).find(row => row.goalId === candidate.targetObject.id && row.probeFamilyId === candidate.scope.probeFamilyId)?.report;
        const links = this.#store.links(learnerId);
        if (decision === "approved" && (this.deletionSuppressedClaims(learnerId).has(candidate.claimKey) || !trend || !["withdrawing", "flat"].includes(trend.verdict) ||
          candidate.evidenceLinkIds.some(id => !links.some(link => link.linkId === id && link.status === "active")))) throw new Error("parent.reviewStale");
        if (parentNote && screenChildFacingText({ childFacingText: parentNote, evidenceSummaryText: "", targetObjectLabel: "", scopeLabel: "" }, []).length) throw new Error("parent.forbiddenLabelInNote");
        const reviewId = randomUUID();
        this.#store.transaction(() => {
          this.db.prepare("INSERT INTO parent_reviews VALUES (?,?,?,NULL,?,?,NULL)").run(reviewId, candidateId, decision, parentNote ?? null, this.clock());
          this.#store.saveCandidate({ ...candidate, status: decision === "approved" ? "awaiting_child" : "held" });
        });
        return { reviewId };
      },
      trends: (learnerId: string) => {
        const points = this.#store.points(learnerId), gaps = this.#store.gaps(learnerId);
        return [...new Set(points.map(point => JSON.stringify([point.goalId, point.probeFamilyId])))].map(key => {
          const [goalId, probeFamilyId] = JSON.parse(key) as [string, string];
          return { goalId, probeFamilyId, report: analyzeScaffoldTrend({ points: points.filter(point => point.goalId === goalId && point.probeFamilyId === probeFamilyId), gaps: gaps.filter(gap => gap.goalId === goalId && gap.probeFamilyId === probeFamilyId) }) };
        });
      },
      alerts: (learnerId: string) => this.db.prepare("SELECT * FROM parent_signals WHERE learner_id=? AND acknowledged_at IS NULL ORDER BY created_at").all(learnerId)
        .map(row => ({ signalId: String(row.signal_id), kind: String(row.kind), subjectId: String(row.subject_id), count: Number(row.count), createdAt: Number(row.created_at) })),
      deletionPreview: (learnerId: string, subject: DeletionInput["subject"]) => this.deletionPreview(learnerId, subject),
      deletionRequests: (learnerId: string) => this.deletionRequests(learnerId),
      resolveDeletion: (learnerId: string, requestId: string, decision: "approved" | "rejected") => this.resolveDeletion(learnerId, requestId, decision),
      executeDeletion: (learnerId: string, subject: DeletionInput["subject"], preview: DeletionPreview) => this.executeDeletion(learnerId, subject, preview),
    });
  }

  private candidate(learnerId: string, candidateId: string): MemoryCandidate {
    const candidate = this.#store.candidates(learnerId).find(value => value.candidateId === candidateId);
    if (!candidate) throw new Error("candidateNotFound");
    return candidate;
  }

  private correctableRecord(learnerId: string, recordId: string): GrowthRecord {
    const record = this.#store.records(learnerId).find(row => row.recordId === recordId);
    if (!record) throw new Error("recordNotFound");
    if (record.status === "contested" || this.claimContested(learnerId, record.claimKey)) throw new Error("parent.cannotCorrectContested");
    if (record.tier === 3) throw new Error("parent.cannotCorrectTrend");
    if (record.status === "evidence_removed") throw new Error("parent.recordEvidenceRemoved");
    return record;
  }

  private narrowScope(learnerId: string, recordId: string, scope: { toBandIndex?: number; toSurfaceContextKey?: string }): { needsReassent: true; candidateId: string } {
    const record = this.correctableRecord(learnerId, recordId);
    if (scope.toBandIndex !== undefined && scope.toBandIndex !== record.scope.difficultyBandIndex) throw new Error("parent.scopeNotSubset");
    if (!scope.toSurfaceContextKey || !record.scope.surfaceContextKeys.includes(scope.toSurfaceContextKey) || record.scope.surfaceContextKeys.length <= 1) throw new Error("parent.scopeNotNarrower");
    const decision = this.#store.decision(record.decisionId);
    if (!decision) throw new Error("decisionNotFound");
    const candidate = this.candidate(learnerId, decision.candidateId);
    const next = { ...candidate.scope, surfaceContextKeys: [scope.toSurfaceContextKey] };
    const run = this.#store.runs(learnerId).find(row => row.surfaceContextKey === scope.toSurfaceContextKey && row.claimKey === candidate.claimKey);
    const text = renderChildFacingText({ childFacingGoalPhrase: candidate.targetObject.label, counts: candidate.counts, surfaceContextLabel: run?.surfaceContextLabel ?? "这类尝试" });
    this.#store.transaction(() => {
      this.#store.saveCandidate({ ...candidate, scope: next, childFacingText: text, transferRefs: [], status: "awaiting_reassent", previewNonce: null, shownAt: null });
      this.db.prepare("UPDATE child_assents SET voided_at=?,voided_reason='parent_narrowed_scope' WHERE candidate_id=? AND voided_at IS NULL").run(this.clock(), candidate.candidateId);
      // 已同意版本不替换成尚未看过的句子；新范围与文案只保存在候选，重新同意时才替换。
      this.db.prepare("UPDATE growth_records SET status='suspected' WHERE record_id=?").run(recordId);
      this.db.prepare("INSERT INTO ledger_audit (audit_id,learner_id,occurred_at,actor,reason_code,subject_kind,subject_id,n_records) VALUES (?,?,?,'parent','record_scope_narrowed','growth_record',?,1)").run(randomUUID(), learnerId, this.clock(), recordId);
    });
    return { needsReassent: true, candidateId: candidate.candidateId };
  }

  private recordDraft(candidate: MemoryCandidate, decisionId: string): GrowthRecord {
    const trend = candidate.tier === 3 ? this.parentPort().trends(candidate.learnerId).find(row => row.goalId === candidate.targetObject.id && row.probeFamilyId === candidate.scope.probeFamilyId)?.report : undefined;
    return { ...candidate, recordId: idOf("record", candidate.candidateId), lastObservedAt: candidate.createdAt,
      status: "confirmed", contests: [], trendRef: trend ? { windowRunIds: candidate.transferRefs.map(ref => ref.runId), verdict: trend.verdict } : null, decisionId, committedAt: this.clock(), suppressedReason: null };
  }

  private buildAndPreflight(input: BuildCandidateInput): ReturnType<GrowthSessionPort["buildAndPreflight"]> {
    const run = this.#store.runs(input.learnerId).find(row => row.runId === input.run.runId);
    if (!run) throw new Error("runNotIngested");
    const candidateId = idOf(input.learnerId, run.runId, run.claimKey);
    const draftInput = { ...input, ...input.plugin, run, candidateId, now: this.clock(), links: this.#store.links(input.learnerId) };
    const validCandidate = buildCandidateDraft(draftInput);
    const candidate = validCandidate ?? buildCandidateDraft({ ...draftInput, auditOnly: true });
    if (!candidate) throw new Error("candidateAuditDraftMissing");
    const existing = this.#store.candidates(input.learnerId).find(row => row.candidateId === candidateId);
    if (existing && existing.status !== "awaiting_child") return { candidate: null, decision: null };
    const gate = this.gateInput({ learnerId: input.learnerId, candidateId, previewNonce: "", choice: "record", eventId: "", answeredAt: input.snapshot.takenAt, snapshot: input.snapshot }, false, input.snapshot.state, candidate);
    gate.sourceRejected = validCandidate === null || input.bridgeCandidateRejected === true;
    gate.forbiddenClaimPatterns = input.plugin.forbiddenClaimPatterns;
    gate.knownHypothesisKeys = input.plugin.knownHypothesisKeys;
    const decision = { ...preflight(gate), decisionId: randomUUID() };
    this.#store.saveDecision(decision, decision.failures.length ? { ...candidate, childFacingText: "", evidenceSummaryText: "" } : candidate);
    if (decision.failures.length) return { candidate: null, decision };
    this.#store.saveCandidate(existing ?? candidate);
    this.db.prepare("UPDATE memory_candidates SET forbidden_patterns_json=?,known_hypothesis_keys_json=? WHERE candidate_id=?")
      .run(JSON.stringify(input.plugin.forbiddenClaimPatterns), JSON.stringify(input.plugin.knownHypothesisKeys), candidateId);
    return { candidate: existing ?? candidate, decision };
  }

  private gateInput(input: AssentInput, transitionAccepted: boolean, stateAfterTransition: RecordAssentInput["stateAfterTransition"], draftCandidate?: MemoryCandidate): GateInput {
    const candidate = draftCandidate ?? this.candidate(input.learnerId, input.candidateId);
    const runs = this.#store.runs(input.learnerId);
    const run = runs.find(row => row.runId === input.snapshot.runId);
    if (!run || (candidate.tier === 2 && !candidate.transferRefs.some(ref => ref.runId === run.runId))) throw new Error("candidateRunMismatch");
    const decisionId = idOf("assent", candidate.candidateId, input.previewNonce);
    const links = this.#store.links(input.learnerId);
    const config = this.db.prepare("SELECT forbidden_patterns_json,known_hypothesis_keys_json FROM memory_candidates WHERE candidate_id=? AND learner_id=?").get(candidate.candidateId, input.learnerId);
    const review = this.db.prepare("SELECT * FROM parent_reviews WHERE candidate_id=? AND voided_at IS NULL ORDER BY reviewed_at DESC LIMIT 1").get(candidate.candidateId);
    const contests = this.db.prepare("SELECT claim_keys_json FROM contests WHERE learner_id=? AND resolved_at IS NULL").all(input.learnerId);
    const decline = this.db.prepare("SELECT * FROM decline_signals WHERE learner_id=? AND claim_key=?").get(input.learnerId, candidate.claimKey);
    const declinedAt = decline?.last_declined_at == null ? null : Number(decline.last_declined_at);
    const sameClaimRuns = runs.filter(row => row.claimKey === candidate.claimKey);
    const oldSurfaces = new Set(sameClaimRuns.filter(row => declinedAt !== null && row.startedAt <= declinedAt).map(row => row.surfaceContextKey));
    return { candidate, record: this.recordDraft(candidate, decisionId), run, snapshot: input.snapshot, callAt: input.answeredAt, clock: this.clock, decisionId,
      firstUseAcknowledged: this.childPort().firstUseAcknowledged(input.learnerId),
      knownHypothesisKeys: config ? JSON.parse(String(config.known_hypothesis_keys_json)) as string[] : [],
      unresolvedContest: contests.some(row => (JSON.parse(String(row.claim_keys_json)) as string[]).includes(candidate.claimKey)),
      frozenLinkIds: this.db.prepare("SELECT link_id FROM contest_frozen_links").all().map(row => String(row.link_id)),
      unfreezeConditionsMet: true,
      claimSuppressed: this.#store.records(input.learnerId).some(row => row.claimKey === candidate.claimKey && row.suppressedReason !== null) || this.deletionSuppressedClaims(input.learnerId).has(candidate.claimKey),
      forbiddenClaimPatterns: config ? JSON.parse(String(config.forbidden_patterns_json)) as string[] : [],
      comparableRuns: runs.filter(row => candidate.transferRefs.some(ref => ref.runId === row.runId)),
      parentReview: review ? { reviewId: String(review.review_id), status: String(review.decision), reviewedAt: Number(review.reviewed_at), claimContestedAtReview: false } : null,
      sourceRejected: !["awaiting_child", "awaiting_reassent"].includes(candidate.status) || candidate.claimKey !== run.claimKey || candidate.evidenceLinkIds.some(id => !links.some(link => link.linkId === id && link.status === "active" && link.claimKey === candidate.claimKey)) ||
        run.assistedRound || run.transferTainted || run.transferHintLevelUsed !== 0,
      assent: { previewNonce: input.previewNonce, answeredAt: input.answeredAt, choice: input.choice }, transitionAccepted, stateAfterTransition,
      priorDecline: declinedAt === null ? null : { declinedAt, newRunCount: sameClaimRuns.filter(row => row.startedAt > declinedAt).length,
        hasNewSurfaceEvidence: links.some(link => link.claimKey === candidate.claimKey && link.status === "active" && link.observedAt > declinedAt && !oldSurfaces.has(link.surfaceContextKey)) },
    };
  }

  private recordAssent(input: RecordAssentInput): MemoryCommitDecision {
    return this.#store.transaction(() => {
      const id = idOf("assent", input.candidateId, input.previewNonce);
      const previous = this.#store.decision(id);
      if (previous && previous.learnerId === input.learnerId) return previous;
      const gate = this.gateInput(input, input.transitionAccepted, input.stateAfterTransition);
      const decision = decide(gate);
      if (input.snapshot.state !== "MEMORY_PENDING") return decision;
      const candidate = gate.candidate;
      if (!candidate.previewNonce || candidate.previewNonce !== input.previewNonce) return decision;
      this.db.prepare("INSERT INTO child_assents VALUES (?,?,?,?,?,?,?,NULL,NULL)").run(id, candidate.candidateId, input.previewNonce, input.choice, input.eventId, candidate.shownAt, input.answeredAt);
      this.#store.saveDecision(decision, candidate);
      if (decision.outcome.committed) this.#commitRecord(gate.record, gate.run);
      this.#store.saveCandidate({ ...candidate, status: decision.outcome.committed ? "committed" : input.choice === "unsure" ? "declined_unsure" : input.choice === "disagree" ? "contested" : "held" });
      if (input.choice !== "record") this.db.prepare(`INSERT INTO decline_signals VALUES (?,?,1,?,?,0)
        ON CONFLICT(learner_id,claim_key) DO UPDATE SET consecutive_declines=consecutive_declines+1,last_asked_at=excluded.last_asked_at,last_declined_at=excluded.last_declined_at,runs_since_last_ask=0`)
        .run(input.learnerId, candidate.claimKey, candidate.shownAt, this.clock());
      if (input.choice !== "record") {
        this.db.prepare("UPDATE growth_records SET status='suspected' WHERE learner_id=? AND claim_key=? AND status='confirmed'").run(input.learnerId, candidate.claimKey);
        const keys = new Set(this.#store.links(input.learnerId).filter(link => link.claimKey === candidate.claimKey).flatMap(link => link.hypothesisKey === null ? [] : [link.hypothesisKey]));
        for (const key of keys) this.db.prepare("UPDATE hypotheses SET stops_driving_personalization=1 WHERE learner_id=? AND hypothesis_key=?").run(input.learnerId, key);
        const decline = this.db.prepare("SELECT consecutive_declines FROM decline_signals WHERE learner_id=? AND claim_key=?").get(input.learnerId, candidate.claimKey);
        if (Number(decline?.consecutive_declines) >= 3) this.db.prepare("INSERT OR IGNORE INTO parent_signals VALUES (?,?,?,?,?,?,NULL)").run(idOf("decline", input.learnerId, candidate.claimKey), input.learnerId, "repeatedDecline", candidate.claimKey, Number(decline?.consecutive_declines), this.clock());
      }
      return decision;
    });
  }
  #commitRecord(record: GrowthRecord, run: GateInput["run"]): void { this.#store.saveRecord(record, run); }

  private claimContested(learnerId: string, claimKey: string): boolean {
    return this.db.prepare("SELECT claim_keys_json FROM contests WHERE learner_id=? AND resolved_at IS NULL").all(learnerId)
      .some(row => (JSON.parse(String(row.claim_keys_json)) as string[]).includes(claimKey));
  }

  private hypotheses(learnerId: string): HypothesisRow[] {
    return this.db.prepare("SELECT * FROM hypotheses WHERE learner_id=? ORDER BY hypothesis_key").all(learnerId).map(row => ({
      hypothesisKey: String(row.hypothesis_key), discipline: String(row.discipline), status: row.status as HypothesisRow["status"],
      counts: { supportingChallenges: Number(row.c_supporting), refutingChallenges: Number(row.c_refuting), distinctSurfaceContexts: Number(row.c_distinct_surfaces),
        independentTransferSuccesses: Number(row.c_independent_transfers), hintedSuccesses: Number(row.c_hinted_successes) },
      stopsDrivingPersonalization: !!row.stops_driving_personalization, lastObservedAt: row.last_observed_at === null ? null : Number(row.last_observed_at),
      expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    }));
  }

  private refreshHypotheses(learnerId: string, discipline: string): void {
    const runs = this.#store.runs(learnerId).filter(run => run.discipline === discipline), previous = this.hypotheses(learnerId);
    const runIds = new Set(runs.map(run => run.runId));
    const links = this.#store.links(learnerId).filter(link => runIds.has(link.runId));
    const keys = [...new Set(links.flatMap(link => link.hypothesisKey === null ? [] : [link.hypothesisKey]))];
    for (const key of keys) {
      const old = previous.find(row => row.hypothesisKey === key);
      const state = recomputeHypothesisState({ previous: old?.status ?? "suspected", hypothesisKey: key, links, runs, contests: [], now: this.clock() });
      if (old?.stopsDrivingPersonalization && state.status !== "evidence_removed") { state.status = old.status; state.stopsDrivingPersonalization = true; }
      const c = state.counts;
      this.db.prepare(`INSERT INTO hypotheses VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(learner_id,hypothesis_key) DO UPDATE SET
        status=excluded.status,c_supporting=excluded.c_supporting,c_refuting=excluded.c_refuting,c_distinct_surfaces=excluded.c_distinct_surfaces,
        c_independent_transfers=excluded.c_independent_transfers,c_hinted_successes=excluded.c_hinted_successes,last_observed_at=excluded.last_observed_at,expires_at=excluded.expires_at,stops_driving_personalization=excluded.stops_driving_personalization`)
        .run(key, learnerId, discipline, state.status, +state.stopsDrivingPersonalization, c.supportingChallenges, c.refutingChallenges,
          c.distinctSurfaceContexts, c.independentTransferSuccesses, c.hintedSuccesses, state.lastObservedAt, state.expiresAt);
    }
  }

  private resolveContests(learnerId: string): void {
    const links = this.#store.links(learnerId), runs = this.#store.runs(learnerId);
    for (const row of this.db.prepare("SELECT * FROM contests WHERE learner_id=? AND resolved_at IS NULL").all(learnerId)) {
      const claimKeys = JSON.parse(String(row.claim_keys_json)) as string[];
      const frozenLinkIds = this.db.prepare("SELECT link_id FROM contest_frozen_links WHERE contest_id=?").all(row.contest_id!).map(link => String(link.link_id));
      const relevant = links.filter(link => claimKeys.includes(link.claimKey));
      const hypothesisKeys = [...new Set(relevant.flatMap(link => link.hypothesisKey === null ? [] : [link.hypothesisKey]))];
      const contest = { contestId: String(row.contest_id), claimKeys, hypothesisKeys, frozenLinkIds, contestedAt: Number(row.contested_at), resolvedAt: null };
      if (!canUnfreeze(contest, relevant, runs.filter(run => run.endedAt !== null && run.probeResolved))) continue;
      this.db.prepare("UPDATE contests SET resolved_at=?,resolution='resolved' WHERE contest_id=?").run(this.clock(), row.contest_id!);
      for (const claim of claimKeys) if (!this.claimContested(learnerId, claim)) this.db.prepare("UPDATE growth_records SET status='suspected' WHERE learner_id=? AND claim_key=? AND status='contested'").run(learnerId, claim);
      for (const key of hypothesisKeys) {
        if (relevant.some(link => link.hypothesisKey === key && this.claimContested(learnerId, link.claimKey))) continue;
        this.db.prepare("UPDATE hypotheses SET status='suspected',stops_driving_personalization=0 WHERE learner_id=? AND hypothesis_key=? AND status='contested'").run(learnerId, key);
      }
    }
  }

  private refreshTrend(learnerId: string, run: GateInput["run"]): void {
    const report = this.parentPort().trends(learnerId).find(row => row.goalId === run.developmentGoalId && row.probeFamilyId === run.probeFamilyId)?.report;
    if (!report) return;
    if (report.verdict === "rising" || report.verdict === "incomplete") {
      const kind = report.verdict === "rising" ? "teachingAlert" : "trendIncomplete";
      this.db.prepare("INSERT OR IGNORE INTO parent_signals VALUES (?,?,?,?,?,?,NULL)").run(idOf(kind, learnerId, ...report.windowRunIds), learnerId, kind, run.claimKey, report.windowRunIds.length, this.clock());
      return;
    }
    if (report.verdict !== "withdrawing" && report.verdict !== "flat") return;
    const runs = this.#store.runs(learnerId).filter(row => report.windowRunIds.includes(row.runId));
    if (runs.length !== 3 || runs.some(row => row.assistedRound || row.transferOutcome !== "succeeded" || row.transferTainted || row.transferHintLevelUsed > 0 || row.difficultyBandIndex !== run.difficultyBandIndex)) return;
    const candidateId = idOf("trend", learnerId, run.claimKey, ...report.windowRunIds);
    if (this.#store.candidates(learnerId).some(candidate => candidate.candidateId === candidateId || (candidate.tier === 3 && candidate.claimKey === run.claimKey && ["awaiting_parent", "awaiting_child"].includes(candidate.status)))) return;
    const links = this.#store.links(learnerId).filter(link => runs.some(row => row.runId === link.runId) && link.claimKey === run.claimKey && link.status === "active");
    const policy = JSON.parse(String(this.db.prepare("SELECT plugin_policy_json FROM challenge_runs WHERE run_id=?").get(run.runId)?.plugin_policy_json ?? "{}")) as Partial<BuildCandidateInput["plugin"]>;
    const forbiddenClaimPatterns = policy.forbiddenClaimPatterns ?? [], knownHypothesisKeys = policy.knownHypothesisKeys ?? [];
    const draft = buildCandidateDraft({ learnerId, candidateId, run, links, now: this.clock(), knownHypothesisKeys, forbiddenClaimPatterns });
    if (!draft || this.claimContested(learnerId, run.claimKey)) return;
    const counts = summarizeClaim(links, runs);
    const candidate: MemoryCandidate = { ...draft, tier: 3, status: "awaiting_parent", counts,
      scope: { ...draft.scope, surfaceContextKeys: [...new Set(links.map(link => link.surfaceContextKey))] },
      evidenceLinkIds: links.map(link => link.linkId), transferRefs: runs.map(row => ({ runId: row.runId, challengeId: row.challengeId,
        transferHintLevelUsed: 0, maxHintLevelUsedInRound: row.maxHintLevelUsed, achievedVia: row.reconstructed ? "afterDemoRebuild" : "independent", occurredAt: row.endedAt ?? this.clock() })),
      childFacingText: renderChildFacingText({ ...run, counts }), evidenceSummaryText: renderEvidenceSummaryText({ counts, selfCorrectionRuns: runs.filter(row => row.selfCorrectionObserved).length }),
      maxHintLevelUsedAtAchievement: Math.max(...runs.map(row => row.maxHintLevelUsed)), nextVerification: { ...draft.nextVerification, kind: "trendWindowRefresh" } };
    if (screenChildFacingText({ childFacingText: candidate.childFacingText, evidenceSummaryText: candidate.evidenceSummaryText, targetObjectLabel: candidate.targetObject.label, scopeLabel: run.surfaceContextLabel }, forbiddenClaimPatterns).length) return;
    this.#store.saveCandidate(candidate);
    this.db.prepare("UPDATE memory_candidates SET forbidden_patterns_json=?,known_hypothesis_keys_json=? WHERE candidate_id=?").run(JSON.stringify(forbiddenClaimPatterns), JSON.stringify(knownHypothesisKeys), candidateId);
  }

  private contest(input: ContestInput): { contestId: string; frozenClaimKeys: readonly string[] } {
    const runs = this.#store.runs(input.learnerId);
    const candidates = this.#store.candidates(input.learnerId);
    const records = this.#store.records(input.learnerId);
    const links = this.#store.links(input.learnerId);
    const claims = new Set<string>();
    if (input.target.kind === "candidate") for (const c of candidates.filter(c => c.candidateId === input.target.id)) claims.add(c.claimKey);
    if (input.target.kind === "record") for (const r of records.filter(r => r.recordId === input.target.id)) claims.add(r.claimKey);
    if (input.target.kind === "hypothesis") for (const l of links.filter(l => l.hypothesisKey === input.target.id)) claims.add(l.claimKey);
    if (input.target.kind === "session") for (const r of runs.filter(r => r.sessionId === input.target.id)) claims.add(r.claimKey);
    if (input.target.kind === "proposal") {
      const proposalRuns = this.db.prepare("SELECT run_id FROM proposals WHERE proposal_id=? AND (?='' OR session_id=?)").all(input.target.id, input.sessionId, input.sessionId);
      for (const run of runs.filter(run => proposalRuns.some(row => row.run_id === run.runId))) claims.add(run.claimKey);
    }
    const contestId = idOf("contest", input.learnerId, input.eventId);
    return this.#store.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO contests (contest_id,learner_id,subject_kind,subject_id,session_id,run_id,event_id,claim_keys_json,contested_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(contestId, input.learnerId, input.target.kind, input.target.id, input.sessionId, input.runId, input.eventId, JSON.stringify([...claims]), this.clock());
      for (const link of links.filter(link => claims.has(link.claimKey))) this.db.prepare("INSERT OR IGNORE INTO contest_frozen_links VALUES (?,?)").run(contestId, link.linkId);
      const affectedRuns = new Set(runs.filter(run => claims.has(run.claimKey)).map(run => run.runId));
      for (const point of this.#store.points(input.learnerId).filter(point => affectedRuns.has(point.runId))) this.db.prepare("INSERT OR IGNORE INTO contest_frozen_points VALUES (?,?)").run(contestId, point.pointId);
      for (const c of candidates.filter(c => claims.has(c.claimKey))) this.#store.saveCandidate({ ...c, status: "contested" });
      for (const claim of claims) this.db.prepare("UPDATE growth_records SET status='contested' WHERE learner_id=? AND claim_key=?").run(input.learnerId, claim);
      for (const key of new Set(links.filter(link => claims.has(link.claimKey)).flatMap(link => link.hypothesisKey === null ? [] : [link.hypothesisKey])))
        this.db.prepare("UPDATE hypotheses SET status='contested',stops_driving_personalization=1 WHERE learner_id=? AND hypothesis_key=?").run(input.learnerId, key);
      return { contestId, frozenClaimKeys: [...claims] };
    });
  }

  private deletionInput(learnerId: string, subject: DeletionInput["subject"]): DeletionInput {
    const runs = this.#store.runs(learnerId), records = this.#store.records(learnerId);
    const sessions = new Set(runs.map(run => run.sessionId));
    const targetSession = subject.kind === "artifact" ? this.db.prepare("SELECT session_id FROM artifacts WHERE learner_id=? AND artifact_id=?").get(learnerId, subject.id)?.session_id : undefined;
    // 全会话画布不可按 run 分割。删除其中任一作品时，把共享原画布也纳入同一预览和事务；不改变持久归属。
    const artifactVersions = this.db.prepare("SELECT v.*,a.learner_id,a.session_id FROM artifact_versions v JOIN artifacts a USING(artifact_id) WHERE learner_id=?").all(learnerId)
      .map(row => ({ artifactId: targetSession !== undefined && row.session_id === targetSession && String(row.content_ref).startsWith("sqlite-drawing:") ? subject.id : String(row.artifact_id), artifactVersionId: String(row.artifact_version_id), contentRef: String(row.content_ref) }));
    const decisions = this.db.prepare("SELECT decision_id,source_link_ids_json,source_run_ids_json FROM memory_decisions WHERE learner_id=?").all(learnerId)
      .flatMap(row => { const decision = this.#store.decision(String(row.decision_id)); return decision ? [{ ...decision, sourceLinkIds: JSON.parse(String(row.source_link_ids_json)) as string[], sourceRunIds: JSON.parse(String(row.source_run_ids_json)) as string[] }] : []; });
    const candidates = this.#store.candidates(learnerId), candidateIds = new Set(candidates.map(candidate => candidate.candidateId));
    for (const row of this.db.prepare("SELECT session_id FROM artifacts WHERE learner_id=?").all(learnerId)) sessions.add(String(row.session_id));
    return { subject, artifactVersions, runs, links: this.#store.links(learnerId), records, candidates, decisions,
      points: this.#store.points(learnerId), hypotheses: this.hypotheses(learnerId), now: this.clock(),
      assents: this.db.prepare("SELECT assent_id,candidate_id FROM child_assents").all().filter(row => candidateIds.has(String(row.candidate_id))).map(row => ({ assentId: String(row.assent_id), candidateId: String(row.candidate_id) })),
      reviews: this.db.prepare("SELECT review_id,candidate_id FROM parent_reviews").all().filter(row => candidateIds.has(String(row.candidate_id))).map(row => ({ reviewId: String(row.review_id), candidateId: String(row.candidate_id) })),
      events: this.db.prepare("SELECT session_id,event_id,server_seq,artifact_version_id FROM events").all().filter(row => sessions.has(String(row.session_id)))
        .map(row => ({ sessionId: String(row.session_id), eventId: String(row.event_id), serverSeq: Number(row.server_seq), artifactVersionId: row.artifact_version_id === null ? null : String(row.artifact_version_id) })),
      snapshots: this.db.prepare("SELECT session_id,snapshot_seq FROM snapshots").all().filter(row => sessions.has(String(row.session_id))).map(row => ({ sessionId: String(row.session_id), snapshotSeq: Number(row.snapshot_seq) })),
      proposals: this.db.prepare("SELECT session_id,proposal_id,run_id FROM proposals").all().filter(row => sessions.has(String(row.session_id))).map(row => ({ sessionId: String(row.session_id), proposalId: String(row.proposal_id), runId: row.run_id === null ? null : String(row.run_id) })),
    };
  }

  private requireDeletionSubject(learnerId: string, subject: DeletionInput["subject"]): void {
    const row = subject.kind === "artifact" ? this.db.prepare("SELECT 1 FROM artifacts WHERE learner_id=? AND artifact_id=?").get(learnerId, subject.id)
      : this.db.prepare("SELECT 1 FROM growth_records WHERE learner_id=? AND record_id=?").get(learnerId, subject.id);
    if (!row) throw new Error("subjectNotFound");
  }

  private sessionDeleted(sessionId: string): boolean {
    return !!this.db.prepare("SELECT content_deleted FROM sessions WHERE session_id=?").get(sessionId)?.content_deleted;
  }

  private deletionSuppressedClaims(learnerId: string): Set<string> {
    const claims = new Set<string>();
    for (const row of this.db.prepare("SELECT subject_kind,subject_id FROM deletion_requests WHERE learner_id=? AND status IN ('pending','rejected')").all(learnerId)) {
      const plan = planDeletionCascade(this.deletionInput(learnerId, { kind: row.subject_kind as DeletionInput["subject"]["kind"], id: String(row.subject_id) }));
      for (const claim of plan.affectedClaimKeys) claims.add(claim);
    }
    return claims;
  }

  private deletionPreview(learnerId: string, subject: DeletionInput["subject"]) {
    this.requireDeletionSubject(learnerId, subject);
    const preview = previewDeletion(this.deletionInput(learnerId, subject));
    return { preview, text: `这会移除 ${preview.removeArtifactVersionIds} 个作品版本，并让 ${preview.invalidatedRecordIds} 条记录失效。`, previewComputedAt: this.clock() };
  }

  private requestDeletion(learnerId: string, subject: DeletionInput["subject"]) {
    const { preview, previewComputedAt } = this.deletionPreview(learnerId, subject);
    const existing = this.db.prepare("SELECT request_id FROM deletion_requests WHERE learner_id=? AND subject_kind=? AND subject_id=? AND status='pending'").get(learnerId, subject.kind, subject.id);
    if (existing) return { requestId: String(existing.request_id), preview };
    const requestId = randomUUID();
    const previous = this.db.prepare("SELECT count(*) AS n FROM deletion_requests WHERE learner_id=? AND subject_kind=? AND subject_id=?").get(learnerId, subject.kind, subject.id);
    const plan = planDeletionCascade(this.deletionInput(learnerId, subject));
    this.#store.transaction(() => {
      this.db.prepare(`INSERT INTO deletion_requests (request_id,learner_id,subject_kind,subject_id,requested_by,requested_at,escalated,affected_records,affected_artifact_versions,affected_points,affected_links,preview_computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(requestId, learnerId, subject.kind, subject.id, "child", this.clock(), Number(previous?.n) > 0 ? 1 : 0,
          preview.invalidatedRecordIds, preview.removeArtifactVersionIds, preview.removeScaffoldPointIds, preview.evidenceRemovedLinkIds, previewComputedAt);
      for (const id of plan.invalidatedRecordIds) this.db.prepare("UPDATE growth_records SET suppressed_reason='deletionRequested' WHERE record_id=? AND learner_id=?").run(id, learnerId);
      // 停用由未撤回请求按 claim 动态投影，不能写入无来源标记而导致撤回后永久停用。
    });
    return { requestId, preview };
  }

  private deletionRequests(learnerId: string): ReturnType<GrowthChildPort["deletionRequests"]> {
    return this.db.prepare("SELECT * FROM deletion_requests WHERE learner_id=? ORDER BY escalated DESC,requested_at").all(learnerId).map(row => ({
      requestId: String(row.request_id), status: String(row.status), subjectKind: String(row.subject_kind), subjectId: String(row.subject_id),
      escalated: !!row.escalated, requestedAt: Number(row.requested_at), preview: previewDeletion(this.deletionInput(learnerId, { kind: row.subject_kind as DeletionInput["subject"]["kind"], id: String(row.subject_id) })),
    }));
  }

  private withdrawDeletion(learnerId: string, requestId: string): void {
    const row = this.db.prepare("SELECT * FROM deletion_requests WHERE learner_id=? AND request_id=?").get(learnerId, requestId);
    if (!row || !["pending", "rejected"].includes(String(row.status))) throw new Error("requestNotWithdrawable");
    const subject = { kind: row.subject_kind as DeletionInput["subject"]["kind"], id: String(row.subject_id) };
    this.#store.transaction(() => {
      this.db.prepare("UPDATE deletion_requests SET status='withdrawn',decided_at=?,outcome_code='withdrawn_by_child' WHERE request_id=?").run(this.clock(), requestId);
      const suppressed = this.deletionSuppressedClaims(learnerId);
      for (const record of this.#store.records(learnerId)) if (record.suppressedReason === "deletionRequested" && !suppressed.has(record.claimKey))
        this.db.prepare("UPDATE growth_records SET suppressed_reason=NULL WHERE learner_id=? AND record_id=?").run(learnerId, record.recordId);
    });
  }

  private resolveDeletion(learnerId: string, requestId: string, decision: "approved" | "rejected") {
    const row = this.db.prepare("SELECT * FROM deletion_requests WHERE learner_id=? AND request_id=?").get(learnerId, requestId);
    if (!row) throw new Error("requestNotFound");
    if (row.status !== "pending") return { auditId: row.audit_id === null ? null : String(row.audit_id) };
    const finish = (auditId: string | null) => {
      this.db.prepare("UPDATE deletion_requests SET status=?,decided_at=?,decided_by='parent',outcome_code=?,audit_id=? WHERE request_id=?")
        .run(decision, this.clock(), decision === "approved" ? "deleted" : "kept_parent_declined", auditId, requestId);
      this.db.prepare("INSERT INTO child_notifications VALUES (?,?,?,?,?,?,NULL)").run(randomUUID(), learnerId, "deletionResolved", requestId, decision === "approved" ? "deleted" : "kept_parent_declined", this.clock());
    };
    if (decision === "approved") {
      const subject = { kind: row.subject_kind as DeletionInput["subject"]["kind"], id: String(row.subject_id) };
      const preview = previewDeletion(this.deletionInput(learnerId, subject));
      if (preview.invalidatedRecordIds !== row.affected_records || preview.removeArtifactVersionIds !== row.affected_artifact_versions || preview.removeScaffoldPointIds !== row.affected_points || preview.evidenceRemovedLinkIds !== row.affected_links) throw new Error("parent.deletionPreviewStale");
      return this.executeDeletion(learnerId, subject, preview, finish);
    }
    this.#store.transaction(() => finish(null));
    return { auditId: null };
  }

  private executeDeletion(learnerId: string, subject: DeletionInput["subject"], expected: DeletionPreview, finish?: (auditId: string) => void): { auditId: string } {
    const auditId = idOf("delete", learnerId, subject.kind, subject.id);
    if (this.db.prepare("SELECT 1 FROM ledger_audit WHERE audit_id=?").get(auditId)) { if (finish) this.#store.transaction(() => finish(auditId)); return { auditId }; }
    this.requireDeletionSubject(learnerId, subject);
    const plan = planDeletionCascade(this.deletionInput(learnerId, subject));
    if (JSON.stringify(plan.audit.counts) !== JSON.stringify(expected)) throw new Error("parent.deletionPreviewStale");
    if (plan.removeContentRefs.some(ref => !ref.startsWith("session:") && !ref.startsWith("sqlite-drawing:"))) throw new Error("externalArtifactDeletionNotConfigured");
    const sessions = [...new Set(plan.redactSnapshotKeys.map(key => key.sessionId))];
    this.#store.transaction(() => {
      // 当前运行时也持有原内容。删除后这个会话只读，继续学习须建立新会话。
      for (const sessionId of sessions) {
        const snapshot = this.db.prepare("SELECT snapshot_json FROM snapshots WHERE session_id=? ORDER BY snapshot_seq DESC LIMIT 1").get(sessionId);
        if (snapshot) this.db.prepare("UPDATE sessions SET content_deleted=1,challenge_json=? WHERE session_id=?")
          .run(JSON.stringify(redactSnapshot(JSON.parse(String(snapshot.snapshot_json)) as SessionSnapshot).challenge), sessionId);
      }
      for (const eventId of plan.redactEventIds) {
        const row = this.db.prepare("SELECT event_json FROM events WHERE event_id=?").get(eventId);
        if (row) { const event = JSON.parse(String(row.event_json)) as EvidenceEvent; this.db.prepare("UPDATE events SET event_json=?,redacted=1 WHERE event_id=?").run(JSON.stringify({ ...event, payload: redactEventPayload(event.payload) }), eventId); }
      }
      for (const key of plan.redactOutboundKeys) this.db.prepare("UPDATE outbound SET messages_json='[]',redacted=1 WHERE session_id=? AND event_id=?").run(key.sessionId, key.eventId);
      for (const key of plan.redactSnapshotKeys) {
        const row = this.db.prepare("SELECT snapshot_json FROM snapshots WHERE session_id=? AND snapshot_seq=?").get(key.sessionId, key.snapshotSeq);
        if (row) this.db.prepare("UPDATE snapshots SET snapshot_json=?,redacted=1 WHERE session_id=? AND snapshot_seq=?").run(JSON.stringify(redactSnapshot(JSON.parse(String(row.snapshot_json)) as SessionSnapshot)), key.sessionId, key.snapshotSeq);
      }
      for (const proposalId of plan.redactProposalIds) {
        for (const row of this.db.prepare("SELECT rowid,session_id,proposal_json FROM proposals WHERE proposal_id=?").all(proposalId).filter(row => sessions.includes(String(row.session_id)))) {
          const record = { proposal: JSON.parse(String(row.proposal_json)) } as ProposalRecord;
          this.db.prepare("UPDATE proposals SET proposal_json=?,redacted=1 WHERE rowid=?").run(JSON.stringify(redactProposalForStorage(record).proposal), row.rowid!);
        }
      }
      for (const id of plan.evidenceRemovedLinkIds) this.db.prepare("UPDATE claim_evidence_links SET status='evidence_removed' WHERE link_id=?").run(id);
      for (const id of plan.invalidatedRecordIds) this.db.prepare("UPDATE growth_records SET status='evidence_removed',child_facing_text='',evidence_summary_text='',target_object_label='' WHERE record_id=?").run(id);
      for (const id of plan.redactedCandidateIds) {
        this.db.prepare("UPDATE memory_candidates SET status='held',child_facing_text='',evidence_summary_text='',target_object_label='',preview_nonce=NULL,shown_at=NULL WHERE candidate_id=?").run(id);
        for (const sessionId of this.redactPreviewReferences(id)) if (!sessions.includes(sessionId)) sessions.push(sessionId);
      }
      for (const key of plan.retiredHypothesisKeys) this.db.prepare("UPDATE hypotheses SET status='evidence_removed',stops_driving_personalization=1,c_supporting=0,c_refuting=0,c_distinct_surfaces=0,c_independent_transfers=0,c_hinted_successes=0 WHERE learner_id=? AND hypothesis_key=?").run(learnerId, key);
      for (const id of plan.removeScaffoldPointIds) this.db.prepare("DELETE FROM scaffold_points WHERE point_id=?").run(id);
      for (const gap of plan.newTrendGaps) this.db.prepare("INSERT INTO trend_gaps VALUES (?,?,?,?,?,?,?,?)").run(gap.gapId, gap.learnerId, gap.goalId, gap.probeFamilyId, gap.difficultyBandIndex, gap.removedCount, gap.addedSinceCount, gap.removedAt);
      for (const id of plan.voidedAssentIds) this.db.prepare("UPDATE child_assents SET voided_at=?,voided_reason='evidence_removed' WHERE assent_id=?").run(this.clock(), id);
      for (const id of plan.voidedReviewIds) this.db.prepare("UPDATE parent_reviews SET voided_at=?,parent_note=NULL WHERE review_id=?").run(this.clock(), id);
      for (const id of plan.redactedDecisionIds) this.db.prepare("UPDATE memory_decisions SET child_facing_text='',evidence_summary_text='' WHERE decision_id=?").run(id);
      for (const id of plan.removeArtifactVersionIds) { this.db.prepare("DELETE FROM artifact_versions WHERE artifact_version_id=?").run(id); this.db.prepare("DELETE FROM run_artifacts WHERE artifact_version_id=?").run(id); }
      for (const id of plan.affectedRunIds) this.db.prepare("UPDATE challenge_runs SET child_facing_goal_phrase='',surface_context_label='' WHERE run_id=?").run(id);
      this.recountRecords(learnerId, plan.affectedClaimKeys);
      for (const discipline of new Set(this.#store.runs(learnerId).map(run => run.discipline))) this.refreshHypotheses(learnerId, discipline);
      this.db.prepare(`INSERT INTO ledger_audit (audit_id,learner_id,occurred_at,actor,reason_code,subject_kind,subject_id,n_events,n_outbound,n_snapshots,n_proposals,n_links,n_hypotheses,n_records,n_points,n_assents,n_decisions,retired_record_ids_json,retired_hypothesis_keys_json,voided_assent_ids_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(auditId, learnerId, this.clock(), "parent", subject.kind === "artifact" ? "artifact_deleted" : "record_deleted", subject.kind, subject.id,
          plan.redactEventIds.length, plan.redactOutboundKeys.length, plan.redactSnapshotKeys.length, plan.redactProposalIds.length, plan.evidenceRemovedLinkIds.length,
          plan.retiredHypothesisKeys.length, plan.invalidatedRecordIds.length, plan.removeScaffoldPointIds.length, plan.voidedAssentIds.length, plan.redactedDecisionIds.length,
          JSON.stringify(plan.invalidatedRecordIds), JSON.stringify(plan.retiredHypothesisKeys), JSON.stringify(plan.voidedAssentIds));
      finish?.(auditId);
    });
    for (const listener of this.deletionListeners) listener(sessions);
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.exec("VACUUM");
    return { auditId };
  }

  private redactPreviewReferences(candidateId: string): string[] {
    const sessions = new Set<string>();
    for (const row of this.db.prepare("SELECT session_id,event_id,messages_json FROM outbound").all()) {
      const messages = JSON.parse(String(row.messages_json)) as Array<{ candidateId?: string }>;
      const safe = messages.filter(message => message.candidateId !== candidateId);
      if (safe.length !== messages.length) { sessions.add(String(row.session_id)); this.db.prepare("UPDATE outbound SET messages_json=?,redacted=1 WHERE session_id=? AND event_id=?").run(JSON.stringify(safe), row.session_id!, row.event_id!); }
    }
    for (const row of this.db.prepare("SELECT session_id,snapshot_seq,snapshot_json FROM snapshots").all()) {
      const snapshot = JSON.parse(String(row.snapshot_json)) as SessionSnapshot;
      if (snapshot.runtime?.memoryPreview?.candidateId !== candidateId) continue;
      sessions.add(String(row.session_id));
      delete snapshot.runtime.memoryPreview;
      if (snapshot.context.state === "MEMORY_PENDING" || snapshot.context.priorState === "MEMORY_PENDING") snapshot.context = { ...snapshot.context, state: "COMPLETED", priorState: null };
      this.db.prepare("UPDATE snapshots SET snapshot_json=? WHERE session_id=? AND snapshot_seq=?").run(JSON.stringify(snapshot), row.session_id!, row.snapshot_seq!);
    }
    return [...sessions];
  }

  private recountRecords(learnerId: string, claims: readonly string[]): void {
    const links = this.#store.links(learnerId), runs = this.#store.runs(learnerId);
    for (const record of this.#store.records(learnerId).filter(record => claims.includes(record.claimKey))) {
      const counts = summarizeClaim(links.filter(link => record.evidenceLinkIds.includes(link.linkId)), runs);
      this.db.prepare("UPDATE growth_records SET c_supporting=?,c_refuting=?,c_distinct_surfaces=?,c_independent_transfers=?,c_hinted_successes=? WHERE record_id=?")
        .run(counts.supportingChallenges, counts.refutingChallenges, counts.distinctSurfaceContexts, counts.independentTransferSuccesses, counts.hintedSuccesses, record.recordId);
    }
  }

  sweepRetention(now: number): void {
    const sessions = new Set<string>();
    const expiredTasks = new Set<string>(), expiredObjects = new Set<string>();
    const plan = planRetentionPrune({ now, referencedEventIds: this.sessionPort().referencedEventIds(),
      events: this.db.prepare("SELECT event_id,received_at,redacted FROM events").all().map(row => ({ eventId: String(row.event_id), receivedAt: Number(row.received_at), redacted: !!row.redacted })),
      proposals: this.db.prepare("SELECT proposal_id,decided_at,accepted,redacted FROM proposals").all().map(row => ({ proposalId: String(row.proposal_id), decidedAt: Number(row.decided_at), accepted: !!row.accepted, redacted: !!row.redacted })) });
    this.#store.transaction(() => {
      for (const id of plan.redactEventIds) {
        const row = this.db.prepare("SELECT session_id,event_json FROM events WHERE event_id=?").get(id);
        if (!row) continue;
        const event = JSON.parse(String(row.event_json)) as EvidenceEvent;
        sessions.add(String(row.session_id));
        this.db.prepare("UPDATE events SET event_json=?,redacted=1 WHERE event_id=?").run(JSON.stringify({ ...event, payload: redactEventPayload(event.payload) }), id);
        this.db.prepare("UPDATE outbound SET messages_json='[]',redacted=1 WHERE event_id=?").run(id);
      }
      for (const id of plan.redactProposalIds) for (const row of this.db.prepare("SELECT rowid,session_id,proposal_json FROM proposals WHERE proposal_id=?").all(id)) {
        sessions.add(String(row.session_id));
        // 触发提案的事件可能仍被记录引用，独立清掉同会话中这条提案的出站复述。
        const proposal = JSON.parse(String(row.proposal_json)) as ProposalRecord["proposal"];
        expiredTasks.add(proposal.learnerTask);
        for (const action of proposal.canvasActions) if (action.kind === "upsertObject") expiredObjects.add(JSON.stringify(action.object));
        for (const outbound of this.db.prepare("SELECT event_id,messages_json FROM outbound WHERE session_id=?").all(row.session_id!)) {
          const messages = JSON.parse(String(outbound.messages_json)) as Array<{ type: string; text?: string; contestTarget?: { kind: string; id: string }; action?: { kind: string; object?: unknown } }>;
          const safeMessages = messages.filter(message => !(message.contestTarget?.kind === "proposal" && message.contestTarget.id === id) &&
            !(message.type === "canvasAction" && message.action?.kind === "upsertObject" && expiredObjects.has(JSON.stringify(message.action.object))) &&
            !(["speak", "learnerTask"].includes(message.type) && (message.text === proposal.spokenResponse || message.text === proposal.learnerTask)));
          if (safeMessages.length !== messages.length) this.db.prepare("UPDATE outbound SET messages_json=?,redacted=1 WHERE session_id=? AND event_id=?").run(JSON.stringify(safeMessages), row.session_id!, outbound.event_id!);
        }
        const safe = redactProposalForStorage({ proposal: JSON.parse(String(row.proposal_json)) } as ProposalRecord);
        this.db.prepare("UPDATE proposals SET proposal_json=?,redacted=1 WHERE rowid=?").run(JSON.stringify(safe.proposal), row.rowid!);
      }
      for (const sessionId of sessions) {
        for (const row of this.db.prepare("SELECT snapshot_seq,snapshot_json,created_at FROM snapshots WHERE session_id=?").all(sessionId)) {
          const snapshot = JSON.parse(String(row.snapshot_json)) as SessionSnapshot;
          // 较新的检查点仍保留当前任务与笔迹，仅去掉已到期事件的摘要和旧口头输出。
          const safe = Number(row.created_at) <= now - RETENTION_MS ? redactSnapshot(snapshot) : structuredClone(snapshot);
          safe.evidence = safe.evidence.map(evidence => plan.redactEventIds.includes(evidence.eventId) ? { ...evidence, summary: "" } : evidence);
          if (safe.runtime) {
            safe.runtime.lastSpoken = null; delete safe.runtime.lastSpeakContestTarget;
            if (expiredTasks.has(safe.runtime.lastLearnerTask)) { safe.runtime.lastLearnerTask = "这段提示已到保留期限，可以继续自己的尝试。"; delete safe.runtime.lastTaskContestTarget; }
            safe.runtime.agentObjects = safe.runtime.agentObjects.filter(object => !expiredObjects.has(JSON.stringify(object)));
          }
          this.db.prepare("UPDATE snapshots SET snapshot_json=?,redacted=1 WHERE session_id=? AND snapshot_seq=?").run(JSON.stringify(safe), sessionId, row.snapshot_seq!);
        }
        const latest = this.db.prepare("SELECT created_at FROM snapshots WHERE session_id=? ORDER BY snapshot_seq DESC LIMIT 1").get(sessionId);
        if (latest && Number(latest.created_at) <= now - RETENTION_MS) this.db.prepare("UPDATE sessions SET content_deleted=1 WHERE session_id=?").run(sessionId);
      }
      if (plan.redactEventIds.length || plan.redactProposalIds.length) {
        const learners = this.db.prepare("SELECT DISTINCT learner_id FROM artifacts").all().filter(row => this.#store.runs(String(row.learner_id)).some(run => sessions.has(run.sessionId)));
        for (const learner of learners) this.db.prepare("INSERT INTO ledger_audit (audit_id,learner_id,occurred_at,actor,reason_code,subject_kind,subject_id,n_events,n_proposals) VALUES (?,?,?,'system','retention_pruned','sweep',?,?,?)")
          .run(randomUUID(), learner.learner_id!, now, String(now), plan.redactEventIds.length, plan.redactProposalIds.length);
      }
      for (const row of this.db.prepare("SELECT * FROM deletion_requests WHERE status='pending' AND requested_at<=?").all(now - DELETION_SLA_MS))
        this.db.prepare("INSERT OR IGNORE INTO parent_signals VALUES (?,?,?,?,?,?,NULL)").run(idOf("sla", String(row.request_id)), row.learner_id!, "deletionSlaBreached", row.request_id!, 1, now);
    });
    if (sessions.size) {
      for (const listener of this.deletionListeners) listener([...sessions]);
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); this.db.exec("VACUUM");
    }
  }
}
