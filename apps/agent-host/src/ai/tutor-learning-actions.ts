// AI 白名单图形动作校验（2026-09-17 批准设计）：
// Omni 只能请求三种动作——showHintRectangle / highlightCells / hideHint；
// 宿主是唯一校验者，校验通过才下发给孩子端，失败如实回传 function_call_output，绝不把失败说成成功。
import { z } from "zod";
import {
  fractionBoardSchema,
  fractionRectangleSchema,
  type FractionBoard,
  type FractionRectangle,
  type FractionSubmission,
} from "@ai-scholar/session-contracts";

const actionBase = {
  actionId: z.string().min(1),
  sessionId: z.string().min(1),
  submissionId: z.string().min(1),
  boardRevision: z.number().int().nonnegative(),
};

// 请求形状刻意宽松（rows/cells 只是 number）：结构性约束一律交给 fractionRectangleSchema 判定。
export const tutorActionRequestSchema = z.discriminatedUnion("type", [
  z.object({
    ...actionBase,
    type: z.literal("showHintRectangle"),
    wholeGroupId: z.string().min(1),
    rows: z.number(),
    columns: z.number(),
    shadedCells: z.array(z.number()),
  }),
  z.object({
    ...actionBase,
    type: z.literal("highlightCells"),
    objectId: z.string().min(1),
    cells: z.array(z.number()),
  }),
  z.object({
    ...actionBase,
    type: z.literal("hideHint"),
    objectId: z.string().min(1),
  }),
]);
export type TutorActionRequest = z.infer<typeof tutorActionRequestSchema>;

export type TutorBoardCommand =
  | { type: "showHintRectangle"; rectangle: FractionRectangle }
  | { type: "highlightCells"; objectId: string; cells: number[] }
  | { type: "hideHint"; objectId: string };

export type TutorActionResult =
  | { ok: true; actionId: string; duplicate: boolean; boardRevision: number; command: TutorBoardCommand }
  | { ok: false; actionId: string; duplicate: boolean; reason: string };

function fail(actionId: string, reason: string): TutorActionResult {
  return { ok: false, actionId, duplicate: false, reason };
}

export class TutorLearningActions {
  private submission: FractionSubmission | null = null;
  private board: FractionBoard | null = null;
  private readonly history = new Map<string, TutorActionResult>();

  constructor(private readonly sessionId: string) {}

  /** 提交被状态机接受后绑定本次提交的证据画布；AI 动作只允许作用在这份快照上。 */
  bindSubmission(submission: FractionSubmission, board: FractionBoard): void {
    this.submission = { ...submission };
    this.board = fractionBoardSchema.parse(board);
  }

  /** 切题/异议后旧提交的图形一律不得再应用。 */
  clearSubmission(): void {
    this.submission = null;
    this.board = null;
  }

  /** 当前绑定画布的 revision；无绑定时为 -1（调用方构造请求时使用）。 */
  get boardRevision(): number {
    return this.board ? this.board.revision : -1;
  }

  snapshot(): FractionBoard | null {
    return this.board ? structuredClone(this.board) : null;
  }

  apply(raw: unknown): TutorActionResult {
    const actionId =
      typeof (raw as { actionId?: unknown } | null)?.actionId === "string"
        ? (raw as { actionId: string }).actionId
        : "";
    const parsed = tutorActionRequestSchema.safeParse(raw);
    if (!parsed.success) return fail(actionId, "unknownAction");
    const prior = this.history.get(parsed.data.actionId);
    if (prior) return { ...prior, duplicate: true };
    const result = this.execute(parsed.data);
    this.history.set(parsed.data.actionId, result);
    return result;
  }

  private execute(action: TutorActionRequest): TutorActionResult {
    if (action.sessionId !== this.sessionId) return fail(action.actionId, "wrongSession");
    if (!this.submission || !this.board) return fail(action.actionId, "noActiveSubmission");
    if (action.submissionId !== this.submission.submissionId) return fail(action.actionId, "staleSubmission");
    if (action.boardRevision !== this.board.revision) return fail(action.actionId, "staleRevision");
    switch (action.type) {
      case "showHintRectangle": {
        // owner 恒为 agent：AI 请求里的任何归属字段都不被采信。
        const rectangle: FractionRectangle = {
          id: `agent-hint-${action.actionId}`,
          wholeGroupId: action.wholeGroupId,
          rows: action.rows,
          columns: action.columns,
          shadedCells: action.shadedCells,
          owner: "agent",
        };
        if (!fractionRectangleSchema.safeParse(rectangle).success) return fail(action.actionId, "invalidRectangle");
        const next: FractionBoard = { revision: this.board.revision + 1, rectangles: [...this.board.rectangles, rectangle] };
        if (!fractionBoardSchema.safeParse(next).success) return fail(action.actionId, "boardLimit");
        this.board = next;
        return { ok: true, actionId: action.actionId, duplicate: false, boardRevision: next.revision, command: { type: "showHintRectangle", rectangle } };
      }
      case "highlightCells": {
        const target = this.board.rectangles.find((r) => r.id === action.objectId);
        if (!target) return fail(action.actionId, "unknownObject");
        if (target.owner !== "agent") return fail(action.actionId, "childObjectImmutable");
        const cellCount = target.rows * target.columns;
        const valid =
          action.cells.every((c) => Number.isInteger(c) && c >= 0 && c < cellCount) &&
          new Set(action.cells).size === action.cells.length;
        if (!valid) return fail(action.actionId, "invalidCells");
        const rectangles = this.board.rectangles.map((r) =>
          r.id === target.id ? { ...r, shadedCells: [...action.cells] } : r,
        );
        const next: FractionBoard = { revision: this.board.revision + 1, rectangles };
        this.board = next;
        return { ok: true, actionId: action.actionId, duplicate: false, boardRevision: next.revision, command: { type: "highlightCells", objectId: target.id, cells: [...action.cells] } };
      }
      case "hideHint": {
        const target = this.board.rectangles.find((r) => r.id === action.objectId);
        if (!target) return fail(action.actionId, "unknownObject");
        if (target.owner !== "agent") return fail(action.actionId, "childObjectImmutable");
        const next: FractionBoard = {
          revision: this.board.revision + 1,
          rectangles: this.board.rectangles.filter((r) => r.id !== target.id),
        };
        this.board = next;
        return { ok: true, actionId: action.actionId, duplicate: false, boardRevision: next.revision, command: { type: "hideHint", objectId: target.id } };
      }
    }
  }
}
