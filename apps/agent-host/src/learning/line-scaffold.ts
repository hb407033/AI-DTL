import { z } from "zod";
import { lineScaffoldSchema, scaffoldBasisSchema, workspaceIdSchema, lineUnderstandingSchema,
  type LineScaffold, type ScaffoldBasis, type LineScaffoldState, type WorkspaceRecord, type ScaffoldJournal } from "@ai-scholar/session-contracts";

export const scaffoldChangeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("offer"), offerId: workspaceIdSchema, basis: scaffoldBasisSchema, understanding: lineUnderstandingSchema }),
  z.strictObject({ type: z.literal("consent"), offerId: workspaceIdSchema }),
  z.strictObject({ type: z.literal("generate"), offerId: workspaceIdSchema, line: lineScaffoldSchema }),
  z.strictObject({ type: z.literal("select"), offerId: workspaceIdSchema, selectedParts: z.array(z.number().int().min(0).max(19)).max(20) }),
  z.strictObject({ type: z.literal("hide"), offerId: workspaceIdSchema }),
  z.strictObject({ type: z.literal("invalidate"), offerId: workspaceIdSchema }),
]);

export function scaffoldBasisIsCurrent(basis: ScaffoldBasis, record: WorkspaceRecord) {
  return record.problem?.statement.confirmed === true && record.problem.problemId === basis.problemId
    && record.problem.statement.revision === basis.problemRevision
    && record.submissions.some(e => e.submissionId === basis.submissionId && e.problemId === basis.problemId && e.problemRevision === basis.problemRevision)
    && record.feedback.some(f => f.responseId === basis.responseId && !f.contested && !!f.summary);
}

/** 仅由 WorkspaceStore 在同一写锁下调用；读到的事实不是请求方提供的副本。 */
export function applyScaffoldChange(journal: ScaffoldJournal, record: WorkspaceRecord, raw: unknown): ScaffoldJournal {
  const change = scaffoldChangeSchema.parse(raw);
  if (change.type === "offer") {
    if (!scaffoldBasisIsCurrent(change.basis, record)) throw Error("staleBasis");
    const evidence = record.submissions.find(e => e.submissionId === change.basis.submissionId)!;
    if (!evidence.explanation.includes(change.understanding.sourceQuote)) throw Error("missingSource");
    if (journal.items.some(item => item.offerId === change.offerId)) throw Error("offerConflict");
    if (journal.items.length >= 100) throw Error("sessionLimit");
    return { revision: journal.revision + 1, items: [...journal.items.map(invalidateLineScaffold), offerLineScaffold(change.offerId, change.basis, change.understanding)] };
  }
  const item = journal.items.find(s => s.offerId === change.offerId);
  if (!item) throw Error("missingOffer");
  if (change.type !== "invalidate" && !scaffoldBasisIsCurrent(item.basis, record)) throw Error("staleBasis");
  let next: LineScaffoldState;
  switch (change.type) {
    case "consent": next = consentToLineScaffold(item, change.offerId, item.basis); break;
    case "generate": next = generateLineScaffold(item, item.basis, change.line,
      record.submissions.filter(e => e.submissionId === item.basis.submissionId).map(e => e.explanation)); break;
    case "select": next = selectLineParts(item, item.basis, change.selectedParts); break;
    case "hide": next = hideLineScaffold(item); break;
    case "invalidate": next = invalidateLineScaffold(item); break;
  }
  return { revision: journal.revision + 1, items: journal.items.map(s => s.offerId === next.offerId ? next : s) };
}

export function invalidateStaleScaffolds(journal: ScaffoldJournal, record: WorkspaceRecord): ScaffoldJournal {
  let changed = false;
  const items = journal.items.map(s => {
    if (s.status === "invalidated" || scaffoldBasisIsCurrent(s.basis, record)) return s;
    changed = true; return invalidateLineScaffold(s);
  });
  return changed ? { revision: journal.revision + 1, items } : journal;
}

function requireBasis(state: LineScaffoldState, current: ScaffoldBasis) {
  scaffoldBasisSchema.parse(current);
  if (state.basis.problemId !== current.problemId || state.basis.problemRevision !== current.problemRevision
    || state.basis.submissionId !== current.submissionId || state.basis.responseId !== current.responseId) throw Error("staleBasis");
}

/** 只是等待孩子核对的表示含义，不是模型已证实的数学结论。 */
export function offerLineScaffold(offerId: string, basis: ScaffoldBasis,
  understanding: Pick<LineScaffold, "whole" | "unit" | "sourceQuote" | "meaning">): LineScaffoldState {
  workspaceIdSchema.parse(offerId);
  const { whole, unit, sourceQuote, meaning } = lineScaffoldSchema.pick({ whole: true, unit: true, sourceQuote: true, meaning: true })
    .parse({ whole: understanding.whole, unit: understanding.unit, sourceQuote: understanding.sourceQuote, meaning: understanding.meaning });
  return { offerId, basis: scaffoldBasisSchema.parse(basis), meaning,
    anchor: { whole, unit, sourceQuote }, status: "offered", selectedParts: [] };
}

export function consentToLineScaffold(state: LineScaffoldState, offerId: string, current: ScaffoldBasis): LineScaffoldState {
  if (state.offerId !== offerId || state.status !== "offered") throw Error("staleOffer");
  requireBasis(state, current);
  return { ...state, status: "consented" };
}

/** 主机接线必须传入重新读取的 current 与冻结证据原话，不能信任模型自报来源。 */
export function generateLineScaffold(state: LineScaffoldState, current: ScaffoldBasis,
  raw: unknown, sourceExpressions: readonly string[]): LineScaffoldState {
  if (state.status !== "consented") throw Error("consentRequired");
  requireBasis(state, current);
  const line = lineScaffoldSchema.parse(raw);
  if (line.meaning !== state.meaning) throw Error("meaningChanged");
  if (line.whole !== state.anchor.whole || line.unit !== state.anchor.unit || line.sourceQuote !== state.anchor.sourceQuote) throw Error("quantityChanged");
  if (!sourceExpressions.some(text => text.includes(line.sourceQuote))) throw Error("missingSource");
  return { ...state, status: "visible", line, selectedParts: [] };
}

export function selectLineParts(state: LineScaffoldState, current: ScaffoldBasis, selectedParts: number[]): LineScaffoldState {
  requireBasis(state, current);
  if (state.status !== "visible" || !state.line) throw Error("notVisible");
  if (selectedParts.length > state.line.partitions || new Set(selectedParts).size !== selectedParts.length
    || selectedParts.some(i => !Number.isInteger(i) || i < 0 || i >= state.line!.partitions)) throw Error("invalidSelection");
  return { ...state, selectedParts: [...selectedParts].sort((a, b) => a - b) };
}

export function hideLineScaffold(state: LineScaffoldState): LineScaffoldState {
  if (state.status !== "visible") throw Error("notVisible");
  return { ...state, status: "hidden" };
}

/** 终态失效：留存已有使用事实，但无任何复活旧邀请的转换。 */
export function invalidateLineScaffold(state: LineScaffoldState): LineScaffoldState {
  return { ...state, status: "invalidated" };
}
