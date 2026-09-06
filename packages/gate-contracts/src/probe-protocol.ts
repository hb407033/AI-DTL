// 阶段 0 局域网探针协议 v1：iPad ⇄ Mac 网关的 JSON 文本帧。
// 每条消息都带 protocolVersion，主版本不匹配直接拒绝；客户端消息带 id（幂等键）与 clientSeq（会话内单调递增）。
import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

const envelope = { protocolVersion: z.literal(PROTOCOL_VERSION) };
const clientEnvelope = {
  ...envelope,
  id: z.string().min(1),
  clientSeq: z.number().int().positive(),
  sessionId: z.string().min(1),
  sentAt: z.number().int().nonnegative(),
};

export const pingSchema = z.object({ ...clientEnvelope, type: z.literal("ping") });
export const requestSemanticActionSchema = z.object({ ...clientEnvelope, type: z.literal("requestSemanticAction") });
export const clientMessageSchema = z.discriminatedUnion("type", [pingSchema, requestSemanticActionSchema]);

export const semanticOwnerSchema = z.enum(["agent", "child", "source"]);
export const semanticCircleSchema = z.object({
  id: z.string().min(1),
  owner: semanticOwnerSchema,
  center: z.object({ x: z.number(), y: z.number() }),
  radius: z.number().positive(),
});
export const semanticActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsertCircle"), circle: semanticCircleSchema }),
]);

export const ackSchema = z.object({
  ...envelope,
  type: z.literal("ack"),
  id: z.string().min(1),
  clientSeq: z.number().int().positive(),
  serverReceivedAt: z.number().int().nonnegative(),
});
export const nackSchema = z.object({
  ...envelope,
  type: z.literal("nack"),
  reason: z.enum(["seqGap"]),
  expectedSeq: z.number().int().positive(),
});
export const semanticActionMessageSchema = z.object({
  ...envelope,
  type: z.literal("semanticAction"),
  id: z.string().min(1),
  inReplyTo: z.string().min(1),
  action: semanticActionSchema,
});
export const errorMessageSchema = z.object({
  ...envelope,
  type: z.literal("error"),
  reason: z.string().min(1),
  id: z.string().optional(),
});
export const serverMessageSchema = z.discriminatedUnion("type", [
  ackSchema,
  nackSchema,
  semanticActionMessageSchema,
  errorMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type SemanticCircle = z.infer<typeof semanticCircleSchema>;
