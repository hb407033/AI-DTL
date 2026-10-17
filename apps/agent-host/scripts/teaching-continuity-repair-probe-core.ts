import path from "node:path";
import { createHash } from "node:crypto";
import type { TeachingInput, TeachingDecision } from "../src/ai/workspace-teaching-decision.js";
import { conversationAction } from "../src/learning/conversation-policy.js";
import { reserveProductionCall, type ArchiveFixture, type Trajectory, type ProductionBudget } from "./production-teaching-probe-core.js";

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const idFor = (value: string) => {
  const h = sha256(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export interface ArchivedResult {
  id: string; caseId: string; stage: string; mode: string; child: string;
  error: string | null; decision: TeachingDecision | null;
  family?: string; turnIndex?: number; imageHash?: string; inputHash?: string;
  [key: string]: unknown;
}
export interface ArchivedCall { resultId: string; kind?: string; raw?: unknown; [key: string]: unknown }
export interface RepairCases { initial: ArchiveFixture[]; multiturn: Trajectory[] }
export interface FrozenFailure extends ArchiveFixture {
  imageHash: string; inputHash: string; originalFailure: ArchivedResult; originalCalls: ArchivedCall[];
  provenance: { sourceStage: string; sourceMode: string; sourceResultId: string; idsReconstructed: boolean; note: string };
}

export function buildTrajectoryInput(fixture: ArchiveFixture, trajectory: Trajectory, index: number,
  history: TeachingDecision[], namespace: string): TeachingInput {
  if (!Number.isInteger(index) || index < 0 || index >= trajectory.turns.length) throw Error("invalidTrajectoryIndex");
  if (history.length !== index || history.some((d, i) => d.child !== trajectory.turns[i])) throw Error("missingDeliveredPrefix");
  const record = structuredClone(fixture.input.record);
  if (!record.problem || !fixture.input.imageId) throw Error("missingTrajectoryProblemOrImage");
  record.problem.statement.text = trajectory.problem;
  record.feedback = history.map(d => ({ turnId: d.turnId, responseId: d.responseId, summary: d.utterance, contested: false }));
  record.submissions = trajectory.turns.slice(0, index + 1).map((child, i) => ({
    submissionId: idFor(`${namespace}:${trajectory.id}:${i}:submission`), problemId: record.problem!.problemId,
    problemRevision: record.problem!.statement.revision, boardRevision: record.board.revision,
    previewId: fixture.input.imageId!, explanation: child,
  }));
  const child = trajectory.turns[index]!;
  const action = conversationAction("dialogue", child);
  return { record, child, history: structuredClone(history), imageId: fixture.input.imageId,
    turnId: idFor(`${namespace}:${trajectory.id}:${index}:turn`), responseId: idFor(`${namespace}:${trajectory.id}:${index}:response`),
    permission: action === "help" ? "hint" : action === "correct" ? "clarification" : "review" };
}

export function appendDeliveredTurn(history: TeachingDecision[], decision: TeachingDecision) {
  history.push(structuredClone(decision));
}

/** 原档案缺少失败轮随机ID；仅重建这些ID，真实成功老师的内容/证据ID原样保留。 */
export function freezeFailedInputs(cases: RepairCases, rows: ArchivedResult[], calls: ArchivedCall[], expectedFailures = 9): FrozenFailure[] {
  const failures = rows.filter(row => row.error || !row.decision);
  if (failures.length !== expectedFailures) throw Error("nineActualFailuresRequired");
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error("ambiguousDeliveredPrefix");
  return failures.map(failed => {
    let input: TeachingInput, fixture: ArchiveFixture;
    const reconstructed = failed.stage === "multiturn";
    if (failed.stage === "initial") {
      const fixtures = cases.initial.filter(f => f.id === failed.caseId);
      if (fixtures.length !== 1) throw Error("missingOrAmbiguousInitialFixture");
      fixture = fixtures[0]!;
      input = structuredClone(fixture.input);
      if (input.child !== failed.child) throw Error("archivedChildMismatch");
    } else if (reconstructed) {
      const trajectories = cases.multiturn.filter(t => t.id === failed.family);
      if (trajectories.length !== 1 || failed.turnIndex == null) throw Error("missingTrajectory");
      const trajectory = trajectories[0]!;
      const fixtures = cases.initial.filter(f => f.id === trajectory.baseId);
      if (fixtures.length !== 1) throw Error("missingOrAmbiguousInitialFixture");
      fixture = fixtures[0]!;
      const history: TeachingDecision[] = [];
      for (let i = 0; i < failed.turnIndex; i++) {
        const prefix = rows.filter(r => r.stage === "multiturn" && r.family === failed.family && r.mode === failed.mode && r.turnIndex === i);
        if (prefix.length > 1) throw Error("ambiguousDeliveredPrefix");
        const row = prefix[0];
        if (!row?.decision || row.error || rows.indexOf(row) >= rows.indexOf(failed)
          || row.child !== trajectory.turns[i] || row.decision.child !== row.child) throw Error("missingDeliveredPrefix");
        appendDeliveredTurn(history, row.decision);
      }
      input = buildTrajectoryInput(fixture, trajectory, failed.turnIndex, history, `archived-replay:${failed.id}`);
      if (input.child !== failed.child) throw Error("archivedChildMismatch");
    } else throw Error("unsupportedArchivedStage");
    const imageHash = sha256(Buffer.from(fixture.imageBase64, "base64"));
    if (failed.imageHash && failed.imageHash !== imageHash) throw Error("archivedImageMismatch");
    const inputHash = sha256(JSON.stringify({ ...input, image: undefined }));
    if (!reconstructed && failed.inputHash && inputHash !== failed.inputHash) throw Error("archivedInitialInputMismatch");
    return { id: `failure-${failed.id}`, input, imageBase64: fixture.imageBase64, imageHash, inputHash,
      originalFailure: structuredClone(failed), originalCalls: structuredClone(calls.filter(c => c.resultId === failed.id)),
      provenance: { sourceStage: failed.stage, sourceMode: failed.mode, sourceResultId: failed.id, idsReconstructed: reconstructed,
        note: reconstructed ? "真实family/mode前缀重建；原成功老师及其ID保留，原档案未保存的失败轮turnId/responseId及submissionId确定性生成，inputHash因此不同。"
          : "原始initial输入直接冻结，原turnId/responseId、图片及历史保持原样。" } };
  });
}

export const createRepairBudget = (now: number): ProductionBudget => ({ calls: 0, maxCalls: 120,
  deadline: now + 30 * 60 * 1000, knownCostCny: 0, costLimitCny: 2 });
export function reserveRepairCall(budget: ProductionBudget, now: number) {
  // 文件可编辑不能扩大硬上限。
  if (budget.maxCalls !== 120 || budget.costLimitCny !== 2) throw Error("changedHardBudget");
  reserveProductionCall(budget, now);
}
export interface RepairResult {
  caseId: string; stage: "replay" | "multiturn"; family?: string; turnIndex?: number;
  decision: TeachingDecision | null; error: string | null;
}
export function continuitySummary(frozen: Pick<FrozenFailure, "id">[], trajectories: Trajectory[], rows: RepairResult[], blockedReason: string | null,
  startIndices: Record<string, number> = {}) {
  const expectedIds = [...frozen.map(f => f.id), ...trajectories.flatMap(t => t.turns.map((_, i) => i).filter(i => i >= (startIndices[t.id] ?? 0)).map(i => `${t.id}-${i}`))];
  const delivered = rows.filter(r => !r.error && r.decision).length;
  const uncoveredIds = expectedIds.filter(id => !rows.some(r => r.caseId === id));
  const families = trajectories.map(t => {
    const actual = rows.filter(r => r.stage === "multiturn" && r.family === t.id);
    return { family: t.id, expectedTurns: t.turns.length - (startIndices[t.id] ?? 0), completedTurns: actual.filter(r => !r.error && r.decision).length,
      stoppedAtTurn: actual.find(r => r.error || !r.decision)?.turnIndex ?? null,
      uncoveredTurns: t.turns.map((_, i) => i).filter(i => i >= (startIndices[t.id] ?? 0) && !actual.some(r => r.turnIndex === i)),
      lookBackAfterCorrect: actual.some(r => r.turnIndex! >= t.correctFrom && r.decision?.move === "look_back") };
  });
  return { status: blockedReason ? "blocked" : uncoveredIds.length ? "incomplete" : "awaiting_review",
    blockedReason, expected: expectedIds.length, attempted: rows.length, delivered, failed: rows.length - delivered,
    uncovered: uncoveredIds.length, uncoveredIds, families, passed: false, hardFailures: null,
    t1: null, t2: null, t3: null, gradeStatus: "ungraded_not_zero", defaultSwitched: false,
    reason: "真实生产交付与脚本覆盖记录；教学质量及真机儿童接住仍需人工评分，不能由自动计数宣布通过。" };
}

const contains = (parent: string, child: string) => child === parent || child.startsWith(parent + path.sep);
export function assertPrivateDirectory(output: string, source: string, repository: string) {
  if (!path.isAbsolute(output) || !path.isAbsolute(source) || path.resolve(output) === path.parse(output).root) throw Error("absolutePrivateOutputRequired");
  const target = path.resolve(output), archived = path.resolve(source), repo = path.resolve(repository);
  if (contains(archived, target) || contains(target, archived)) throw Error("sourceOutputOverlap");
  if (contains(repo, target) || contains(target, repo)) throw Error("outputInsideRepository");
}
