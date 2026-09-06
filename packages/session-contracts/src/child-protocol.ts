// 儿童端 ⇄ 宿主 的 WebSocket 帧。客户端帧携带幂等 id 与会话内单调 clientSeq（沿用阶段 0 探针协议语义）；
// 宿主对每帧回 ack 或 nack，教学输出以 outbound 帧推送。儿童端只会看到这些字段，绝不包含模型内部信息。
import { z } from "zod";
import { SESSION_PROTOCOL_VERSION, evidenceEventSchema } from "./evidence-event.js";
import { canvasActionSchema, hintLevelSchema } from "./teaching-proposal.js";

const envelope = { protocolVersion: z.literal(SESSION_PROTOCOL_VERSION) };

export const clientFrameSchema = z.object({
  ...envelope,
  type: z.literal("event"),
  id: z.string().min(1),
  clientSeq: z.number().int().positive(),
  sessionId: z.string().min(1),
  sentAt: z.number().int().nonnegative(),
  event: evidenceEventSchema,
});

export const childOutboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("speak"), id: z.string().min(1), text: z.string(), hintLevel: hintLevelSchema, interruptible: z.literal(true) }),
  z.object({ type: z.literal("canvasAction"), id: z.string().min(1), action: canvasActionSchema }),
  z.object({ type: z.literal("learnerTask"), id: z.string().min(1), text: z.string().min(1) }),
  z.object({ type: z.literal("stateChanged"), id: z.string().min(1), state: z.string().min(1), hintLevel: hintLevelSchema, presence: z.enum(["listening", "waiting", "paused"]) }),
  z.object({ type: z.literal("confirmTranscript"), id: z.string().min(1), targetEventId: z.string().min(1), text: z.string() }),
  z.object({ type: z.literal("softLanding"), id: z.string().min(1), message: z.string(), options: z.array(z.enum(["simpler", "hint", "stop"])) }),
  z.object({ type: z.literal("notice"), id: z.string().min(1), text: z.string() }),
]);

export const serverFrameSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("ack"), id: z.string().min(1), clientSeq: z.number().int().positive(), serverReceivedAt: z.number().int().nonnegative() }),
  z.object({ ...envelope, type: z.literal("nack"), reason: z.enum(["seqGap", "payloadConflict"]), expectedSeq: z.number().int().positive() }),
  z.object({ ...envelope, type: z.literal("outbound"), message: childOutboundSchema }),
  z.object({ ...envelope, type: z.literal("error"), reason: z.string().min(1), id: z.string().optional() }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;
export type ChildOutbound = z.infer<typeof childOutboundSchema>;
export type ServerFrame = z.infer<typeof serverFrameSchema>;
