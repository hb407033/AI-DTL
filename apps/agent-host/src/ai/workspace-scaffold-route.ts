import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { lineUnderstandingSchema, workspaceIdSchema, type LineScaffoldState, type WorkspaceRecord } from "@ai-scholar/session-contracts";
import { WorkspaceStore } from "../learning/workspace-store.js";

export interface ScaffoldContext {
  problem: string;
  expression: string;
  curriculum: NonNullable<WorkspaceRecord["problem"]>["curriculum"];
}
export interface LineScaffoldProvider {
  understand(context: ScaffoldContext, signal: AbortSignal): Promise<unknown>;
  generate(context: ScaffoldContext, offer: LineScaffoldState, signal: AbortSignal): Promise<unknown>;
}
const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("consent"), offerId: workspaceIdSchema }),
  z.strictObject({ type: z.literal("select"), offerId: workspaceIdSchema, selectedParts: z.array(z.number().int().min(0).max(19)).max(20) }),
  z.strictObject({ type: z.literal("hide"), offerId: workspaceIdSchema }),
  z.strictObject({ type: z.literal("invalidate"), offerId: workspaceIdSchema }),
]);
const actionBody = z.strictObject({ eventId: workspaceIdSchema, expectedRevision: z.number().int().nonnegative(), action: actionSchema });

/** 邀请仅供已完成 help 的语音链调用，HTTP 不允许客户端提交模型提案或伪造生成结果。 */
export class WorkspaceScaffoldService {
  private pending = new Map<string, AbortController>();
  constructor(private store: WorkspaceStore, private provider: LineScaffoldProvider) {}
  close() { for (const c of this.pending.values()) c.abort(); this.pending.clear(); }
  private async context(id: string, submissionId: string): Promise<ScaffoldContext> {
    const loaded = await this.store.load(id);
    if (loaded.status !== "ok") throw Error(loaded.status);
    const evidence = loaded.record.submissions.find(e => e.submissionId === submissionId);
    if (!evidence || !loaded.record.problem?.statement.confirmed) throw Error("staleBasis");
    return { problem: loaded.record.problem.statement.text, expression: evidence.explanation,
      curriculum: loaded.record.problem.curriculum };
  }
  async offerAfterHelp(id: string, submissionId: string, responseId: string, signal?: AbortSignal) {
    if (this.pending.has(id)) throw Error("scaffoldBusy");
    const loaded = await this.store.load(id);
    if (loaded.status !== "ok" || !loaded.record.problem) throw Error("missing");
    const journal = await this.store.loadScaffold(id);
    if (this.pending.has(id)) throw Error("scaffoldBusy");
    if (signal?.aborted) throw Error("scaffoldCancelled");
    const controller = new AbortController(); this.pending.set(id, controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const raw = await this.provider.understand(await this.context(id, submissionId), controller.signal);
      if (raw === null) return journal;
      if (controller.signal.aborted) throw Error("scaffoldCancelled");
      return await this.store.changeScaffold(id, randomUUID(), journal.revision, {
        type: "offer", offerId: randomUUID(), basis: { problemId: loaded.record.problem.problemId,
          problemRevision: loaded.record.problem.statement.revision, submissionId, responseId },
        understanding: lineUnderstandingSchema.parse(raw),
      });
    } finally { signal?.removeEventListener("abort", abort); if (this.pending.get(id) === controller) this.pending.delete(id); }
  }
  async act(id: string, raw: unknown) {
    const { eventId, expectedRevision, action } = actionBody.parse(raw);
    if (action.type === "invalidate") this.pending.get(id)?.abort();
    if (action.type === "consent" && this.pending.has(id)) throw Error("scaffoldBusy");
    const journal = await this.store.changeScaffold(id, eventId, expectedRevision, action);
    const offer = journal.items.find(item => item.offerId === action.offerId);
    if (action.type !== "consent" || offer?.status !== "consented") return journal;
    // 写锁等待期间另一份同意可能已经进入生成；必须在最后一次 await 后再检查。
    if (this.pending.has(id)) throw Error("scaffoldBusy");
    const controller = new AbortController(); this.pending.set(id, controller);
    try {
      const line = await this.provider.generate(await this.context(id, offer.basis.submissionId), offer, controller.signal);
      if (controller.signal.aborted) throw Error("scaffoldCancelled");
      return await this.store.changeScaffold(id, `generated-${createHash("sha256").update(eventId).digest("hex").slice(0, 40)}`,
        journal.revision, { type: "generate", offerId: offer.offerId, line });
    } finally { if (this.pending.get(id) === controller) this.pending.delete(id); }
  }
}

export function registerWorkspaceScaffold(app: FastifyInstance, store: WorkspaceStore, service: WorkspaceScaffoldService) {
  const known: Record<string, number> = { missing: 404, corrupt: 409, invalidId: 400, staleRevision: 409,
    staleBasis: 409, staleOffer: 409, eventConflict: 409, missingOffer: 409, notVisible: 409,
    scaffoldBusy: 409, scaffoldCancelled: 409, invalidSelection: 400, sessionLimit: 409 };
  app.get<{ Params: { id: string } }>("/workspace/:id/scaffold", async (req, reply) => {
    try { return reply.header("Cache-Control", "no-store").send(await store.loadScaffold(req.params.id)); }
    catch (e) { const reason = (e as Error).message; return reply.code(known[reason] ?? 500).send({ reason: reason in known ? reason : "scaffoldLoadFailed" }); }
  });
  app.post<{ Params: { id: string } }>("/workspace/:id/scaffold", async (req, reply) => {
    const parsed = actionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ reason: "invalidScaffoldAction" });
    try { return await service.act(req.params.id, parsed.data); }
    catch (e) { const reason = (e as Error).message; return reply.code(known[reason] ?? 502).send({ reason: reason in known ? reason : "scaffoldGenerationFailed" }); }
  });
  app.addHook("onClose", async () => service.close());
}
