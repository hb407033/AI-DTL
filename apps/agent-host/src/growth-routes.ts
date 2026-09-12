import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { FIRST_USE_NOTICE, type GrowthLedgerService } from "@ai-scholar/learning-kernel";
import { mathPlugin } from "@ai-scholar/plugin-math";

const id = z.string().min(1).max(256);
const subjectSchema = z.object({ subjectKind: z.enum(["artifact", "growth_record"]), subjectId: id }).strict();
const decisionSchema = z.object({ decision: z.enum(["approved", "rejected"]) }).strict();
const empty = z.object({}).strict();
const subject = (value: z.infer<typeof subjectSchema>) => ({ kind: value.subjectKind, id: value.subjectId });

/** 账本操作仅使用服务端固定 learner，不经过教学宿主和 clientSeq。 */
export function registerGrowthRoutes(childApp: FastifyInstance, parentApp: FastifyInstance, ledger: GrowthLedgerService, learnerId = "child-1") {
  const child = ledger.childPort(), parent = ledger.parentPort();
  function post<T extends z.ZodType>(app: FastifyInstance, url: string, schema: T, action: (body: z.infer<T>, id: string) => unknown) {
    app.post(url, async (request, reply) => {
      const parsed = schema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalidBody", details: parsed.error.issues });
      try { return action(parsed.data, (request.params as { id?: string }).id ?? ""); }
      catch (error) { return failure(reply, error); }
    });
  }
  function failure(reply: FastifyReply, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("cannotOverrideChildContest") ? 403 : message.includes("forbiddenLabel") ? 400 : message.includes("NotFound") ? 404 : 409;
    return reply.code(status).send({ error: message });
  }
  childApp.get("/child/understanding", async () => child.understanding(learnerId, mathPlugin.manifest));
  childApp.get("/child/first-use-notice", async () => ({ version: 1, text: FIRST_USE_NOTICE, acknowledged: child.firstUseAcknowledged(learnerId) }));
  post(childApp, "/child/first-use-notice/ack", z.object({ version: z.literal(1) }).strict(), () => { child.acknowledgeFirstUse(learnerId); return { acknowledged: true }; });
  post(childApp, "/child/contest", z.object({ target: z.object({ kind: z.enum(["proposal", "hypothesis", "candidate", "record", "session"]), id }).strict() }).strict(), ({ target }) => child.contest({ learnerId, target, sessionId: target.kind === "session" ? target.id : "", runId: null, eventId: randomUUID() }));
  post(childApp, "/child/deletion-preview", subjectSchema, body => child.deletionPreview(learnerId, subject(body)));
  post(childApp, "/child/deletion-requests", subjectSchema, body => child.requestDeletion(learnerId, subject(body)));
  childApp.get("/child/deletion-requests", async () => child.deletionRequests(learnerId));
  post(childApp, "/child/deletion-requests/:id/withdraw", empty, (_, requestId) => { child.withdrawDeletion(learnerId, requestId); return { ok: true }; });
  childApp.get("/child/notifications", async () => child.notifications(learnerId));
  post(childApp, "/child/notifications/:id/read", empty, (_, notificationId) => { child.readNotification(learnerId, notificationId); return { ok: true }; });

  parentApp.get("/parent/growth/candidates", async () => parent.candidates(learnerId));
  parentApp.get("/parent/growth/pending", async () => parent.pendingReviews(learnerId, mathPlugin.manifest));
  parentApp.get("/parent/artifacts/:id", async (request, reply) => {
    const evidence = parent.artifactEvidence(learnerId, (request.params as { id: string }).id);
    return evidence ?? reply.code(404).send({ error: "artifactNotFound" });
  });
  parentApp.get("/parent/growth/records", async () => parent.records(learnerId));
  post(parentApp, "/parent/growth/records/:id/narrow-scope", z.object({ toBandIndex: z.number().int().nonnegative().optional(), toSurfaceContextKey: id.optional() }).strict().refine(body => body.toBandIndex !== undefined || body.toSurfaceContextKey !== undefined), (body, recordId) => parent.narrowScope(learnerId, recordId, {
    ...(body.toBandIndex === undefined ? {} : { toBandIndex: body.toBandIndex }),
    ...(body.toSurfaceContextKey === undefined ? {} : { toSurfaceContextKey: body.toSurfaceContextKey }),
  }));
  post(parentApp, "/parent/growth/records/:id/downgrade", empty, (_, recordId) => parent.downgrade(learnerId, recordId));
  post(parentApp, "/parent/growth/records/:id/retract", empty, (_, recordId) => parent.retract(learnerId, recordId));
  parentApp.get("/parent/export", async () => parent.exportArchive(learnerId));
  parentApp.get("/parent/growth/agent-view", async () => parent.agentView(learnerId));
  post(parentApp, "/parent/signals/:id/ack", empty, (_, signalId) => { parent.acknowledgeAlert(learnerId, signalId); return { ok: true }; });
  post(parentApp, "/parent/growth/candidates/:id/review", decisionSchema.extend({ parentNote: z.string().max(2000).optional() }).strict(), (body, candidateId) => parent.review(learnerId, candidateId, body.decision, body.parentNote));
  parentApp.get("/parent/growth/trends", async () => parent.trends(learnerId));
  parentApp.get("/parent/growth/alerts", async () => parent.alerts(learnerId));
  parentApp.get("/parent/deletion-requests", async () => parent.deletionRequests(learnerId));
  post(parentApp, "/parent/deletion-requests/:id/resolve", decisionSchema, (body, requestId) => parent.resolveDeletion(learnerId, requestId, body.decision));
  const previews = new Map<string, ReturnType<typeof parent.deletionPreview>>();
  parentApp.get("/parent/deletion-preview", async (request, reply) => {
    const parsed = subjectSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalidQuery" });
    try {
      const result = parent.deletionPreview(learnerId, subject(parsed.data));
      previews.set(JSON.stringify(subject(parsed.data)), result);
      return result;
    } catch (error) { return failure(reply, error); }
  });
  post(parentApp, "/parent/deletion", subjectSchema.extend({ previewComputedAt: z.number().int().nonnegative() }).strict(), body => {
    const key = JSON.stringify(subject(body)), preview = previews.get(key);
    if (!preview || preview.previewComputedAt !== body.previewComputedAt) throw new Error("parent.deletionPreviewStale");
    const result = parent.executeDeletion(learnerId, subject(body), preview.preview);
    previews.delete(key);
    return result;
  });
}
