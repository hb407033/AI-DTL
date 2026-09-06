// packages/learning-kernel/src/sqlite-store.ts
// SQLite 会话存储（Node 22 内置 node:sqlite，无外部依赖）。结构化元数据进表，JSON 列只放小对象；
// 大作品与附件将来走文件目录（设计稿 11.2），不塞进这里。
import { DatabaseSync } from "node:sqlite";
import type { ChildOutbound } from "@ai-scholar/session-contracts";
import type { StoredEvent } from "./event-log.js";
import type { ProposalRecord, SessionRecord, SessionSnapshot, SessionStore } from "./store.js";

export class SqliteSessionStore implements SessionStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, discipline TEXT NOT NULL, challenge_json TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, client_seq INTEGER NOT NULL, server_seq INTEGER NOT NULL,
        content_hash TEXT NOT NULL, quality TEXT NOT NULL, event_json TEXT NOT NULL, received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session ON events(session_id, server_seq);
      CREATE TABLE IF NOT EXISTS outbound (session_id TEXT NOT NULL, event_id TEXT NOT NULL, messages_json TEXT NOT NULL, PRIMARY KEY (session_id, event_id));
      CREATE TABLE IF NOT EXISTS proposals (session_id TEXT NOT NULL, proposal_id TEXT NOT NULL, accepted INTEGER NOT NULL, reasons_json TEXT NOT NULL, proposal_json TEXT NOT NULL, decided_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (session_id TEXT NOT NULL, snapshot_seq INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (session_id, snapshot_seq));
    `);
  }

  createSession(record: SessionRecord): void {
    this.db.prepare("INSERT OR REPLACE INTO sessions (session_id, discipline, challenge_json, created_at) VALUES (?, ?, ?, ?)")
      .run(record.sessionId, record.discipline, JSON.stringify(record.challenge), record.createdAt);
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db.prepare("SELECT session_id, discipline, challenge_json, created_at FROM sessions WHERE session_id = ?").get(sessionId) as
      { session_id: string; discipline: string; challenge_json: string; created_at: number } | undefined;
    return row ? { sessionId: row.session_id, discipline: row.discipline, challenge: JSON.parse(row.challenge_json), createdAt: row.created_at } : null;
  }

  appendEvent(sessionId: string, stored: StoredEvent): void {
    this.db.prepare("INSERT OR IGNORE INTO events (event_id, session_id, client_seq, server_seq, content_hash, quality, event_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(stored.event.eventId, sessionId, stored.event.clientSeq, stored.serverSeq, stored.contentHash, stored.event.quality, JSON.stringify(stored.event), stored.receivedAt);
  }

  listEvents(sessionId: string): StoredEvent[] {
    const rows = this.db.prepare("SELECT event_json, server_seq, received_at, content_hash FROM events WHERE session_id = ? ORDER BY server_seq").all(sessionId) as
      Array<{ event_json: string; server_seq: number; received_at: number; content_hash: string }>;
    return rows.map((r) => ({ event: JSON.parse(r.event_json), serverSeq: r.server_seq, receivedAt: r.received_at, contentHash: r.content_hash }));
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

  close(): void { this.db.close(); }
}
