export interface ScaffoldPointRow {
  pointId: string;
  learnerId: string;
  runId: string;
  challengeId: string;
  goalKind: "developmentGoal";
  goalId: string;
  probeFamilyId: string;
  difficultyBand: string;
  difficultyBandIndex: number;
  maxHintLevelUsed: number;
  escalationCount: number;
  probesIssued: number;
  independentTransferSucceeded: boolean;
  timeToFirstProductiveActionMs: number | null;
  selfCorrectionObserved: boolean;
  assistedRound: boolean;
  occurredAt: number;
}

export interface TrendGapRow {
  gapId: string;
  learnerId: string;
  goalId: string;
  probeFamilyId: string;
  difficultyBandIndex: number;
  removedCount: number;
  addedSinceCount: number;
  removedAt: number;
}

export type TrendVerdict = "withdrawing" | "flat" | "rising" | "incomplete" | "insufficient";
export interface TrendReport {
  verdict: TrendVerdict;
  windowRunIds: readonly string[];
  alert: { pauseDifficultyIncrease: true; interventionHistoryRunIds: readonly string[] } | null;
  teachingAdjustmentSuggested: boolean;
  reason: "artifactDeleted" | null;
  policyErrors: readonly { pointId: string; runId: string; code: "invalidDifficultyBandIndex" }[];
}

export function isComparable(point: ScaffoldPointRow, reference: ScaffoldPointRow): boolean {
  return point.difficultyBandIndex >= 0 && reference.difficultyBandIndex >= 0
    && point.probeFamilyId === reference.probeFamilyId && point.goalId === reference.goalId
    && Math.abs(point.difficultyBandIndex - reference.difficultyBandIndex) <= 1;
}

/** 调用方按学习者、目标、探针族筛选，按 occurredAt 升序；洞计数由写点事务维护。 */
export function analyzeScaffoldTrend(input: {
  points: readonly ScaffoldPointRow[];
  gaps: readonly TrendGapRow[];
}): TrendReport {
  const policyErrors: TrendReport["policyErrors"] = input.points
    .filter(point => point.difficultyBandIndex < 0)
    .map(point => ({ pointId: point.pointId, runId: point.runId, code: "invalidDifficultyBandIndex" }));
  const valid = input.points.filter(point => point.difficultyBandIndex >= 0);
  const latest = valid[valid.length - 1];
  const comparable = latest === undefined ? [] : valid.filter(point => isComparable(point, latest));
  const window = comparable.slice(-3);
  const windowRunIds = window.map(point => point.runId);
  const report = (verdict: TrendVerdict): TrendReport => ({
    verdict, windowRunIds, policyErrors,
    alert: verdict === "rising" ? { pauseDifficultyIncrease: true, interventionHistoryRunIds: windowRunIds } : null,
    teachingAdjustmentSuggested: verdict === "flat",
    reason: verdict === "incomplete" ? "artifactDeleted" : null,
  });
  const w0 = window[0], w1 = window[1], w2 = window[2];
  // 点不够时仍优先暴露删除洞；完整窗口只受窗口起点之后的洞影响。
  const openGap = input.gaps.some(gap => gap.addedSinceCount < gap.removedCount
    && (w2 === undefined || w0 === undefined || gap.removedAt >= w0.occurredAt));
  if (openGap) return report("incomplete");
  if (w0 === undefined || w1 === undefined || w2 === undefined) return report("insufficient");
  if (w2.maxHintLevelUsed > w0.maxHintLevelUsed) return report("rising");
  if (w2.maxHintLevelUsed < w0.maxHintLevelUsed) return report("withdrawing");
  const previous = comparable.slice(-6, -3);
  if (previous.length < 3) return report("flat");
  const zeroSuccessCount = (rows: readonly ScaffoldPointRow[]) => rows.filter(point =>
    point.maxHintLevelUsed === 0 && point.independentTransferSucceeded).length;
  if (zeroSuccessCount(window) > zeroSuccessCount(previous)) return report("withdrawing");
  // 两窗都是三点，比较总数等价于比较均值，避免引入分数。
  const hintTotal = (rows: readonly ScaffoldPointRow[]) => rows.reduce((sum, point) => sum + point.maxHintLevelUsed, 0);
  if (hintTotal(window) > hintTotal(previous)) return report("rising");
  return report("flat");
}
