// 与本机 Codex 版本严格绑定的最小实验协议契约。只定义本探针实际用到的请求与通知，不复制整份协议。
// 依据：本机 0.154.0 generate-json-schema（含 --experimental 请求参数）的最小字段核对，
// 2026-09-13：start、appendText/Audio、stop、通知的必填字段仍兼容；不推断账户具备实时权限。
// 版本变化先阻断、重校本文件，再运行探针。
import { z } from "zod";

export const CODEX_VERSION = "0.154.0";
export const CODEX_SOURCE_TAG = "rust-v0.154.0";
export const V2_SCHEMA_SHA256 = "f3487938786b729cb6773dbc9e83a7efab9c78c845db7094e8f539f373cbacc9";

// account/read
export const accountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chatgpt"), email: z.string().nullable(), planType: z.string() }),
  z.object({ type: z.literal("apiKey") }),
  z.object({ type: z.literal("amazonBedrock"), usesCodexManagedCredentials: z.boolean().optional() }),
]);
export const getAccountResponseSchema = z.object({ account: accountSchema.nullable().optional(), requiresOpenaiAuth: z.boolean() });

// account/rateLimits/read（只取用到的字段，其余透传）
export const rateLimitWindowSchema = z.object({ usedPercent: z.number(), windowDurationMins: z.number().nullable().optional(), resetsAt: z.number().nullable().optional() });
export const rateLimitSnapshotSchema = z.object({
  limitId: z.string().nullable().optional(),
  limitName: z.string().nullable().optional(),
  primary: rateLimitWindowSchema.nullable().optional(),
  secondary: rateLimitWindowSchema.nullable().optional(),
  planType: z.string().nullable().optional(),
}).passthrough();
export const getAccountRateLimitsResponseSchema = z.object({ rateLimits: rateLimitSnapshotSchema.nullable().optional() }).passthrough();

// thread/start 响应（只取 thread.id）
export const threadStartResponseSchema = z.object({ thread: z.object({ id: z.string() }).passthrough() }).passthrough();

// thread/realtime/* 请求参数（serde: camelCase 字段，枚举 snake_case）
export type RealtimeOutputModality = "text" | "audio";
export type RealtimeConversationVersion = "v1" | "v2" | "v3";
export interface ThreadRealtimeStartParams {
  threadId: string;
  outputModality: RealtimeOutputModality;
  transport?: { type: "websocket" } | { type: "webrtc"; sdp: string } | { type: "existingCall"; callId: string };
  voice?: string;
  version?: RealtimeConversationVersion;
  prompt?: string | null;
  includeStartupContext?: boolean;
}
export interface ThreadRealtimeAppendTextParams { threadId: string; text: string; role?: "user" | "assistant" }
export interface ThreadRealtimeAudioChunk { data: string; sampleRate: number; numChannels: number; samplesPerChannel?: number | null; itemId?: string | null }
export interface ThreadRealtimeAppendAudioParams { threadId: string; audio: ThreadRealtimeAudioChunk }
export interface ThreadRealtimeStopParams { threadId: string }

// 通知
export const audioChunkSchema = z.object({ data: z.string(), sampleRate: z.number(), numChannels: z.number(), samplesPerChannel: z.number().nullable().optional(), itemId: z.string().nullable().optional() });
export const realtimeStartedSchema = z.object({ threadId: z.string(), realtimeSessionId: z.string().nullable().optional(), version: z.string() });
export const outputAudioDeltaSchema = z.object({ threadId: z.string(), audio: audioChunkSchema });
export const transcriptDoneSchema = z.object({ threadId: z.string(), role: z.string(), text: z.string() });
export const realtimeErrorSchema = z.object({ threadId: z.string(), message: z.string() });
export const realtimeClosedSchema = z.object({ threadId: z.string(), reason: z.string().nullable().optional() });

export const listVoicesResponseSchema = z.object({}).passthrough();

export const REALTIME_METHODS = {
  start: "thread/realtime/start",
  appendText: "thread/realtime/appendText",
  appendAudio: "thread/realtime/appendAudio",
  stop: "thread/realtime/stop",
  listVoices: "thread/realtime/listVoices",
} as const;

export const REALTIME_NOTIFICATIONS = {
  started: "thread/realtime/started",
  outputAudioDelta: "thread/realtime/outputAudio/delta",
  transcriptDone: "thread/realtime/transcript/done",
  transcriptDelta: "thread/realtime/transcript/delta",
  itemStarted: "thread/realtime/item/started",
  itemCompleted: "thread/realtime/item/completed",
  error: "thread/realtime/error",
  closed: "thread/realtime/closed",
} as const;
