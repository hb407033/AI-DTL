import { promises as fs, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { teachingDecisionSchema, type TeachingDecision } from "./teaching-decision.js";
import { projectThinkingMoveMemory, summarizeThinkingMoveMemory, type ThinkingMoveMemoryEntry } from "./families/thinking-move-ledger.js";
import { scaffoldJournalSchema, type ScaffoldJournal } from "@ai-scholar/session-contracts";
import { applyScaffoldChange, invalidateStaleScaffolds, scaffoldChangeSchema } from "./line-scaffold.js";
import { workspaceIdSchema, workspaceRecordSchema, inquiryEntrySchema, inquiryJournalSchema, type InquiryJournal, type WorkspaceRecord } from "@ai-scholar/session-contracts";

const receipt = z.strictObject({ hash: z.string(), revision: z.number().int().nonnegative() });
const mediaEntry = z.strictObject({ id: workspaceIdSchema, eventId: workspaceIdSchema, hash: z.string(),
  kind: z.enum(["problemPhoto", "preview"]), mime: z.enum(["image/png", "image/jpeg"]) });
const bundleSchema = z.strictObject({ record: workspaceRecordSchema,
  receipts: z.record(workspaceIdSchema, receipt), media: z.array(mediaEntry).max(200), inquiry: inquiryJournalSchema.optional(),
  scaffold: scaffoldJournalSchema.optional(), scaffoldReceipts: z.record(workspaceIdSchema, receipt).optional(),
  teachingDecisions: z.array(teachingDecisionSchema).max(1000).optional() });
type Bundle = z.infer<typeof bundleSchema>;
type SaveResult = { ok: true; revision: number } | { ok: false; reason: string };
type LoadResult = { status: "ok"; record: WorkspaceRecord } | { status: "missing" | "corrupt" };
function validTeachingDecisions(bundle: Bundle): TeachingDecision[] {
  const record = bundle.record;
  return (bundle.teachingDecisions ?? []).filter(d => d.problemId === record.problem?.problemId
    && d.problemRevision === record.problem.statement.revision
    && record.feedback.some(f => f.responseId === d.responseId && f.turnId === d.turnId && !f.contested && f.summary === d.utterance));
}
const queues = new Map<string, Promise<unknown>>();
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const validId = (id: string) => { if (!workspaceIdSchema.safeParse(id).success) throw Error("invalidId"); };
async function exists(file: string) {
  try { await fs.access(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function atomicWrite(file: string, data: string | Buffer, signal?: AbortSignal) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data, { flag: "wx", mode: 0o600 });
    if (signal?.aborted) throw Error("aborted");
    // 有取消约束的提交在同一事件循环片段内检查并 rename，不留异步提交竞态。
    if (signal) renameSync(tmp, file);
    else await fs.rename(tmp, file);
  }
  finally { await fs.rm(tmp, { force: true }); }
}

/** 一个宿主进程内按规范化目录＋session 串行 CAS。多进程写者不在当前部署契约中。 */
export class WorkspaceStore {
  readonly directory: string;
  constructor(options: { directory?: string } = {}) {
    this.directory = path.resolve(options.directory ?? path.join(os.homedir(), "Library", "Application Support", "ai-dtl", "workspaces-v2"));
  }
  private file(id: string) { validId(id); return path.join(this.directory, `${id}.json`); }
  private tombstone(id: string) { validId(id); return path.join(this.directory, `${id}.deleted`); }
  private async serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const key = this.file(id);
    const prior = queues.get(key) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(work);
    queues.set(key, task);
    try { return await task; } finally { if (queues.get(key) === task) queues.delete(key); }
  }
  private async read(id: string): Promise<Bundle | "missing" | "corrupt"> {
    if (await exists(this.tombstone(id))) return "missing";
    let raw: string;
    try { raw = await fs.readFile(this.file(id), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
    try {
      const parsed = bundleSchema.safeParse(JSON.parse(raw));
      return parsed.success && parsed.data.record.sessionId === id ? parsed.data : "corrupt";
    } catch { return "corrupt"; }
  }
  async load(id: string): Promise<LoadResult> {
    const bundle = await this.read(id);
    return typeof bundle === "string" ? { status: bundle } : { status: "ok", record: bundle.record };
  }
  async list(options: { after?: string | undefined; limit?: number | undefined } = {}) {
    if (options.after !== undefined) validId(options.after);
    const limit = options.limit ?? 30;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw Error("invalidLimit");
    let files: string[];
    try { files = await fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") files = []; else throw error; }
    const ids = files.filter(f => /^[A-Za-z0-9-]{1,80}\.json$/.test(f))
      .map(f => f.slice(0, -5)).sort().filter(id => !options.after || id > options.after);
    const items: { sessionId: string; title: string; revision: number; inquiryCount: number }[] = [];
    let unavailableCount = 0;
    for (const id of ids) {
      const bundle = await this.read(id);
      if (bundle === "corrupt") { unavailableCount++; continue; }
      if (bundle === "missing") continue;
      const question = bundle.inquiry?.entries.find(e => e.kind === "question");
      items.push({ sessionId: id, title: (question?.text ?? bundle.record.problem?.statement.text ?? "尚未命名的探索").slice(0, 160),
        revision: bundle.record.revision, inquiryCount: bundle.inquiry?.entries.length ?? 0 });
      if (items.length > limit) break;
    }
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return { items, nextCursor: hasMore ? items.at(-1)!.sessionId : null, unavailableCount };
  }
  async loadInquiry(id: string): Promise<InquiryJournal> {
    const bundle = await this.read(id);
    if (typeof bundle === "string") throw Error(bundle);
    return bundle.inquiry ?? { revision: 0, entries: [] };
  }
  async loadScaffold(id: string): Promise<ScaffoldJournal> {
    const bundle = await this.read(id);
    if (typeof bundle === "string") throw Error(bundle);
    return bundle.scaffold ?? { revision: 0, items: [] };
  }
  async loadTeachingDecisions(id: string): Promise<TeachingDecision[]> {
    const bundle = await this.read(id);
    if (typeof bundle === "string") throw Error(bundle);
    return validTeachingDecisions(bundle).slice(-12);
  }
  /** 单孩子边界目前就是此目录；每次从有效作品重算，删除/异议/更正没有遗留副本。 */
  async loadThinkingMoveSummary(): Promise<ThinkingMoveMemoryEntry[]> {
    const entries: ThinkingMoveMemoryEntry[] = [];
    let after: string | undefined;
    do {
      const page = await this.list({ after, limit: 50 });
      for (const item of page.items) {
        const bundle = await this.read(item.sessionId);
        // 列表和读取之间可能删除或损坏；不可把坏档当成学习证据。
        if (typeof bundle !== "string") entries.push(...projectThinkingMoveMemory(bundle.record, validTeachingDecisions(bundle)));
      }
      after = page.nextCursor ?? undefined;
    } while (after);
    return summarizeThinkingMoveMemory(entries);
  }
  async changeScaffold(id: string, eventId: string, expectedRevision: number, raw: unknown): Promise<ScaffoldJournal> {
    validId(eventId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error("invalidRevision");
    const change = scaffoldChangeSchema.parse(raw);
    const hash = digest(JSON.stringify(change));
    return this.serial(id, async () => {
      const bundle = await this.read(id);
      if (typeof bundle === "string") throw Error(bundle);
      const journal = bundle.scaffold ?? { revision: 0, items: [] };
      const receipts = bundle.scaffoldReceipts ?? {};
      const previous = receipts[eventId];
      if (previous) {
        if (previous.hash !== hash) throw Error("eventConflict");
        // 重放回当前权威状态，绝不能用旧回执重新展示已隐藏或失效的图。
        return journal;
      }
      if (journal.revision !== expectedRevision) throw Error("staleRevision");
      if (Object.keys(receipts).length >= 2000) throw Error("sessionLimit");
      const updated = scaffoldJournalSchema.parse(applyScaffoldChange(journal, bundle.record, change));
      await atomicWrite(this.file(id), JSON.stringify({ ...bundle, scaffold: updated,
        scaffoldReceipts: { ...receipts, [eventId]: { hash, revision: updated.revision } } }));
      return updated;
    });
  }
  async appendInquiry(id: string, raw: unknown, expectedRevision: number): Promise<InquiryJournal> {
    const parsed = inquiryEntrySchema.safeParse(raw);
    if (!parsed.success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error("invalidInquiry");
    const entry = parsed.data;
    return this.serial(id, async () => {
      const bundle = await this.read(id);
      if (typeof bundle === "string") throw Error(bundle);
      const journal = bundle.inquiry ?? { revision: 0, entries: [] };
      const previous = journal.entries.find(e => e.entryId === entry.entryId);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(entry)) throw Error("eventConflict");
        return journal;
      }
      if (journal.revision !== expectedRevision) throw Error("staleRevision");
      if (journal.entries.length >= 500) throw Error("sessionLimit");
      if (entry.evidenceIds.some(evidenceId => !bundle.record.submissions.some(e => e.submissionId === evidenceId))) throw Error("missingEvidence");
      if (entry.revises) {
        const target = journal.entries.find(e => e.entryId === entry.revises);
        if (!target) throw Error("missingRevisionTarget");
        if (target.kind !== entry.kind || journal.entries.some(e => e.revises === target.entryId)) throw Error("invalidRevisionTarget");
      }
      const updated = { revision: journal.revision + 1, entries: [...journal.entries, entry] };
      await atomicWrite(this.file(id), JSON.stringify({ ...bundle, inquiry: updated }));
      return updated;
    });
  }
  async save(raw: unknown, expectedRevision: number | null, decision?: TeachingDecision,
    options?: { signal?: AbortSignal }): Promise<SaveResult> {
    const parsed = workspaceRecordSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalidRecord" };
    const record = parsed.data;
    if (decision && (!teachingDecisionSchema.safeParse(decision).success
      || decision.problemId !== record.problem?.problemId || decision.problemRevision !== record.problem.statement.revision
      || !record.feedback.some(f => f.responseId === decision.responseId && f.turnId === decision.turnId
        && !f.contested && f.summary === decision.utterance))) return { ok: false, reason: "invalidDecision" };
    return this.serial(record.sessionId, async () => {
      if (options?.signal?.aborted) return { ok: false, reason: "aborted" };
      if (await exists(this.tombstone(record.sessionId))) return { ok: false, reason: "deleted" };
      const old = await this.read(record.sessionId);
      if (options?.signal?.aborted) return { ok: false, reason: "aborted" };
      if (old === "corrupt") return { ok: false, reason: "corruptExisting" };
      const hash = digest(JSON.stringify(decision ? { record, decision } : record));
      if (typeof old !== "string") {
        const previous = old.receipts[record.eventId];
        if (previous) return previous.hash === hash ? { ok: true, revision: previous.revision } : { ok: false, reason: "eventConflict" };
      }
      if (old === "missing" ? expectedRevision !== null || record.revision !== 0
        : expectedRevision !== old.record.revision || record.revision !== old.record.revision + 1) return { ok: false, reason: "staleRevision" };
      const receipts = old === "missing" ? {} : old.receipts;
      if (Object.keys(receipts).length >= 2000) return { ok: false, reason: "sessionLimit" };
      const media = old === "missing" ? [] : old.media;
      const problem = record.problem;
      if (problem?.source === "camera" && !media.some(m => m.id === problem.photoId && m.kind === "problemPhoto")) {
        return { ok: false, reason: "missingPhoto" };
      }
      if (record.submissions.some(s => !media.some(m => m.id === s.previewId && m.kind === "preview"))) return { ok: false, reason: "missingPreview" };
      const decisions = old === "missing" ? [] : old.teachingDecisions ?? [];
      if (decision && decisions.some(d => d.responseId === decision.responseId)) return { ok: false, reason: "eventConflict" };
      if (decision && decisions.length >= 1000) return { ok: false, reason: "sessionLimit" };
      const bundle: Bundle = { record, receipts: { ...receipts, [record.eventId]: { hash, revision: record.revision } }, media,
        ...(old !== "missing" && old.inquiry ? { inquiry: old.inquiry } : {}),
        ...(old !== "missing" && old.scaffold ? { scaffold: invalidateStaleScaffolds(old.scaffold, record) } : {}),
        ...(old !== "missing" && old.scaffoldReceipts ? { scaffoldReceipts: old.scaffoldReceipts } : {}),
        ...(decisions.length || decision ? { teachingDecisions: decision ? [...decisions, decision] : decisions } : {}) };
      await fs.mkdir(this.directory, { recursive: true });
      if (options?.signal?.aborted) return { ok: false, reason: "aborted" };
      try { await atomicWrite(this.file(record.sessionId), JSON.stringify(bundle), options?.signal); }
      catch (error) { if (error instanceof Error && error.message === "aborted") return { ok: false, reason: "aborted" }; throw error; }
      return { ok: true, revision: record.revision };
    });
  }
  async delete(id: string): Promise<void> {
    await this.serial(id, async () => {
      await fs.mkdir(this.directory, { recursive: true });
      // 先写墓碑；失败时不能删除数据或给成功回执。
      await atomicWrite(this.tombstone(id), JSON.stringify({ deletedAt: new Date().toISOString() }));
      await fs.rm(this.file(id), { force: true });
      // 只删除此会话服务器生成的媒体目录，不接受客户端路径。
      await fs.rm(path.join(this.directory, `${id}-media`), { recursive: true, force: true });
    });
  }
  async saveMedia(id: string, eventId: string, kind: "problemPhoto" | "preview", data: Buffer): Promise<string> {
    validId(eventId);
    if (data.length > 2 * 1024 * 1024) throw Error("mediaTooLarge");
    if (kind !== "problemPhoto" && kind !== "preview") throw Error("invalidKind");
    const png = data.length >= 33 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && data.toString("ascii", 12, 16) === "IHDR";
    const jpeg = data.length >= 4 && data[0] === 255 && data[1] === 216 && data[data.length - 2] === 255 && data[data.length - 1] === 217;
    if (!png && !jpeg) throw Error("invalidImage");
    return this.serial(id, async () => {
      if (await exists(this.tombstone(id))) throw Error("deleted");
      const bundle = await this.read(id);
      if (typeof bundle === "string") throw Error(bundle);
      const hash = digest(data);
      const previous = bundle.media.find(m => m.eventId === eventId);
      if (previous) {
        if (previous.hash !== hash || previous.kind !== kind) throw Error("eventConflict");
        return previous.id;
      }
      if (bundle.media.length >= 200) throw Error("sessionLimit");
      const mediaId = randomUUID();
      const directory = path.join(this.directory, `${id}-media`);
      await fs.mkdir(directory, { recursive: true });
      await atomicWrite(path.join(directory, mediaId), data);
      bundle.media.push({ id: mediaId, eventId, hash, kind, mime: png ? "image/png" : "image/jpeg" });
      await atomicWrite(this.file(id), JSON.stringify(bundle));
      return mediaId;
    });
  }
  async loadMedia(id: string, mediaId: string): Promise<{ data: Buffer; mime: string } | null> {
    validId(mediaId);
    const bundle = await this.read(id);
    if (typeof bundle === "string") return null;
    const entry = bundle.media.find(m => m.id === mediaId);
    if (!entry) return null;
    const data = await fs.readFile(path.join(this.directory, `${id}-media`, mediaId));
    if (digest(data) !== entry.hash) throw Error("corruptMedia");
    return { data, mime: entry.mime };
  }
}
