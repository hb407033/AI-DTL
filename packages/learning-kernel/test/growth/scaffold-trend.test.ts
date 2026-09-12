import { expect, test } from "vitest";
import { analyzeScaffoldTrend, isComparable, type ScaffoldPointRow, type TrendGapRow } from "../../src/growth/scaffold-trend.js";

const points = (hints: number[]): ScaffoldPointRow[] => hints.map((maxHintLevelUsed, index) => ({
  pointId: `p${index}`, learnerId: "learner", runId: `r${index}`, challengeId: `c${index}`,
  goalKind: "developmentGoal", goalId: "goal", probeFamilyId: "family", difficultyBand: "band",
  difficultyBandIndex: 1, maxHintLevelUsed, escalationCount: 0, probesIssued: 0,
  independentTransferSucceeded: false, timeToFirstProductiveActionMs: null,
  selfCorrectionObserved: false, assistedRound: false, occurredAt: index + 1,
}));
const gap: TrendGapRow = { gapId: "gap", learnerId: "learner", goalId: "goal", probeFamilyId: "family", difficultyBandIndex: 1, removedCount: 2, addedSinceCount: 0, removedAt: 3 };
const analyze = (rows: ScaffoldPointRow[], gaps: TrendGapRow[] = []) => analyzeScaffoldTrend({ points: rows, gaps });

test("70 / 77 三轮辅助失败仍然上升并暂停加难", () => {
  const result = analyze(points([1, 2, 3]).map(p => ({ ...p, assistedRound: true })));
  expect(result.verdict).toBe("rising");
  expect(result.alert).toEqual({ pauseDifficultyIncrease: true, interventionHistoryRunIds: ["r0", "r1", "r2"] });
});
test("71 没有完整前窗不得用零基线判退出", () => {
  const result = analyze(points([0, 0, 0]).map(p => ({ ...p, independentTransferSucceeded: true })));
  expect(result.verdict).toBe("flat");
  expect(result.teachingAdjustmentSuggested).toBe(true);
  expect(analyze(points([0, 0, 0, 0, 0]).map(p => ({ ...p, independentTransferSucceeded: true }))).verdict).toBe("flat");
});
test("72 首尾提示上升优先于零提示成功次数上升", () => {
  const rows = points([2, 2, 2, 0, 0, 3]);
  rows[3]!.independentTransferSucceeded = true;
  rows[4]!.independentTransferSucceeded = true;
  expect(analyze(rows).verdict).toBe("rising");
});
test.each([[3, 2, 1, "withdrawing"], [2, 2, 2, "flat"], [2, 3, 2, "flat"]])("73 首尾 %s %s %s 得到 %s", (a, b, c, verdict) => {
  const result = analyze(points([Number(a), Number(b), Number(c)]));
  expect(result.verdict).toBe(verdict);
  expect(result.teachingAdjustmentSuggested).toBe(verdict === "flat");
});
test("74 未补洞优先于空输入和点数不足", () => {
  for (const rows of [[], points([1]), points([1, 2, 3])]) {
    expect(analyze(rows, [gap])).toMatchObject({ verdict: "incomplete", reason: "artifactDeleted", alert: null });
  }
});
test("75 新点补齐洞之后恢复当次结论", () => {
  const rows = points([1, 1, 1, 2, 3]);
  expect(analyze(rows, [{ ...gap, addedSinceCount: rows.filter(p => p.occurredAt > gap.removedAt).length }]).verdict).toBe("rising");
});
test("76 只看同目标同探针且相邻难度的最新三点", () => {
  const rows = points([3, 1, 2, 3]);
  rows[0]!.difficultyBandIndex = 4;
  expect(analyze(rows).windowRunIds).toEqual(["r1", "r2", "r3"]);
  expect(isComparable(rows[0]!, rows[3]!)).toBe(false);
  expect(isComparable({ ...rows[0]!, difficultyBandIndex: 2 }, rows[3]!)).toBe(true);
  expect(isComparable({ ...rows[3]!, goalId: "other" }, rows[3]!)).toBe(false);
  expect(isComparable({ ...rows[3]!, probeFamilyId: "other" }, rows[3]!)).toBe(false);
});
test("78 无效难度点不成为最新参照并记录错误", () => {
  const rows = points([1, 2, 3, 0]); rows[3]!.difficultyBandIndex = -1;
  const result = analyze(rows);
  expect(result.verdict).toBe("rising");
  expect(result.policyErrors).toEqual([{ pointId: "p3", runId: "r3", code: "invalidDifficultyBandIndex" }]);
});
test("完整前窗用整数零提示成功次数，其次用提示总数", () => {
  const rows = points([0, 0, 0, 0, 0, 0]); rows[4]!.independentTransferSucceeded = true;
  expect(analyze(rows).verdict).toBe("withdrawing");
  expect(analyze(points([1, 1, 1, 2, 3, 2])).verdict).toBe("rising");
  const nonzero = points([2, 2, 2, 2, 2, 2]); nonzero[4]!.independentTransferSucceeded = true;
  expect(analyze(nonzero).verdict).toBe("flat");
});
test("探针次数不影响任何输出，输入不变", () => {
  const rows = points([1, 2, 3]); const before = structuredClone(rows);
  expect(analyze(rows.map(p => ({ ...p, probesIssued: 99 })))).toEqual(analyze(rows));
  expect(rows).toEqual(before);
  expect(analyze([]).verdict).toBe("insufficient");
});

test("完整新窗口之前的旧洞不污染当前趋势", () => {
  expect(analyze(points([1, 2, 3]).map(p => ({ ...p, occurredAt: p.occurredAt + 10 })), [gap]).verdict).toBe("rising");
});
