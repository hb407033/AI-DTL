// 分数学习闭环契约（2026-09-17 批准设计）：统一消息 envelope、受控分数矩形模型与提交记录。
// 本文件是 Swift Codable 与宿主 TS 的唯一公共形状来源；共享夹具见 fixtures/fraction-learning-v1.json。
import { z } from "zod";

export const FRACTION_SCHEMA_VERSION = 1 as const;
export const FRACTION_MAX_CELLS = 60;
export const FRACTION_MAX_RECTANGLES_PER_OWNER = 4;

export const fractionPhaseSchema = z.enum([
  "exploring", "reviewing", "clarifying", "transfer", "paused", "finished",
]);
export type FractionPhase = z.infer<typeof fractionPhaseSchema>;

// 受控分数矩形：格子索引从 0 开始按行优先；等分单元面积相等由渲染器保证，模型只存结构
export const fractionRectangleSchema = z.object({
  id: z.string().min(1),
  wholeGroupId: z.string().min(1),
  rows: z.number().int().positive(),
  columns: z.number().int().positive(),
  shadedCells: z.array(z.number().int().nonnegative()),
  owner: z.enum(["child", "agent"]),
}).superRefine((rect, ctx) => {
  const cellCount = rect.rows * rect.columns;
  if (cellCount > FRACTION_MAX_CELLS) {
    ctx.addIssue({ code: "custom", message: "tooManyCells" });
  }
  if (new Set(rect.shadedCells).size !== rect.shadedCells.length) {
    ctx.addIssue({ code: "custom", message: "duplicateCell" });
  }
  if (rect.shadedCells.some((cell) => cell >= cellCount)) {
    ctx.addIssue({ code: "custom", message: "cellOutOfRange" });
  }
});
export type FractionRectangle = z.infer<typeof fractionRectangleSchema>;

export const fractionBoardSchema = z.object({
  revision: z.number().int().nonnegative(),
  rectangles: z.array(fractionRectangleSchema),
}).superRefine((board, ctx) => {
  const ids = board.rectangles.map((r) => r.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", message: "duplicateRectangleId" });
  }
  for (const owner of ["child", "agent"] as const) {
    if (board.rectangles.filter((r) => r.owner === owner).length > FRACTION_MAX_RECTANGLES_PER_OWNER) {
      ctx.addIssue({ code: "custom", message: `tooManyRectangles:${owner}` });
    }
  }
});
export type FractionBoard = z.infer<typeof fractionBoardSchema>;

// 提交冻结的不可变证据快照元数据；hintUsed 标记本次尝试是否用过提示（用过就不再称独立完成）
export const fractionSubmissionSchema = z.object({
  submissionId: z.string().min(1),
  challengeId: z.string().min(1),
  boardRevision: z.number().int().nonnegative(),
  hintUsed: z.boolean(),
});
export type FractionSubmission = z.infer<typeof fractionSubmissionSchema>;

const envelopeBase = {
  schemaVersion: z.literal(FRACTION_SCHEMA_VERSION),
  sessionId: z.string().min(1),
  eventId: z.string().min(1),
  revision: z.number().int().nonnegative(),
};

// 合法命令仅这 7 种；绘图、停顿或静音事件不得被翻译成其中任何一种
export const fractionEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({
    ...envelopeBase, type: z.literal("submit"), submissionId: z.string().min(1),
    payload: z.object({ challengeId: z.string().min(1), boardRevision: z.number().int().nonnegative() }),
  }),
  z.object({
    ...envelopeBase, type: z.literal("requestHelp"),
    payload: z.object({ challengeId: z.string().min(1) }),
  }),
  z.object({
    ...envelopeBase, type: z.literal("contest"),
    payload: z.object({ feedbackId: z.string().min(1) }),
  }),
  z.object({
    ...envelopeBase, type: z.literal("startTransfer"),
    payload: z.object({ challengeId: z.string().min(1) }),
  }),
  z.object({ ...envelopeBase, type: z.literal("pause"), payload: z.object({}) }),
  z.object({ ...envelopeBase, type: z.literal("resume"), payload: z.object({}) }),
  z.object({
    ...envelopeBase, type: z.literal("finishSession"),
    payload: z.object({ reason: z.enum(["rest", "quit", "completed"]) }),
  }),
]);
export type FractionEnvelope = z.infer<typeof fractionEnvelopeSchema>;
export type FractionCommandType = FractionEnvelope["type"];
