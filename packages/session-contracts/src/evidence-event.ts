// 证据事件契约（设计稿 10.2）：儿童端产生、宿主确认。payload 按 type 区分；
// quality 表示转写/识别的离散质量，只有 confirmed/corrected 才能参与证据计数。
import { z } from "zod";

export const SESSION_PROTOCOL_VERSION = 1 as const;

export const evidenceQualitySchema = z.enum(["unconfirmed", "confirmed", "corrected"]);
export const evidenceSourceSchema = z.enum(["child_touch", "child_voice", "child_button", "parent_button", "system"]);
const point = z.object({ x: z.number(), y: z.number() });

export const eventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("UTTERANCE"), text: z.string() }),
  // 高频触控点在客户端先聚合成一条语义笔画；contentHash 用于识别“擦掉后重画相同内容”
  z.object({
    type: z.literal("STROKE"), strokeId: z.string().min(1), contentHash: z.string().min(1),
    bounds: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }),
  }),
  z.object({ type: z.literal("SELECT"), objectId: z.string().min(1) }),
  z.object({ type: z.literal("DRAG"), objectId: z.string().min(1), to: point }),
  z.object({ type: z.literal("ERASE"), strokeId: z.string().min(1), contentHash: z.string().min(1) }),
  z.object({ type: z.literal("ANSWER"), text: z.string() }),
  z.object({ type: z.literal("EXPLAIN"), text: z.string() }),
  z.object({ type: z.literal("HELP_REQUEST") }),
  z.object({ type: z.literal("PAUSE_REQUEST"), by: z.enum(["child", "parent"]) }),
  z.object({ type: z.literal("RESUME_REQUEST") }),
  z.object({ type: z.literal("CONTEST"), targetId: z.string().optional() }),
  z.object({ type: z.literal("DONE") }),
  z.object({ type: z.literal("CONFIRM_TRANSCRIPT"), targetEventId: z.string().min(1), confirmed: z.boolean(), correctedText: z.string().optional() }),
  z.object({ type: z.literal("SOFT_LANDING_CHOICE"), choice: z.enum(["simpler", "hint", "stop"]) }),
  z.object({ type: z.literal("MEMORY_ASSENT"), choice: z.enum(["record", "unsure", "disagree"]) }),
]);

export const evidenceEventSchema = z.object({
  eventId: z.string().min(1),
  clientSessionId: z.string().min(1),
  deviceId: z.string().min(1),
  clientSeq: z.number().int().positive(),
  occurredAt: z.number().int().nonnegative(),
  quality: evidenceQualitySchema,
  source: evidenceSourceSchema,
  semanticObjectIds: z.array(z.string()).default([]),
  artifactVersion: z.string().optional(),
  payload: eventPayloadSchema,
});

export type EvidenceEvent = z.infer<typeof evidenceEventSchema>;
export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type EventType = EventPayload["type"];
export type EvidenceQuality = z.infer<typeof evidenceQualitySchema>;
