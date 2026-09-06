// packages/learning-kernel/src/store.ts
// 会话存储接口与内存实现。宿主用 SQLite 实现，测试用内存实现，两者跑同一套契约测试。
// 只存事件、出站消息（供重放幂等）、提案裁决与快照；长期成长记录不在这里（阶段 1 不实现 GrowthLedgerService）。
import type { ChildOutbound, SemanticObject, TeachingProposal } from "@ai-scholar/session-contracts";
import type { DisciplineEvidence, LearningChallenge } from "./challenge.js";
import type { StoredEvent } from "./event-log.js";
import type { SessionContext } from "./session-state.js";

export interface SessionRecord { sessionId: string; discipline: string; challenge: LearningChallenge; createdAt: number }

export interface ProposalRecord {
  proposalId: string;
  accepted: boolean;
  reasons: string[];
  proposal: TeachingProposal;
  decidedAt: number;
}

/** 编排器的运行时：不属于状态机上下文、但重启后必须还原的东西（设计稿 13「服务重启」） */
export interface OrchestratorRuntime {
  erasedHashes: string[];
  agentObjects: SemanticObject[];
  childObjectIds: string[];
  lastProposalId: string | null;
  lastLearnerTask: string;
  lastSpoken: string | null;
  windowStartedAt: number;
  lastNewStrategyAt: number;
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
  appendEvent(sessionId: string, stored: StoredEvent): void;
  listEvents(sessionId: string): StoredEvent[];
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

  createSession(record: SessionRecord): void { this.sessions.set(record.sessionId, record); }
  getSession(sessionId: string): SessionRecord | null { return this.sessions.get(sessionId) ?? null; }
  appendEvent(sessionId: string, stored: StoredEvent): void {
    const bucket = this.events.get(sessionId) ?? new Map<string, StoredEvent>();
    if (!bucket.has(stored.event.eventId)) bucket.set(stored.event.eventId, stored);
    this.events.set(sessionId, bucket);
  }
  listEvents(sessionId: string): StoredEvent[] { return [...(this.events.get(sessionId)?.values() ?? [])].sort((a, b) => a.serverSeq - b.serverSeq); }
  saveOutbound(sessionId: string, eventId: string, messages: ChildOutbound[]): void { this.outbound.set(`${sessionId}/${eventId}`, messages); }
  getOutbound(sessionId: string, eventId: string): ChildOutbound[] | null { return this.outbound.get(`${sessionId}/${eventId}`) ?? null; }
  saveProposal(sessionId: string, record: ProposalRecord): void { this.proposals.set(sessionId, [...(this.proposals.get(sessionId) ?? []), record]); }
  listProposals(sessionId: string): ProposalRecord[] { return [...(this.proposals.get(sessionId) ?? [])]; }
  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): void { this.snapshots.set(sessionId, [...(this.snapshots.get(sessionId) ?? []), structuredClone(snapshot)]); }
  latestSnapshot(sessionId: string): SessionSnapshot | null { const list = this.snapshots.get(sessionId) ?? []; return list[list.length - 1] ?? null; }
}
