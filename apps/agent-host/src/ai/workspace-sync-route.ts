// iPad 把一轮的作品、决策、回合和用量推过来。批次只有在这些都写完后才记成 applied。
// 409 和中途失败都不能把批次记成已消费，否则重放会被当成重复，数据就丢了。
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { workspaceIdSchema, workspaceRecordSchema, type WorkspaceRecord } from "@ai-scholar/session-contracts";
import { teachingDecisionSchema, type TeachingDecision } from "../learning/teaching-decision.js";
import { WorkspaceStore } from "../learning/workspace-store.js";

const forbiddenKey = /^(?:pcm|audio|recording|apiKey|audioBase64)$/;
const usageEntry = z.strictObject({
  sessionId: z.string().min(1).max(80),
  turnId: z.string().min(1).max(80),
  callId: z.string().min(1).max(80),
  responseId: z.string().min(1).max(80).optional(),
  purpose: z.enum(["transcription", "teaching", "decision"]),
  model: z.string().min(1).max(120),
  status: z.enum(["completed", "failed", "cancelled"]),
  usage: z.record(z.string(), z.unknown()).nullable(),
  estimatedCostCny: z.number().nullable(),
  latencyMs: z.number().int().nonnegative().optional(),
  path: z.enum(["fast", "slow", "none"]).optional(),
});
const turnEntry = z.object({
  turnId: z.string().min(1).max(80),
  transcript: z.string().max(4000).optional(),
  kind: z.string().max(40).optional(),
  utterance: z.string().max(500).optional(),
  played: z.boolean().optional(),
  path: z.enum(["fast", "slow", "none"]).optional(),
  gateReason: z.string().max(80).optional(),
  latencyMs: z.number().optional(),
}).strict();
const syncBody = z.strictObject({
  batchId: workspaceIdSchema,
  record: workspaceRecordSchema,
  expectedRevision: z.number().int().nonnegative(),
  decisions: z.array(teachingDecisionSchema).max(20),
  turns: z.array(turnEntry).max(40),
  usage: z.array(usageEntry).max(40),
});

export type SyncApplyResult =
  | { status: 200; body: { applied: true; revision: number } | { applied: false; duplicate: true } }
  | { status: 400; body: { reason: string } }
  | { status: 409; body: { reason: "revisionConflict" } }
  | { status: 500; body: { reason: string } };

function hasForbidden(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKey.test(key)) return true;
    if (hasForbidden(child)) return true;
  }
  return false;
}

async function readLines(file: string): Promise<string[]> {
  try { return (await readFile(file, "utf8")).split("\n").filter(line => line.trim()); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function appendNew(file: string, rows: unknown[], idOf: (row: Record<string, unknown>) => string | undefined) {
  const seen = new Set<string>();
  for (const line of await readLines(file)) {
    try {
      const id = idOf(JSON.parse(line) as Record<string, unknown>);
      if (id) seen.add(id);
    } catch { /* 坏行不参与去重，也不能挡住新行。 */ }
  }
  const fresh = rows.filter(row => {
    const id = idOf(row as Record<string, unknown>);
    return !!id && !seen.has(id);
  });
  if (!fresh.length) return;
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, fresh.map(row => JSON.stringify(row)).join("\n") + "\n");
}

function withFeedback(record: WorkspaceRecord, decisions: TeachingDecision[]): WorkspaceRecord {
  const feedback = [...record.feedback];
  for (const decision of decisions) {
    if (!feedback.some(item => item.responseId === decision.responseId && item.turnId === decision.turnId && item.summary === decision.utterance && !item.contested)) {
      feedback.push({ responseId: decision.responseId, turnId: decision.turnId, summary: decision.utterance, contested: false });
    }
  }
  return { ...record, feedback };
}

export async function applyWorkspaceSync(store: WorkspaceStore, sessionId: string, raw: unknown,
  options: { usageFile?: string; failAfterDecisions?: number } = {}): Promise<SyncApplyResult> {
  if (hasForbidden(raw)) return { status: 400, body: { reason: "recordingNotAllowed" } };
  const parsed = syncBody.safeParse(raw);
  if (!parsed.success || parsed.data.record.sessionId !== sessionId) return { status: 400, body: { reason: "invalidBatch" } };
  const body = parsed.data;
  const usageFile = options.usageFile ?? path.join(store.directory, "usage.jsonl");
  const turnsFile = path.join(store.directory, `${sessionId}-turns.jsonl`);
  try {
    return await store.withSessionLock(sessionId, async () => {
      const phase = await store.readSyncBatch(sessionId, body.batchId);
      if (phase === "applied") return { status: 200, body: { applied: false as const, duplicate: true as const } };
      const loaded = await store.load(sessionId);
      if (loaded.status === "corrupt") return { status: 409, body: { reason: "revisionConflict" as const } };
      const current = loaded.status === "ok" ? loaded.record.revision : null;
      // 还没开始写时，版本不对就直接拒绝，台账里不能留下这批。
      if (phase === "missing") {
        const matches = current === null ? body.expectedRevision === 0 && body.record.revision === body.decisions.length
          : current === body.expectedRevision;
        if (!matches) return { status: 409, body: { reason: "revisionConflict" as const } };
      }
      const proceed = await store.recordSyncBatch(sessionId, body.batchId);
      if (!proceed) return { status: 200, body: { applied: false as const, duplicate: true as const } };
      const existing = loaded.status === "ok" ? await store.loadTeachingDecisions(sessionId) : [];
      const known = new Set(existing.map(item => item.responseId));
      let revision = current;
      const record = withFeedback(body.record, body.decisions);
      for (let index = 0; index < body.decisions.length; index++) {
        const decision = body.decisions[index]!;
        if (known.has(decision.responseId)) continue;
        const nextRevision = revision === null ? 0 : revision + 1;
        const snapshot: WorkspaceRecord = {
          ...record,
          revision: nextRevision,
          eventId: `${index}-${body.batchId}`.slice(0, 80),
        };
        const expected = revision === null && nextRevision === 0 ? null : revision;
        const saved = await store.save(snapshot, expected, decision);
        if (!saved.ok) {
          // 已经记了 pending。这里返回 500，让同一 batchId 重放把没写完的补上，而不是 409 把批次吞掉。
          return { status: 500, body: { reason: saved.reason } };
        }
        known.add(decision.responseId);
        revision = saved.revision;
        if (options.failAfterDecisions !== undefined && known.size >= options.failAfterDecisions && index < body.decisions.length - 1) {
          throw Error("injectedFailure");
        }
      }
      if (options.failAfterDecisions !== undefined && body.decisions.length >= options.failAfterDecisions && body.turns.length) {
        const turnsExist = (await readLines(turnsFile)).length;
        if (turnsExist === 0) throw Error("injectedFailure");
      }
      await appendNew(turnsFile, body.turns, row => typeof row.turnId === "string" ? row.turnId : undefined);
      await appendNew(usageFile, body.usage.map(entry => ({ ...entry, ts: Date.now() })), row => typeof row.callId === "string" ? row.callId : undefined);
      if (revision === null && body.decisions.length === 0) {
        const saved = await store.save({ ...record, revision: 0, eventId: body.batchId }, null);
        if (!saved.ok) return { status: 500, body: { reason: saved.reason } };
        revision = saved.revision;
      }
      await store.markSyncBatch(sessionId, body.batchId, "applied");
      return { status: 200, body: { applied: true, revision: revision ?? 0 } };
    });
  } catch (error) {
    const reason = error instanceof Error && error.message === "injectedFailure" ? "injectedFailure" : "syncFailed";
    return { status: 500, body: { reason } };
  }
}

export function registerWorkspaceSync(app: FastifyInstance, store: WorkspaceStore, usageFile?: string) {
  app.post<{ Params: { id: string } }>("/workspace/:id/sync", { bodyLimit: 2 * 1024 * 1024, logLevel: "silent" }, async (req, reply) => {
    const result = await applyWorkspaceSync(store, req.params.id, req.body, usageFile ? { usageFile } : {});
    return reply.code(result.status).header("cache-control", "no-store").send(result.body);
  });
}
