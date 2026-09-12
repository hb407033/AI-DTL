// packages/learning-kernel/src/store.ts
// 会话存储接口与内存实现。宿主用 SQLite 实现，测试用内存实现，两者跑同一套契约测试。
// 只存事件、出站消息（供重放幂等）、提案裁决与快照；长期成长记录不在这里（阶段 1 不实现 GrowthLedgerService）。
import type { ChildOutbound, EvidenceQuality, SemanticObject, TeachingProposal } from "@ai-scholar/session-contracts";
import type { DisciplineEvidence, LearningChallenge } from "./challenge.js";
import type { StoredEvent } from "./event-log.js";
import type { SessionContext } from "./session-state.js";
import type { RunRecorderState } from "./growth/run-recorder.js";
import type { ContestTarget } from "./growth/types.js";
import { redactProposalForStorage } from "./growth/retention.js";

export interface MemoryPreviewState {
  candidateId: string; nonce: string; tier: 2 | 3; childFacingText: string; evidenceSummaryText: string;
  contestTarget: ContestTarget; shownAt: number;
}

export interface SessionRecord { sessionId: string; discipline: string; challenge: LearningChallenge; createdAt: number }

export interface ProposalRecord {
  proposalId: string;
  accepted: boolean;
  reasons: string[];
  proposal: TeachingProposal;
  decidedAt: number;
  runId?: string | undefined;
}

/** 模型的自由记忆句只参与进程内对齐；提案存档不能旁路写入儿童结论。 */
export function proposalForStorage(proposal: TeachingProposal): TeachingProposal {
  const { memoryCandidate: _candidate, ...safe } = proposal;
  return structuredClone(safe);
}

/** 编排器的运行时：不属于状态机上下文、但重启后必须还原的东西（设计稿 13「服务重启」） */
export interface OrchestratorRuntime {
  erasedHashes: string[];
  agentObjects: SemanticObject[];
  childObjectIds: string[];
  lastProposalId: string | null;
  lastLearnerTask: string;
  lastSpoken: string | null;
  lastTaskContestTarget?: ContestTarget | undefined;
  lastSpeakContestTarget?: ContestTarget | undefined;
  windowStartedAt: number;
  lastNewStrategyAt: number;
  /** 出站消息编号；重启后续号，否则会与重启前发出的 id 撞号 */
  outboundCounter?: number | undefined;
  runRecorder?: RunRecorderState | undefined;
  artifactVersionId?: string | undefined;
  previewNonceCounter?: number | undefined;
  memoryPreview?: MemoryPreviewState | undefined;
  bridgeCandidateRejected?: boolean | undefined;
  pendingProbe?: { probeId: string; discriminates: readonly [string, string]; issuedAt: number } | undefined;
}

export interface SessionSnapshot {
  snapshotSeq: number;
  context: SessionContext;
  lastConfirmedSeq: number;
  challenge: LearningChallenge;
  transferChallenge: LearningChallenge | null;
  evidence: DisciplineEvidence[];
  createdAt: number;
  runtime?: OrchestratorRuntime | undefined;
}

export interface SessionStore {
  createSession(record: SessionRecord): void;
  getSession(sessionId: string): SessionRecord | null;
  /** artifactVersionId 是服务端列：每条事件（含纯语音转写）都要有可解析的作品版本归属，删除级联靠它判定 */
  appendEvent(sessionId: string, stored: StoredEvent, artifactVersionId?: string | undefined): void;
  listEvents(sessionId: string): StoredEvent[];
  /** 有效质量 = 原始质量叠加后续确认；只有 confirmed / corrected 能参与证据计数 */
  effectiveQualityOf(sessionId: string, eventId: string): EvidenceQuality;
  /** 旧库迁移：只补没有作品版本外键的行，返回补了几条 */
  backfillArtifactVersion(sessionId: string, artifactVersionId: string): number;
  saveOutbound(sessionId: string, eventId: string, messages: ChildOutbound[]): void;
  getOutbound(sessionId: string, eventId: string): ChildOutbound[] | null;
  saveProposal(sessionId: string, record: ProposalRecord): void;
  listProposals(sessionId: string): ProposalRecord[];
  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): void;
  latestSnapshot(sessionId: string): SessionSnapshot | null;
}

export const SNAPSHOT_EVERY_EVENTS = 100;
export const SNAPSHOT_EVERY_MS = 30_000;

export function shouldSnapshot(input: { stateChanged: boolean; eventsSinceSnapshot: number; msSinceSnapshot: number }): boolean {
  return input.stateChanged || input.eventsSinceSnapshot >= SNAPSHOT_EVERY_EVENTS || input.msSinceSnapshot >= SNAPSHOT_EVERY_MS;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly events = new Map<string, Map<string, StoredEvent>>();
  private readonly outbound = new Map<string, ChildOutbound[]>();
  private readonly proposals = new Map<string, ProposalRecord[]>();
  private readonly snapshots = new Map<string, SessionSnapshot[]>();
  private readonly confirmations = new Map<string, { confirmed: boolean; corrected: boolean }>();

  createSession(record: SessionRecord): void { this.sessions.set(record.sessionId, record); }
  getSession(sessionId: string): SessionRecord | null { return this.sessions.get(sessionId) ?? null; }
  appendEvent(sessionId: string, stored: StoredEvent, artifactVersionId?: string | undefined): void {
    const bucket = this.events.get(sessionId) ?? new Map<string, StoredEvent>();
    if (!bucket.has(stored.event.eventId)) {
      bucket.set(stored.event.eventId, artifactVersionId === undefined ? stored : { ...stored, artifactVersionId });
    }
    this.events.set(sessionId, bucket);
    const payload = stored.event.payload;
    if (payload.type === "CONFIRM_TRANSCRIPT") {
      this.confirmations.set(`${sessionId}/${payload.targetEventId}`, { confirmed: payload.confirmed, corrected: payload.correctedText !== undefined });
    }
  }

  effectiveQualityOf(sessionId: string, eventId: string): EvidenceQuality {
    const stored = this.events.get(sessionId)?.get(eventId);
    if (!stored) return "unconfirmed";
    const decision = this.confirmations.get(`${sessionId}/${eventId}`);
    if (!decision) return stored.event.quality;
    if (!decision.confirmed) return "unconfirmed";
    return decision.corrected ? "corrected" : "confirmed";
  }

  backfillArtifactVersion(sessionId: string, artifactVersionId: string): number {
    const bucket = this.events.get(sessionId);
    if (!bucket) return 0;
    let filled = 0;
    for (const [id, stored] of bucket) {
      if (stored.artifactVersionId !== undefined) continue;
      bucket.set(id, { ...stored, artifactVersionId });
      filled += 1;
    }
    return filled;
  }
  listEvents(sessionId: string): StoredEvent[] { return [...(this.events.get(sessionId)?.values() ?? [])].sort((a, b) => a.serverSeq - b.serverSeq); }
  saveOutbound(sessionId: string, eventId: string, messages: ChildOutbound[]): void { this.outbound.set(`${sessionId}/${eventId}`, messages); }
  getOutbound(sessionId: string, eventId: string): ChildOutbound[] | null { return this.outbound.get(`${sessionId}/${eventId}`) ?? null; }
  saveProposal(sessionId: string, record: ProposalRecord): void {
    const safe = record.accepted ? record : redactProposalForStorage(record);
    this.proposals.set(sessionId, [...(this.proposals.get(sessionId) ?? []), { ...safe, proposal: proposalForStorage(safe.proposal) }]);
  }
  listProposals(sessionId: string): ProposalRecord[] { return [...(this.proposals.get(sessionId) ?? [])]; }
  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): void { this.snapshots.set(sessionId, [...(this.snapshots.get(sessionId) ?? []), structuredClone(snapshot)]); }
  latestSnapshot(sessionId: string): SessionSnapshot | null { const list = this.snapshots.get(sessionId) ?? []; return list[list.length - 1] ?? null; }
}
