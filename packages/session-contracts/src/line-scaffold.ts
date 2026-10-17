import { z } from "zod";
import { workspaceIdSchema } from "./workspace-learning.js";

// 有限十进制及六位小数，乘 10^6 后仍在安全整数范围内。
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/).refine(x => Number(x) > 0);
const partitions = z.number().int().min(2).max(20);
export const lineScaffoldSchema = z.strictObject({
  kind: z.literal("line"), whole: quantity,
  unit: z.string().trim().min(1).max(20), partitions,
  meaning: z.string().trim().min(1).max(160),
  sourceQuote: z.string().trim().min(1).max(1000),
});
export type LineScaffold = z.infer<typeof lineScaffoldSchema>;
export const scaffoldBasisSchema = z.strictObject({
  problemId: workspaceIdSchema, problemRevision: z.number().int().nonnegative(),
  submissionId: workspaceIdSchema, responseId: workspaceIdSchema,
});
export type ScaffoldBasis = z.infer<typeof scaffoldBasisSchema>;

export const lineUnderstandingSchema = lineScaffoldSchema.pick({ whole: true, unit: true, sourceQuote: true, meaning: true });
export const lineScaffoldStateSchema = z.strictObject({
  offerId: workspaceIdSchema, basis: scaffoldBasisSchema, meaning: lineUnderstandingSchema.shape.meaning,
  anchor: lineScaffoldSchema.pick({ whole: true, unit: true, sourceQuote: true }),
  status: z.enum(["offered", "consented", "visible", "hidden", "invalidated"]),
  line: lineScaffoldSchema.optional(), selectedParts: z.array(z.number().int().min(0).max(19)).max(20),
}).superRefine((state, ctx) => {
  if (["visible", "hidden"].includes(state.status) && !state.line) ctx.addIssue({ code: "custom", message: "missingLine" });
  if (state.line && (state.line.meaning !== state.meaning || state.line.whole !== state.anchor.whole
    || state.line.unit !== state.anchor.unit || state.line.sourceQuote !== state.anchor.sourceQuote)) ctx.addIssue({ code: "custom", message: "anchorMismatch" });
  if (new Set(state.selectedParts).size !== state.selectedParts.length || state.selectedParts.some(i => !state.line || i >= state.line.partitions)) {
    ctx.addIssue({ code: "custom", message: "invalidSelection" });
  }
});
export type LineScaffoldState = z.infer<typeof lineScaffoldStateSchema>;
export const scaffoldJournalSchema = z.strictObject({ revision: z.number().int().nonnegative(), items: z.array(lineScaffoldStateSchema).max(100) });
export type ScaffoldJournal = z.infer<typeof scaffoldJournalSchema>;

/** 精确表示每段数量；循环小数保留分数，渲染器不能暗中四舍五入。 */
export function partitionQuantity(whole: string, count: number) {
  quantity.parse(whole); partitions.parse(count);
  const digits = whole.split(".")[1]?.length ?? 0;
  const numerator = Number(whole.replace(".", ""));
  const denominator = 10 ** digits * count;
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const factor = gcd(numerator, denominator);
  return { numerator: numerator / factor, denominator: denominator / factor };
}
