// packages/learning-kernel/src/sqlite-store.ts
// SQLite 会话存储（Node 22 内置 node:sqlite，无外部依赖）。结构化元数据进表，JSON 列只放小对象；
// 大作品与附件将来走文件目录（设计稿 11.2），不塞进这里。
import type { ChildOutbound, EvidenceQuality } from "@ai-scholar/session-contracts";
import type { LearningDatabase } from "./growth/database.js";
import type { StoredEvent } from "./event-log.js";
import type { ProposalRecord, SessionRecord, SessionSnapshot, SessionStore } from "./store.js";

export class SqliteSessionStore implements SessionStore {

  constructor(private readonly db: LearningDatabase) {}

  createSession(record: SessionRecord): void {
    this.db.prepare("INSERT OR REPLACE INTO sessions (session_id, discipline, challenge_json, created_at) VALUES (?, ?, ?, ?)")
      .run(record.sessionId, record.discipline, JSON.stringify(record.challenge), record.createdAt);
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db.prepare("SELECT session_id, discipline, challenge_json, created_at FROM sessions WHERE session_id = ?").get(sessionId) as
      { session_id: string; discipline: string; challenge_json: string; created_at: number } | undefined;
    return row ? { sessionId: row.session_id, discipline: row.discipline, challenge: JSON.parse(row.challenge_json), createdAt: row.created_at } : null;
  }

  appendEvent(sessionId: string, stored: StoredEvent, artifactVersionId?: string | undefined): void {
    this.db.prepare("INSERT OR IGNORE INTO events (event_id, session_id, client_seq, server_seq, content_hash, quality, event_json, received_at, artifact_version_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(stored.event.eventId, sessionId, stored.event.clientSeq, stored.serverSeq, stored.contentHash, stored.event.quality, JSON.stringify(stored.event), stored.receivedAt, artifactVersionId ?? null);
    // 转写确认是派生索引：原事件行永不改写，这张表随时可以从 events 重建
    const payload = stored.event.payload;
    if (payload.type === "CONFIRM_TRANSCRIPT") {
      this.db.prepare("INSERT OR REPLACE INTO event_confirmations (session_id, target_event_id, confirmed, corrected, at) VALUES (?, ?, ?, ?, ?)")
        .run(sessionId, payload.targetEventId, payload.confirmed ? 1 : 0, payload.correctedText === undefined ? 0 : 1, stored.receivedAt);
    }
  }

  /** 事件的有效质量：原始质量叠加后续确认。只有 confirmed / corrected 才允许参与证据计数（规范 13） */
  effectiveQualityOf(sessionId: string, eventId: string): EvidenceQuality {
    const row = this.db.prepare(`
      SELECT e.quality AS quality, c.confirmed AS confirmed, c.corrected AS corrected
      FROM events e LEFT JOIN event_confirmations c ON c.session_id = e.session_id AND c.target_event_id = e.event_id
      WHERE e.session_id = ? AND e.event_id = ?`).get(sessionId, eventId) as
      { quality: string; confirmed: number | null; corrected: number | null } | undefined;
    if (!row) return "unconfirmed";
    if (row.confirmed === null) return row.quality as EvidenceQuality;
    if (row.confirmed === 0) return "unconfirmed";
    return row.corrected === 1 ? "corrected" : "confirmed";
  }

  /** 旧库迁移用：只补没有作品版本外键的行，返回补了几条 */
  backfillArtifactVersion(sessionId: string, artifactVersionId: string): number {
    const before = this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND artifact_version_id IS NULL").get(sessionId) as { n: number };
    this.db.prepare("UPDATE events SET artifact_version_id = ? WHERE session_id = ? AND artifact_version_id IS NULL").run(artifactVersionId, sessionId);
    return before.n;
  }

  listEvents(sessionId: string): StoredEvent[] {
    const rows = this.db.prepare("SELECT event_json, server_seq, received_at, content_hash, artifact_version_id FROM events WHERE session_id = ? ORDER BY server_seq").all(sessionId) as
      Array<{ event_json: string; server_seq: number; received_at: number; content_hash: string; artifact_version_id: string | null }>;
    return rows.map((r) => ({ event: JSON.parse(r.event_json), serverSeq: r.server_seq, receivedAt: r.received_at, contentHash: r.content_hash, ...(r.artifact_version_id === null ? {} : { artifactVersionId: r.artifact_version_id }) }));
  }

  saveOutbound(sessionId: string, eventId: string, messages: ChildOutbound[]): void {
    this.db.prepare("INSERT OR REPLACE INTO outbound (session_id, event_id, messages_json) VALUES (?, ?, ?)").run(sessionId, eventId, JSON.stringify(messages));
  }

  getOutbound(sessionId: string, eventId: string): ChildOutbound[] | null {
    const row = this.db.prepare("SELECT messages_json FROM outbound WHERE session_id = ? AND event_id = ?").get(sessionId, eventId) as { messages_json: string } | undefined;
    return row ? (JSON.parse(row.messages_json) as ChildOutbound[]) : null;
  }

  saveProposal(sessionId: string, record: ProposalRecord): void {
    this.db.prepare("INSERT INTO proposals (session_id, proposal_id, accepted, reasons_json, proposal_json, decided_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sessionId, record.proposalId, record.accepted ? 1 : 0, JSON.stringify(record.reasons), JSON.stringify(record.proposal), record.decidedAt);
  }

  listProposals(sessionId: string): ProposalRecord[] {
    const rows = this.db.prepare("SELECT proposal_id, accepted, reasons_json, proposal_json, decided_at FROM proposals WHERE session_id = ? ORDER BY rowid").all(sessionId) as
      Array<{ proposal_id: string; accepted: number; reasons_json: string; proposal_json: string; decided_at: number }>;
    return rows.map((r) => ({ proposalId: r.proposal_id, accepted: r.accepted === 1, reasons: JSON.parse(r.reasons_json), proposal: JSON.parse(r.proposal_json), decidedAt: r.decided_at }));
  }

  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): void {
    this.db.prepare("INSERT OR REPLACE INTO snapshots (session_id, snapshot_seq, snapshot_json, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, snapshot.snapshotSeq, JSON.stringify(snapshot), snapshot.createdAt);
  }

  latestSnapshot(sessionId: string): SessionSnapshot | null {
    const row = this.db.prepare("SELECT snapshot_json FROM snapshots WHERE session_id = ? ORDER BY snapshot_seq DESC LIMIT 1").get(sessionId) as { snapshot_json: string } | undefined;
    return row ? (JSON.parse(row.snapshot_json) as SessionSnapshot) : null;
  }

}
