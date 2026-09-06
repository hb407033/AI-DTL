// packages/learning-kernel/src/proposal-validator.ts
// 教学提案本地校验器（设计稿 10.3、13“模型输出不合规”）：三种桥接的输出都必须过这一关。
// 校验项：提示级别与预算门禁、语音长度与单一动作、语义对象种类、不得覆盖孩子层、记忆候选时机、被异议冻结。
import type { TeachingProposal } from "@ai-scholar/session-contracts";
import { evaluateEscalation, type InterventionBudget } from "./hint-budget.js";
import type { DisciplinePlugin } from "./plugin.js";
import type { SessionContext } from "./session-state.js";

export interface ValidationInput {
  proposal: TeachingProposal;
  context: SessionContext;
  budget: InterventionBudget;
  plugin: DisciplinePlugin;
  /** 孩子层与原始材料层的对象 id，Agent 不得删除或覆盖 */
  protectedObjectIds: string[];
  maxSpokenChars?: number | undefined;
}

export type ValidationResult = { accepted: true; liftsSoftBudget: boolean } | { accepted: false; reasons: string[] };

const DEFAULT_MAX_SPOKEN_CHARS = 120;

export function validateProposal(input: ValidationInput): ValidationResult {
  const { proposal, context, budget, plugin, protectedObjectIds } = input;
  const reasons: string[] = [];
  let liftsSoftBudget = false;

  if (context.frozenTargetIds.includes(proposal.proposalId)) reasons.push("proposal:frozen");

  if (proposal.hintLevel > 0 && proposal.hintLevel !== context.hintLevel) {
    const verdict = evaluateEscalation(context, proposal.hintLevel, budget);
    if (!verdict.allowed) reasons.push(`hint:${verdict.reason}`);
    else liftsSoftBudget = verdict.liftsSoftBudget;
  }

  const maxChars = input.maxSpokenChars ?? DEFAULT_MAX_SPOKEN_CHARS;
  if (proposal.spokenResponse.length > maxChars) reasons.push("spoken:tooLong");
  // 每次发言只含一个教学动作：最多一个问句
  const questionMarks = (proposal.spokenResponse.match(/[?？]/g) ?? []).length;
  if (questionMarks > 1) reasons.push("spoken:multipleQuestions");

  for (const action of proposal.canvasActions) {
    if (action.kind === "upsertObject" && !plugin.manifest.semanticObjectKinds.includes(action.object.kind)) reasons.push(`canvas:unknownKind:${action.object.kind}`);
    if (action.kind === "upsertObject" && protectedObjectIds.includes(action.object.id)) reasons.push(`canvas:overwritesChildLayer:${action.object.id}`);
    if (action.kind === "removeObject" && protectedObjectIds.includes(action.objectId)) reasons.push(`canvas:overwritesChildLayer:${action.objectId}`);
  }

  if (proposal.memoryCandidate) {
    if (context.assistedRound) reasons.push("memory:assistedRound");
    else if (context.state !== "TRANSFER") reasons.push("memory:notAfterTransfer");
  }

  return reasons.length === 0 ? { accepted: true, liftsSoftBudget } : { accepted: false, reasons };
}
