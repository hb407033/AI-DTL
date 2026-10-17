import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { curriculumSchema, workspaceIdSchema, workspaceRecordSchema, inquiryEntrySchema, evidenceSchema, type WorkspaceRecord } from "@ai-scholar/session-contracts";
import { WorkspaceStore } from "../learning/workspace-store.js";
import { isRecognitionNotice, parsePhotoRecognition } from "./photo-recognition.js";

const mediaBody = z.strictObject({ eventId: workspaceIdSchema, kind: z.enum(["problemPhoto", "preview"]),
  base64: z.string().max(2800000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) });
const saveBody = z.strictObject({ expectedRevision: z.number().int().nonnegative().nullable(), record: workspaceRecordSchema });
const knownErrors: Record<string, number> = { invalidId: 400, invalidKind: 400, invalidImage: 400,
  mediaTooLarge: 413, deleted: 409, missing: 404, corrupt: 409, eventConflict: 409, sessionLimit: 409, corruptMedia: 409,
  invalidInquiry: 400, staleRevision: 409, missingEvidence: 409, missingRevisionTarget: 409, invalidRevisionTarget: 409 };

/** 局域网事实/媒体 API；本模块本身不初始化模型或录音。 */
export function registerWorkspaceRoutes(app: FastifyInstance, store: WorkspaceStore,
  options: { recognize?: (image: Buffer) => Promise<string> } = {}) {
  const recognizing = new Set<string>();
  app.get("/workspace/sessions", async (req, reply) => {
    const query = z.strictObject({ after: workspaceIdSchema.optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send({ reason: "invalidQuery" });
    try { return reply.header("Cache-Control", "no-store").send(await store.list(query.data)); }
    catch { return reply.code(500).send({ reason: "listFailed" }); }
  });
  app.post("/workspace/sessions", async (_req, reply) => {
    const record: WorkspaceRecord = { schemaVersion: 2, sessionId: randomUUID(), eventId: randomUUID(), revision: 0,
      problem: null, phase: "confirming", childInkBase64: "", board: { revision: 0, rectangles: [] },
      submissions: [], feedback: [], openQuestions: [] };
    try {
      const saved = await store.save(record, null);
      return saved.ok ? reply.code(201).send(record) : reply.code(409).send(saved);
    } catch { return reply.code(500).send({ ok: false, reason: "saveFailed" }); }
  });
  app.get<{ Params: { id: string } }>("/workspace/:id", async (req, reply) => {
    try {
      const loaded = await store.load(req.params.id);
      return loaded.status === "ok" ? loaded.record : reply.code(loaded.status === "missing" ? 404 : 409).send({ reason: loaded.status });
    } catch (error) { return reply.code(knownErrors[(error as Error).message] ?? 500).send({ reason: "loadFailed" }); }
  });
  app.put<{ Params: { id: string } }>("/workspace/:id", { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const parsed = saveBody.safeParse(req.body);
    if (!parsed.success || parsed.data.record.sessionId !== req.params.id) return reply.code(400).send({ reason: "invalidRecord" });
    try {
      const current = await store.load(req.params.id);
      if (current.status === "ok" && (JSON.stringify(current.record.problem) !== JSON.stringify(parsed.data.record.problem)
        || JSON.stringify(current.record.feedback) !== JSON.stringify(parsed.data.record.feedback)
        || JSON.stringify(current.record.submissions) !== JSON.stringify(parsed.data.record.submissions))) {
        return reply.code(409).send({ reason: "protectedLearningFacts" });
      }
      const saved = await store.save(parsed.data.record, parsed.data.expectedRevision);
      return saved.ok ? { ok: true, savedRevision: saved.revision } : reply.code(409).send(saved);
    } catch { return reply.code(500).send({ reason: "saveFailed" }); }
  });
  app.get<{ Params: { id: string } }>("/workspace/:id/inquiry", async (req, reply) => {
    try { return reply.header("Cache-Control", "no-store").send(await store.loadInquiry(req.params.id)); }
    catch (error) {
      const reason = (error as Error).message;
      return reply.code(knownErrors[reason] ?? 500).send({ reason: reason in knownErrors ? reason : "inquiryLoadFailed" });
    }
  });
  app.post<{ Params: { id: string } }>("/workspace/:id/evidence", async (req, reply) => {
    const parsed = z.strictObject({ eventId: workspaceIdSchema, expectedRevision: z.number().int().nonnegative(), evidence: evidenceSchema }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ reason: "invalidEvidence" });
    try {
      const loaded = await store.load(req.params.id);
      if (loaded.status !== "ok") return reply.code(loaded.status === "missing" ? 404 : 409).send({ reason: loaded.status });
      const current = loaded.record;
      const { evidence, eventId, expectedRevision } = parsed.data;
      const previous = current.submissions.find(e => e.submissionId === evidence.submissionId);
      if (previous) return JSON.stringify(previous) === JSON.stringify(evidence)
        ? reply.code(201).send(current) : reply.code(409).send({ reason: "eventConflict" });
      if (!current.problem?.statement.confirmed || current.problem.problemId !== evidence.problemId
        || current.problem.statement.revision !== evidence.problemRevision || current.revision !== expectedRevision) {
        return reply.code(409).send({ reason: "staleEvidence" });
      }
      const record = { ...current, eventId, revision: expectedRevision + 1, submissions: [...current.submissions, evidence] };
      const saved = await store.save(record, expectedRevision);
      return saved.ok ? reply.code(201).send(record) : reply.code(409).send(saved);
    } catch { return reply.code(500).send({ reason: "evidenceSaveFailed" }); }
  });
  app.post<{ Params: { id: string } }>("/workspace/:id/inquiry", async (req, reply) => {
    const parsed = z.strictObject({ expectedRevision: z.number().int().nonnegative(), entry: inquiryEntrySchema }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ reason: "invalidInquiry" });
    try { return reply.code(201).send(await store.appendInquiry(req.params.id, parsed.data.entry, parsed.data.expectedRevision)); }
    catch (error) {
      const reason = (error as Error).message;
      return reply.code(knownErrors[reason] ?? 500).send({ reason: reason in knownErrors ? reason : "inquirySaveFailed" });
    }
  });
  app.delete<{ Params: { id: string } }>("/workspace/:id", async (req, reply) => {
    try { await store.delete(req.params.id); return { ok: true }; }
    catch (error) { return reply.code(knownErrors[(error as Error).message] ?? 500).send({ reason: "deleteFailed" }); }
  });
  app.post<{ Params: { id: string } }>("/workspace/:id/media", { bodyLimit: 3 * 1024 * 1024 }, async (req, reply) => {
    const parsed = mediaBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ reason: "invalidMedia" });
    try {
      const { eventId, kind, base64 } = parsed.data;
      const mediaId = await store.saveMedia(req.params.id, eventId, kind, Buffer.from(base64, "base64"));
      return reply.code(201).send({ mediaId });
    } catch (error) {
      const reason = (error as Error).message;
      return reply.code(knownErrors[reason] ?? 500).send({ reason: reason in knownErrors ? reason : "mediaSaveFailed" });
    }
  });
  app.get<{ Params: { id: string; mediaId: string } }>("/workspace/:id/media/:mediaId", async (req, reply) => {
    try {
      const media = await store.loadMedia(req.params.id, req.params.mediaId);
      return media ? reply.type(media.mime).header("Cache-Control", "no-store").send(media.data) : reply.code(404).send({ reason: "missing" });
    } catch (error) { return reply.code(knownErrors[(error as Error).message] ?? 500).send({ reason: "mediaLoadFailed" }); }
  });
  app.post<{ Params: { id: string } }>("/workspace/:id/recognize", async (req, reply) => {
    const parsed = z.strictObject({ eventId: workspaceIdSchema, expectedRevision: z.number().int().nonnegative(),
      photoId: workspaceIdSchema, previewId: workspaceIdSchema.optional(), curriculum: curriculumSchema }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ reason: "invalidRequest" });
    if (!options.recognize) return reply.code(503).send({ reason: "recognitionUnavailable" });
    const id = req.params.id;
    if (recognizing.has(id)) return reply.code(409).send({ reason: "recognitionPending" });
  recognizing.add(id);
    try {
      const current = await store.load(id);
      if (current.status !== "ok") return reply.code(current.status === "missing" ? 404 : 409).send({ reason: current.status });
      const { eventId, expectedRevision, photoId, curriculum } = parsed.data;
      if (current.record.eventId === eventId) {
        const problem = current.record.problem;
        if (problem?.source !== "camera" || problem.photoId !== photoId || JSON.stringify(problem.curriculum) !== JSON.stringify(curriculum)) {
          return reply.code(409).send({ reason: "eventConflict" });
        }
        return current.record;
      }
      if (current.record.revision !== expectedRevision) return reply.code(409).send({ reason: "staleRevision" });
      const original = await store.loadMedia(id, photoId);
      const media = parsed.data.previewId ? await store.loadMedia(id, parsed.data.previewId) : original;
      if (!original || !media) return reply.code(404).send({ reason: "missingPhoto" });
      if (media.data.length > 180000) return reply.code(413).send({ reason: "modelPhotoTooLarge" });
      const recognition = parsePhotoRecognition(await options.recognize(media.data));
      if (recognition.status !== "single") return recognition;
      const text = recognition.candidates[0]!;
      const record: WorkspaceRecord = { ...current.record, revision: expectedRevision + 1, eventId, phase: "confirming",
        problem: { problemId: randomUUID(), source: "camera", photoId, curriculum,
          statement: { text, revision: 0, confirmed: false } } };
      const saved = await store.save(record, expectedRevision);
      return saved.ok ? record : reply.code(409).send(saved);
    } catch (error) { const reason = (error as Error).message; if (reason === "recognitionUnavailable") return reply.code(503).send({ reason: "recognitionUnavailable" }); return reply.code(502).send({ reason: "recognitionFailed" }); }
    finally { recognizing.delete(id); }
  });
  app.post<{ Params: { id: string } }>("/workspace/:id/question", async (req, reply) => {
    const parsed = z.strictObject({ eventId: workspaceIdSchema, expectedRevision: z.number().int().nonnegative(),
      photoId: workspaceIdSchema, curriculum: curriculumSchema, text: z.string().trim().min(1).max(8000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ reason: "invalidQuestion" });
    try {
      const loaded = await store.load(req.params.id);
      if (loaded.status !== "ok") return reply.code(loaded.status === "missing" ? 404 : 409).send({ reason: loaded.status });
      const { eventId, expectedRevision, photoId, curriculum, text } = parsed.data;
      if (isRecognitionNotice(text)) return reply.code(422).send({ reason: "recognitionNotice" });
      const current = loaded.record, p = current.problem;
      if (current.eventId === eventId) {
        return p?.source === "camera" && p.photoId === photoId && p.statement.text === text
          && JSON.stringify(p.curriculum) === JSON.stringify(curriculum)
          ? reply.code(201).send(current) : reply.code(409).send({ reason: "eventConflict" });
      }
      if (p || current.revision !== expectedRevision) return reply.code(409).send({ reason: "questionAlreadySet" });
      const record: WorkspaceRecord = { ...current, eventId, revision: expectedRevision + 1, phase: "confirming",
        problem: { source: "camera", problemId: randomUUID(), photoId, curriculum, statement: { text, revision: 0, confirmed: false } } };
      const saved = await store.save(record, expectedRevision);
      return saved.ok ? reply.code(201).send(record) : reply.code(409).send(saved);
    } catch { return reply.code(500).send({ reason: "questionSaveFailed" }); }
  });
  app.post<{ Params: { id: string } }>("/workspace/:id/statement", async (req, reply) => {
    const parsed = z.strictObject({ eventId: workspaceIdSchema, expectedRevision: z.number().int().nonnegative(),
      problemId: workspaceIdSchema, statementRevision: z.number().int().nonnegative(), text: z.string().trim().min(1).max(8000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ reason: "invalidRequest" });
    try {
      const current = await store.load(req.params.id);
      if (current.status !== "ok") return reply.code(409).send({ reason: current.status });
      const { eventId, expectedRevision, problemId, statementRevision, text } = parsed.data;
      const p = current.record.problem;
      if (isRecognitionNotice(text)) return reply.code(422).send({ reason: "recognitionNotice" });
      if (current.record.eventId === eventId) {
        return p?.problemId === problemId && p.statement.text === text && p.statement.revision === statementRevision + 1
          ? current.record : reply.code(409).send({ reason: "eventConflict" });
      }
      if (!p || p.problemId !== problemId || (p.statement.confirmed && !isRecognitionNotice(p.statement.text)) || p.statement.revision !== statementRevision)
        return reply.code(409).send({ reason: "staleProblem" });
      const record: WorkspaceRecord = { ...current.record, eventId, revision: expectedRevision + 1, phase: "confirming",
        feedback: p.statement.confirmed ? current.record.feedback.map(f => ({ ...f, contested: true })) : current.record.feedback,
        problem: { ...p, statement: { text, revision: statementRevision + 1, confirmed: false } } };
      const saved = await store.save(record, expectedRevision);
      return saved.ok ? record : reply.code(409).send(saved);
    } catch { return reply.code(500).send({ reason: "statementSaveFailed" }); }
  });
  app.post<{ Params: { id: string } }>("/workspace/:id/confirm", async (req, reply) => {
    const parsed = z.strictObject({ eventId: workspaceIdSchema, expectedRevision: z.number().int().nonnegative(),
      problemId: workspaceIdSchema, statementRevision: z.number().int().nonnegative() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ reason: "invalidRequest" });
    try {
      const current = await store.load(req.params.id);
      if (current.status !== "ok") return reply.code(current.status === "missing" ? 404 : 409).send({ reason: current.status });
      const { problemId, statementRevision, expectedRevision, eventId } = parsed.data;
      const problem = current.record.problem;
      if (problem && isRecognitionNotice(problem.statement.text)) return reply.code(422).send({ reason: "recognitionNotice" });
      if (!problem || problem.problemId !== problemId || problem.statement.revision !== statementRevision) return reply.code(409).send({ reason: "staleProblem" });
      if (current.record.eventId === eventId && problem.statement.confirmed) return current.record;
      const record: WorkspaceRecord = { ...current.record, eventId, revision: expectedRevision + 1,
        phase: "exploring", problem: { ...problem, statement: { ...problem.statement, confirmed: true } } };
      const saved = await store.save(record, expectedRevision);
      return saved.ok ? record : reply.code(409).send(saved);
    } catch { return reply.code(500).send({ reason: "confirmFailed" }); }
  });
}
