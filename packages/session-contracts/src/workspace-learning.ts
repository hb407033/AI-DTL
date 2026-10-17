import { z } from "zod";
import { fractionBoardSchema } from "./fraction-learning.js";

export const workspaceIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,80}$/);
const revision = z.number().int().nonnegative();
const text = z.string().trim().min(1).max(4000);
export const curriculumSchema = z.strictObject({ edition: z.literal("人教版"), grade: z.literal(5),
  term: z.literal("上"), currentUnit: z.string().trim().min(1).max(80) });
const commonProblem = { problemId: workspaceIdSchema, curriculum: curriculumSchema,
  statement: z.strictObject({ text: z.string().trim().min(1).max(8000), revision, confirmed: z.boolean() }) };
export const problemSchema = z.discriminatedUnion("source", [
  z.strictObject({ ...commonProblem, source: z.literal("camera"), photoId: workspaceIdSchema }),
  z.strictObject({ ...commonProblem, source: z.literal("curated"), challengeId: workspaceIdSchema, packVersion: text }),
]);
export type Problem = z.infer<typeof problemSchema>;
export type Curriculum = z.infer<typeof curriculumSchema>;
export const teachingActionSchema = z.enum(["express", "clarify", "review", "help", "correct", "uncertain"]);
export type TeachingAction = z.infer<typeof teachingActionSchema>;
/** 客户端观察到的笔画差分事实；计数/间隔为有界累计值，顺序保留最近 256 个事件。 */
export const workspaceProcessSignalSchema = z.strictObject({
  eraseCount: z.number().int().min(0).max(10000),
  longestPauseMs: z.number().int().min(0).max(3600000),
  strokeOrder: z.array(z.string().max(80).regex(/^(?:stroke|erase):[A-Za-z0-9-]{1,73}$/)).max(256),
});
export type WorkspaceProcessSignal = z.infer<typeof workspaceProcessSignalSchema>;
export const evidenceSchema = z.strictObject({ submissionId: workspaceIdSchema, problemId: workspaceIdSchema,
  problemRevision: revision, boardRevision: revision, previewId: workspaceIdSchema,
  explanation: z.string().max(4000), processSignal: workspaceProcessSignalSchema.optional() });
export type Evidence = z.infer<typeof evidenceSchema>;
export const turnDecisionSchema = z.strictObject({ action: teachingActionSchema, quote: z.string().max(4000) });
export const turnRefSchema = z.strictObject({ sessionId: workspaceIdSchema, turnId: workspaceIdSchema, problemId: workspaceIdSchema });
const envelope = { schemaVersion: z.literal(2), eventId: workspaceIdSchema, sessionId: workspaceIdSchema, expectedRevision: revision };
export const workspaceCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ schemaVersion: z.literal(2), type: z.literal("hello"), sessionId: workspaceIdSchema.optional(), conversationMode: z.enum(["independent", "dialogue"]).optional() }),
  z.strictObject({ ...envelope, type: z.literal("setProblem"), problem: problemSchema.refine(p => p.source !== "camera" || !p.statement.confirmed) }),
  z.strictObject({ ...envelope, type: z.literal("confirmProblem"), problemId: workspaceIdSchema, statementRevision: revision }),
  z.strictObject({ ...envelope, type: z.literal("voiceStart"), turnId: workspaceIdSchema, problemId: workspaceIdSchema }),
  z.strictObject({ ...envelope, type: z.literal("voiceEnd"), turnId: workspaceIdSchema, problemId: workspaceIdSchema }),
  z.strictObject({ ...envelope, type: z.literal("startDiscussion"), turnId: workspaceIdSchema, evidence: evidenceSchema }),
  z.strictObject({ ...envelope, type: z.literal("authorize"), turnId: workspaceIdSchema,
    action: z.enum(["clarify", "review", "help", "correct"]), evidence: evidenceSchema.optional() })
    .refine(e => !["review", "help"].includes(e.action) || !!e.evidence),
  z.strictObject({ schemaVersion: z.literal(2), type: z.literal("interrupt"), sessionId: workspaceIdSchema, turnId: workspaceIdSchema }),
]);
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;
export const workspaceRecordSchema = z.strictObject({
  schemaVersion: z.literal(2), sessionId: workspaceIdSchema, eventId: workspaceIdSchema, revision,
  problem: problemSchema.nullable(), phase: z.enum(["confirming", "exploring", "paused", "finished"]),
  childInkBase64: z.string().max(6000000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  board: fractionBoardSchema,
  submissions: z.array(evidenceSchema).max(1000),
  feedback: z.array(z.strictObject({ responseId: workspaceIdSchema, turnId: workspaceIdSchema,
    summary: z.string().max(4000), contested: z.boolean() })).max(1000),
  openQuestions: z.array(text).max(100),
}).refine(r => r.phase !== "exploring" || r.problem?.statement.confirmed === true,
  "探索需要已确认题意");
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;
