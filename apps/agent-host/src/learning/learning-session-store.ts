// Mac 权威学习记录存储（2026-09-17 批准设计，工作包 D）。
// 保存事实：题包版本、当前题目、流程阶段、revision、孩子笔迹（不透明 base64，由 iPad 上行，宿主不解析）、
// 孩子/AI 矩形状态、提示可见性、提交记录、AI 可见反馈与异议事实、是否用过提示。
// 明确不保存：音频、密钥、模型隐藏推理、能力标签——strict 模式 schema 会让这些字段直接校验失败。
// 写入为「临时文件 + rename」原子写入；save 携带 revision 做乐观校验；同 eventId/同 revision 重复保存幂等；
// 读取时做 zod 结构校验，损坏文件报错且绝不被覆盖；delete 落墓碑文件，迟到保存不得复活记录。
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  fractionBoardSchema,
  fractionPhaseSchema,
  fractionSubmissionSchema,
} from "@ai-scholar/session-contracts";

export const LEARNING_SESSION_SCHEMA_VERSION = 1 as const;

export const DEFAULT_LEARNING_SESSION_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "ai-dtl",
  "learning-sessions",
);

// sessionId 同时是文件名，必须限定字符集以杜绝路径穿越
const sessionIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,80}$/);

// AI 可见反馈与异议事实：只保存呈现给孩子的内容与是否被异议，不保存模型隐藏推理
export const learningFeedbackRecordSchema = z.strictObject({
  feedbackId: z.string().min(1),
  submissionId: z.string().min(1),
  summary: z.string().max(4_000),
  contested: z.boolean(),
});
export type LearningFeedbackRecord = z.infer<typeof learningFeedbackRecordSchema>;

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const learningSessionRecordSchema = z.strictObject({
  schemaVersion: z.literal(LEARNING_SESSION_SCHEMA_VERSION),
  sessionId: sessionIdSchema,
  // 幂等键：同 eventId/同 revision 的重复保存直接成功且不再写盘
  eventId: z.string().min(1),
  packVersion: z.string().min(1),
  challengeId: z.string().min(1),
  phase: fractionPhaseSchema,
  revision: z.number().int().nonnegative(),
  // PencilKit 笔迹对宿主不透明：只校验是合法 base64 且在传输上限内，不解析内容
  childInkBase64: z.string().max(6_000_000).regex(base64Pattern),
  board: fractionBoardSchema,
  hintsVisible: z.boolean(),
  hintUsed: z.boolean(),
  submissions: z.array(fractionSubmissionSchema).max(1_000),
  feedback: z.array(learningFeedbackRecordSchema).max(1_000),
});
export type LearningSessionRecord = z.infer<typeof learningSessionRecordSchema>;

export type LearningSaveResult =
  | { ok: true }
  | { ok: false; reason: "invalidRecord" | "staleRevision" | "deleted" | "corruptExisting" };

export type LearningLoadResult =
  | { status: "ok"; record: LearningSessionRecord }
  | { status: "missing" }
  | { status: "corrupt" };

type AtomicWrite = (target: string, contents: string) => Promise<void>;

// 同目录临时文件 + rename：对读者而言记录要么完整出现要么不出现；失败时清理临时文件
async function defaultAtomicWrite(target: string, contents: string): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(tmp, contents, "utf8");
  try {
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export class LearningSessionStore {
  private readonly directory: string;
  private readonly atomicWrite: AtomicWrite;

  constructor(options: { directory?: string; atomicWrite?: AtomicWrite } = {}) {
    this.directory = options.directory ?? DEFAULT_LEARNING_SESSION_DIR;
    this.atomicWrite = options.atomicWrite ?? defaultAtomicWrite;
  }

  private recordPath(sessionId: string): string {
    return path.join(this.directory, `${sessionId}.json`);
  }

  private tombstonePath(sessionId: string): string {
    return path.join(this.directory, `${sessionId}.deleted.json`);
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  private async readRecordFile(
    target: string,
  ): Promise<{ status: "ok"; record: LearningSessionRecord } | { status: "corrupt" }> {
    try {
      const raw = await fs.readFile(target, "utf8");
      const parsed = learningSessionRecordSchema.safeParse(JSON.parse(raw));
      return parsed.success ? { status: "ok", record: parsed.data } : { status: "corrupt" };
    } catch {
      return { status: "corrupt" };
    }
  }

  /** 写盘失败会以 reject 上抛，调用方绝不得据返回值以外显示「已保存」。 */
  async save(raw: unknown): Promise<LearningSaveResult> {
    const parsed = learningSessionRecordSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalidRecord" };
    const record = parsed.data;
    await fs.mkdir(this.directory, { recursive: true });
    if (await this.exists(this.tombstonePath(record.sessionId))) return { ok: false, reason: "deleted" };
    const target = this.recordPath(record.sessionId);
    if (await this.exists(target)) {
      const existing = await this.readRecordFile(target);
      // 损坏文件可能是更新的有效记录，宁可拒绝保存也不覆盖
      if (existing.status === "corrupt") return { ok: false, reason: "corruptExisting" };
      const current = existing.record;
      if (current.eventId === record.eventId && current.revision === record.revision) return { ok: true };
      if (record.revision <= current.revision) return { ok: false, reason: "staleRevision" };
    }
    await this.atomicWrite(target, `${JSON.stringify(record, null, 2)}\n`);
    return { ok: true };
  }

  async load(sessionId: string): Promise<LearningLoadResult> {
    if (!sessionIdSchema.safeParse(sessionId).success) return { status: "missing" };
    if (await this.exists(this.tombstonePath(sessionId))) return { status: "missing" };
    const target = this.recordPath(sessionId);
    if (!(await this.exists(target))) return { status: "missing" };
    return this.readRecordFile(target);
  }

  /** 删除本次学习记录：先落墓碑再删文件，崩溃窗口内墓碑也能阻止迟到保存复活记录。幂等。 */
  async delete(sessionId: string): Promise<void> {
    if (!sessionIdSchema.safeParse(sessionId).success) throw new Error("invalidSessionId");
    await fs.mkdir(this.directory, { recursive: true });
    await this.atomicWrite(
      this.tombstonePath(sessionId),
      `${JSON.stringify({ sessionId, deletedAt: new Date().toISOString() })}\n`,
    );
    await fs.rm(this.recordPath(sessionId), { force: true });
  }
}
