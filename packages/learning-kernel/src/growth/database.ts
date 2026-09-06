// 学习系统的本地库：会话表与成长表同库同连接（成长记忆层设计稿 §7.1）。
// 为什么必须同库：删除一件作品要同时清掉会话侧的原话与成长侧的结论，跨连接没有原子事务，
// 半删（内容删了、结论还活着）比不删更糟。这里是全仓唯一 new DatabaseSync 的地方。
import { DatabaseSync } from "node:sqlite";

export type LearningDatabase = DatabaseSync;

/** 会话侧新增的列：旧库用 ALTER 补，新库由 CREATE TABLE 直接带上 */
const SESSION_COLUMNS: ReadonlyArray<readonly [table: string, column: string, ddl: string]> = [
  ["events", "artifact_version_id", "TEXT"],
  ["events", "redacted", "INTEGER NOT NULL DEFAULT 0"],
  ["proposals", "run_id", "TEXT"],
  ["proposals", "redacted", "INTEGER NOT NULL DEFAULT 0"],
  ["snapshots", "redacted", "INTEGER NOT NULL DEFAULT 0"],
];

/** 会话表。原先建在 SqliteSessionStore 里，同库之后统一由这里建。 */
export function createSessionTables(db: LearningDatabase): void {
  db.exec(`
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
  for (const [table, column, ddl] of SESSION_COLUMNS) addColumnIfMissing(db, table, column, ddl);
  db.exec("CREATE INDEX IF NOT EXISTS events_artifact ON events(artifact_version_id);");
}

/** 成长表。建表语句与设计稿 §9.2 逐字一致。 */
export function createGrowthTables(db: LearningDatabase): void {
  db.exec(`
    -- events 加两列：服务端归属外键 + 脱敏标记

    -- proposals 加 run 归属 + 脱敏标记

    -- 转写确认的派生索引；可从 events 完整重建，原事件行永不改写
    CREATE TABLE IF NOT EXISTS event_confirmations (
      session_id TEXT NOT NULL, target_event_id TEXT NOT NULL,
      confirmed INTEGER NOT NULL, corrected INTEGER NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (session_id, target_event_id));

    -- 提案发出时正在驱动教学的假设：CONTEST 指向 proposal 时靠它分派（写入者见 §8.1）
    CREATE TABLE IF NOT EXISTS proposal_hypotheses (
      proposal_id TEXT NOT NULL, hypothesis_key TEXT NOT NULL, recorded_at INTEGER NOT NULL,
      PRIMARY KEY (proposal_id, hypothesis_key));

    CREATE TABLE IF NOT EXISTS learners (
      learner_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);

    -- ══ 档 1：作品与版本链 ══
    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, session_id TEXT NOT NULL,
      discipline TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS artifact_versions (
      artifact_version_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, version_no INTEGER NOT NULL,
      writer TEXT NOT NULL CHECK (writer IN ('host_snapshot','child_upload')),
      content_ref TEXT NOT NULL, content_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      written_by TEXT NOT NULL CHECK (written_by = 'GrowthLedgerService'),
      UNIQUE (artifact_id, version_no));

    -- ══ run、链接、假设 ══
    CREATE TABLE IF NOT EXISTS challenge_runs (
      run_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, session_id TEXT NOT NULL, challenge_id TEXT NOT NULL,
      discipline TEXT NOT NULL, probe_family_id TEXT NOT NULL, difficulty_band TEXT NOT NULL,
      difficulty_band_index INTEGER NOT NULL, development_goal_id TEXT NOT NULL, claim_key TEXT NOT NULL,
      surface_context_key TEXT NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER, first_server_seq INTEGER NOT NULL, last_server_seq INTEGER NOT NULL,
      max_hint_level_used INTEGER NOT NULL, escalation_count INTEGER NOT NULL, probes_issued INTEGER NOT NULL,
      transfer_outcome TEXT NOT NULL CHECK (transfer_outcome IN ('succeeded','failed','none')),
      transfer_hint_level_used INTEGER NOT NULL, transfer_tainted INTEGER NOT NULL,
      reconstructed INTEGER NOT NULL, assisted_round INTEGER NOT NULL, self_correction_observed INTEGER NOT NULL,
      time_to_first_productive_action_ms INTEGER, probe_resolved INTEGER NOT NULL, discriminates_json TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS run_artifacts (run_id TEXT NOT NULL, artifact_version_id TEXT NOT NULL, PRIMARY KEY (run_id, artifact_version_id));

    CREATE TABLE IF NOT EXISTS claim_evidence_links (
      link_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, run_id TEXT NOT NULL,
      event_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
      claim_key TEXT NOT NULL, hypothesis_key TEXT,
      direction TEXT NOT NULL CHECK (direction IN ('supports','weakens')),
      surface_context_key TEXT NOT NULL, from_probe_id TEXT, self_correction INTEGER NOT NULL,
      artifact_version_id TEXT, observed_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','evidence_removed')),
      written_by TEXT NOT NULL CHECK (written_by = 'GrowthLedgerService'));
    CREATE INDEX IF NOT EXISTS links_claim ON claim_evidence_links(learner_id, claim_key, status, observed_at);
    CREATE INDEX IF NOT EXISTS links_event ON claim_evidence_links(event_id);

    CREATE TABLE IF NOT EXISTS hypotheses (
      hypothesis_key TEXT NOT NULL, learner_id TEXT NOT NULL, discipline TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('suspected','confirmed','refuted','contested','expired','evidence_removed')),
      stops_driving_personalization INTEGER NOT NULL DEFAULT 0,
      c_supporting INTEGER NOT NULL DEFAULT 0, c_refuting INTEGER NOT NULL DEFAULT 0,
      c_distinct_surfaces INTEGER NOT NULL DEFAULT 0, c_independent_transfers INTEGER NOT NULL DEFAULT 0,
      c_hinted_successes INTEGER NOT NULL DEFAULT 0,
      last_observed_at INTEGER, expires_at INTEGER, PRIMARY KEY (learner_id, hypothesis_key));

    -- 本轮活跃 ≠ 跨轮身份（MF-16）
    CREATE TABLE IF NOT EXISTS round_active_candidates (
      run_id TEXT NOT NULL, hypothesis_key TEXT NOT NULL, activated_at INTEGER NOT NULL,
      demoted_at INTEGER, PRIMARY KEY (run_id, hypothesis_key));

    -- ══ SDP 与趋势洞 ══（列见 §6.1）
    CREATE TABLE IF NOT EXISTS scaffold_points (
      point_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, run_id TEXT NOT NULL, challenge_id TEXT NOT NULL,
      goal_kind TEXT NOT NULL DEFAULT 'developmentGoal' CHECK (goal_kind = 'developmentGoal'),
      goal_id TEXT NOT NULL, probe_family_id TEXT NOT NULL,
      difficulty_band TEXT NOT NULL, difficulty_band_index INTEGER NOT NULL,
      max_hint_level_used INTEGER NOT NULL, escalation_count INTEGER NOT NULL, probes_issued INTEGER NOT NULL,
      independent_transfer_succeeded INTEGER NOT NULL,
      time_to_first_productive_action_ms INTEGER,
      self_correction_observed INTEGER NOT NULL, assisted_round INTEGER NOT NULL,
      occurred_at INTEGER NOT NULL,
      written_by TEXT NOT NULL CHECK (written_by = 'GrowthLedgerService'),
      UNIQUE (run_id, goal_id));
    CREATE INDEX IF NOT EXISTS sdp_window ON scaffold_points(learner_id, goal_id, probe_family_id, difficulty_band_index, occurred_at);
    CREATE TABLE IF NOT EXISTS trend_gaps (
      gap_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, goal_id TEXT NOT NULL, probe_family_id TEXT NOT NULL,
      difficulty_band_index INTEGER NOT NULL, removed_count INTEGER NOT NULL,
      added_since_count INTEGER NOT NULL DEFAULT 0, removed_at INTEGER NOT NULL);

    -- ══ 候选、同意、审阅、决策、记录 ══
    CREATE TABLE IF NOT EXISTS memory_candidates (
      candidate_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, tier INTEGER NOT NULL CHECK (tier IN (2,3)),
      claim_key TEXT NOT NULL, target_object_id TEXT NOT NULL, target_object_label TEXT NOT NULL,
      scope_probe_family_id TEXT NOT NULL, scope_band_index INTEGER NOT NULL, scope_surfaces_json TEXT NOT NULL,
      counts_json TEXT NOT NULL, evidence_link_ids_json TEXT NOT NULL, hypothesis_keys_json TEXT NOT NULL DEFAULT '[]',
      transfer_refs_json TEXT NOT NULL, max_hint_level_at_achievement INTEGER NOT NULL,
      next_verification_json TEXT NOT NULL,
      child_facing_text TEXT NOT NULL,            -- 内核模板渲染，非自由文本
      evidence_summary_text TEXT NOT NULL,
      proposed_by TEXT NOT NULL CHECK (proposed_by IN ('bridge','kernel','bridge+kernel')),
      preview_nonce TEXT, shown_at INTEGER,
      status TEXT NOT NULL CHECK (status IN
        ('awaiting_parent','awaiting_child','awaiting_reassent','held','declined_unsure','contested','committed','superseded')),
      created_at INTEGER NOT NULL,
      written_by TEXT NOT NULL CHECK (written_by = 'GrowthLedgerService'),
      UNIQUE (candidate_id, preview_nonce));

    CREATE TABLE IF NOT EXISTS child_assents (
      assent_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, preview_nonce TEXT NOT NULL,
      choice TEXT NOT NULL CHECK (choice IN ('record','unsure','disagree')),
      assent_event_id TEXT NOT NULL, shown_at INTEGER NOT NULL, answered_at INTEGER NOT NULL,
      voided_at INTEGER, voided_reason TEXT CHECK (voided_reason IS NULL OR voided_reason IN ('parent_narrowed_scope','evidence_removed')),
      UNIQUE (candidate_id, preview_nonce));

    CREATE TABLE IF NOT EXISTS parent_reviews (
      review_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
      narrowed_scope_json TEXT, parent_note TEXT,     -- note 只给家长看，过禁词表，删除时一并抹
      reviewed_at INTEGER NOT NULL, voided_at INTEGER);

    CREATE TABLE IF NOT EXISTS memory_decisions (
      decision_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
      tier INTEGER NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('preflight','decide')),
      ruleset_id TEXT NOT NULL, rule_results_json TEXT NOT NULL, failures_json TEXT NOT NULL,
      child_choice TEXT, parent_review_id TEXT, assisted_round INTEGER NOT NULL,
      committed INTEGER NOT NULL, record_id TEXT, reason_code TEXT,
      child_facing_text TEXT NOT NULL DEFAULT '',     -- 删除时置空串（§7.2 步骤 8）
      evidence_summary_text TEXT NOT NULL DEFAULT '',
      decided_by TEXT NOT NULL CHECK (decided_by = 'GrowthLedgerService'), decided_at INTEGER NOT NULL);

    CREATE TABLE IF NOT EXISTS growth_records (
      record_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, tier INTEGER NOT NULL CHECK (tier IN (2,3)),
      claim_key TEXT NOT NULL, discipline TEXT NOT NULL, probe_family_id TEXT NOT NULL,
      development_goal_id TEXT NOT NULL, target_object_id TEXT NOT NULL, target_object_label TEXT NOT NULL,
      scope_band_index INTEGER NOT NULL, scope_surfaces_json TEXT NOT NULL,
      child_facing_text TEXT NOT NULL, evidence_summary_text TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN
        ('suspected','confirmed','refuted','contested','expired','evidence_removed')),
      suppressed_reason TEXT CHECK (suppressed_reason IS NULL OR suppressed_reason = 'deletionRequested'),
      evidence_link_ids_json TEXT NOT NULL, required_transfer_link_ids_json TEXT NOT NULL,
      hypothesis_keys_json TEXT NOT NULL DEFAULT '[]',
      c_supporting INTEGER NOT NULL, c_refuting INTEGER NOT NULL, c_distinct_surfaces INTEGER NOT NULL,
      c_independent_transfers INTEGER NOT NULL, c_hinted_successes INTEGER NOT NULL, last_observed_at INTEGER,
      transfer_refs_json TEXT NOT NULL, trend_ref_json TEXT,
      max_hint_level_at_achievement INTEGER NOT NULL,
      next_verification_json TEXT NOT NULL, next_verification_due_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      decision_id TEXT NOT NULL, committed_at INTEGER NOT NULL, retracted_at INTEGER,
      written_by TEXT NOT NULL CHECK (written_by = 'GrowthLedgerService'),
      -- 档 2 的迁移必须无提示：数据库层再挡一次
      CHECK (tier <> 2 OR json_extract(transfer_refs_json, '$[0].transferHintLevelUsed') = 0),
      CHECK (tier <> 3 OR trend_ref_json IS NOT NULL));
    CREATE INDEX IF NOT EXISTS rec_active ON growth_records(learner_id, discipline, status, retracted_at, suppressed_reason);
    CREATE INDEX IF NOT EXISTS rec_due    ON growth_records(learner_id, next_verification_due_at);

    -- ══ 异议、冷却、信号、删除请求、知情、审计 ══
    CREATE TABLE IF NOT EXISTS contests (
      contest_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('proposal','hypothesis','record','candidate','session')),
      subject_id TEXT NOT NULL, session_id TEXT NOT NULL, run_id TEXT, event_id TEXT NOT NULL,
      claim_keys_json TEXT NOT NULL DEFAULT '[]',
      contested_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by_run_id TEXT,
      resolution TEXT CHECK (resolution IS NULL OR resolution IN ('resolved','withdrawn')));
    CREATE INDEX IF NOT EXISTS contests_open ON contests(learner_id, resolved_at);            -- §8.2
    CREATE TABLE IF NOT EXISTS contest_frozen_links (contest_id TEXT NOT NULL, link_id TEXT NOT NULL, PRIMARY KEY (contest_id, link_id));
    CREATE TABLE IF NOT EXISTS contest_frozen_points (contest_id TEXT NOT NULL, point_id TEXT NOT NULL, PRIMARY KEY (contest_id, point_id));

    CREATE TABLE IF NOT EXISTS decline_signals (
      learner_id TEXT NOT NULL, claim_key TEXT NOT NULL,
      consecutive_declines INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_declines >= 0),
      last_asked_at INTEGER, last_declined_at INTEGER,
      runs_since_last_ask INTEGER NOT NULL DEFAULT 0 CHECK (runs_since_last_ask >= 0),
      PRIMARY KEY (learner_id, claim_key));

    CREATE TABLE IF NOT EXISTS parent_signals (
      signal_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('repeatedDecline','teachingAlert','trendIncomplete','deletionSlaBreached')),
      subject_id TEXT NOT NULL, count INTEGER NOT NULL, created_at INTEGER NOT NULL, acknowledged_at INTEGER);

    -- 影响范围只存计数，不存任何自由文本；文字每次现算（修版本 B 的 preview_json 泄漏）
    CREATE TABLE IF NOT EXISTS deletion_requests (
      request_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('artifact','growth_record')),
      subject_id TEXT NOT NULL,
      requested_by TEXT NOT NULL CHECK (requested_by IN ('child','parent')),
      requested_at INTEGER NOT NULL, escalated INTEGER NOT NULL DEFAULT 0,
      affected_records INTEGER NOT NULL, affected_artifact_versions INTEGER NOT NULL,
      affected_points INTEGER NOT NULL, affected_links INTEGER NOT NULL, preview_computed_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
      decided_at INTEGER, decided_by TEXT CHECK (decided_by IS NULL OR decided_by = 'parent'),
      outcome_code TEXT CHECK (outcome_code IS NULL OR outcome_code IN
        ('deleted','kept_needed_evidence','kept_parent_declined','withdrawn_by_child')),
      audit_id TEXT);
    -- 「同一 subject 同时只能有一条待办」用部分唯一索引；把 status 写进 UNIQUE 会在第二次被拒时炸
    CREATE UNIQUE INDEX IF NOT EXISTS del_req_one_pending
      ON deletion_requests(learner_id, subject_kind, subject_id) WHERE status = 'pending';

    -- 结果回传给孩子：只存文案键与计数，库里不留自由文本
    CREATE TABLE IF NOT EXISTS child_notifications (
      notification_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('deletionResolved','recordRetracted','contestResolved')),
      subject_id TEXT NOT NULL, text_key TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER);

    CREATE TABLE IF NOT EXISTS first_use_notices (
      learner_id TEXT PRIMARY KEY, version INTEGER NOT NULL, text_hash TEXT NOT NULL, acknowledged_at INTEGER NOT NULL);

    -- 最小审计项：只有 id、枚举、计数、时间与 id 列表，没有任何自由文本列
    CREATE TABLE IF NOT EXISTS ledger_audit (
      audit_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, occurred_at INTEGER NOT NULL,
      actor TEXT NOT NULL CHECK (actor IN ('child','parent','system')),
      reason_code TEXT NOT NULL CHECK (reason_code IN ('artifact_deleted','record_deleted','record_retracted','retention_pruned')),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('artifact','growth_record','sweep')),
      subject_id TEXT NOT NULL,
      n_events INTEGER NOT NULL DEFAULT 0, n_outbound INTEGER NOT NULL DEFAULT 0, n_snapshots INTEGER NOT NULL DEFAULT 0,
      n_proposals INTEGER NOT NULL DEFAULT 0, n_links INTEGER NOT NULL DEFAULT 0, n_hypotheses INTEGER NOT NULL DEFAULT 0,
      n_records INTEGER NOT NULL DEFAULT 0, n_points INTEGER NOT NULL DEFAULT 0,
      n_assents INTEGER NOT NULL DEFAULT 0, n_decisions INTEGER NOT NULL DEFAULT 0,
      retired_record_ids_json TEXT NOT NULL DEFAULT '[]',
      retired_hypothesis_keys_json TEXT NOT NULL DEFAULT '[]',
      voided_assent_ids_json TEXT NOT NULL DEFAULT '[]');
  `);
}

/** 重复建库要幂等：已有的列不再加，否则旧库第二次打开就炸 */
function addColumnIfMissing(db: LearningDatabase, table: string, column: string, ddl: string): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (existing.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

export function openLearningDatabase(path: string): LearningDatabase {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA secure_delete = ON;
    PRAGMA foreign_keys = ON;
  `);
  createSessionTables(db);
  createGrowthTables(db);
  return db;
}
