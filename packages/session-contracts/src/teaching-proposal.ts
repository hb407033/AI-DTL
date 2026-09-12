// 教学提案契约（设计稿 10.3）：三种桥接实现都只能输出这一种结构；本地校验器通过后才会呈现给孩子。
import { z } from "zod";

const point = z.object({ x: z.number(), y: z.number() });

// 语义对象的 kind 由学科插件定义，内核只认 id 与 owner；Agent 只能创建 owner 为 agent 的对象
export const semanticObjectSchema = z.object({
  id: z.string().min(1),
  owner: z.literal("agent"),
  kind: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
});

export const canvasActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsertObject"), object: semanticObjectSchema }),
  z.object({ kind: z.literal("highlight"), objectId: z.string().min(1) }),
  z.object({ kind: z.literal("point"), at: point }),
  z.object({ kind: z.literal("removeObject"), objectId: z.string().min(1) }),
]);

export const hintLevelSchema = z.number().int().min(0).max(5);

export const teachingProposalSchema = z.object({
  proposalId: z.string().min(1),
  spokenResponse: z.string(),
  canvasActions: z.array(canvasActionSchema).default([]),
  learnerTask: z.string().min(1),
  expectedEvidence: z.array(z.string()).default([]),
  hintLevel: hintLevelSchema,
  memoryCandidate: z.object({ description: z.string().min(1), evidenceEventIds: z.array(z.string()), hypothesisKeys: z.array(z.string()).optional() }).optional(),
});

export type SemanticObject = z.infer<typeof semanticObjectSchema>;
export type CanvasAction = z.infer<typeof canvasActionSchema>;
export type TeachingProposal = z.infer<typeof teachingProposalSchema>;
