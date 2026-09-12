import { expect, test } from "vitest";
import type { DiscriminatingProbe } from "../../src/challenge.js";
import { separatesTwo, selectDiscriminatingProbe } from "../../src/growth/probe-selection.js";
import { fakePlugin } from "../helpers/fake-plugin.js";
import { mathPlugin } from "../../../plugin-math/src/index.js";

const probe = (id: string): DiscriminatingProbe => ({ id, question: "请选择？", samples: {}, outcomes: {
  x: [{ hypothesisId: "a", direction: "supports" }, { hypothesisId: "b", direction: "weakens" }],
  y: [{ hypothesisId: "a", direction: "weakens" }, { hypothesisId: "b", direction: "supports" }],
} });
test("未触及第二候选和只有同向结果都不能分开", () => {
  const p = probe("p");
  p.outcomes = { x: [{ hypothesisId: "a", direction: "supports" }], y: [{ hypothesisId: "a", direction: "weakens" }] };
  expect(separatesTwo(p, "a", "b")).toBe(false);
  p.outcomes = { x: probe("p").outcomes.x! };
  expect(separatesTwo(p, "a", "b")).toBe(false);
  expect(separatesTwo(probe("p"), "a", "b")).toBe(true);
});
test("少于两个候选不选择，按支持次数和字典序固定前二", () => {
  expect(selectDiscriminatingProbe({ activeCandidates: [{ hypothesisKey: "a", supporting: 2 }], probes: [probe("p")], usedProbeIds: [] })).toBeNull();
  const candidates = [{ hypothesisKey: "b", supporting: 2 }, { hypothesisKey: "c", supporting: 1 }, { hypothesisKey: "a", supporting: 2 }];
  const result = selectDiscriminatingProbe({ activeCandidates: candidates, probes: [probe("z"), probe("a")], usedProbeIds: [] });
  expect(result?.discriminates).toEqual(["a", "b"]);
  expect(result?.probe.id).toBe("a");
  expect(candidates[0]?.hypothesisKey).toBe("b");
});
test("未用优先，其次触及活跃候选数量，最后探针字典序", () => {
  const wide = probe("z"); wide.outcomes.x!.push({ hypothesisId: "c", direction: "supports" });
  const input = { activeCandidates: ["a", "b", "c"].map(hypothesisKey => ({ hypothesisKey, supporting: 1 })), probes: [wide, probe("a")] };
  expect(selectDiscriminatingProbe({ ...input, usedProbeIds: [] })?.probe.id).toBe("z");
  expect(selectDiscriminatingProbe({ ...input, usedProbeIds: ["z"] })?.probe.id).toBe("a");
});
test("假插件现有探针通过真实判据", () => {
  const p = fakePlugin.discriminatingProbes(fakePlugin.createChallenge({ curriculumAnchor: "fake/unit-1" }))[0]!;
  expect(separatesTwo(p, "h1", "h2")).toBe(true);
});
test("真实插件的三个探针均能区分其候选", () => {
  const probes = mathPlugin.discriminatingProbes(mathPlugin.createChallenge({ curriculumAnchor: "人教版五上/小数乘法" }));
  expect(probes).toHaveLength(3);
  for (const p of probes) {
    const keys = [...new Set(Object.values(p.outcomes).flat().map(s => s.hypothesisId))];
    expect(keys.some(a => keys.some(b => separatesTwo(p, a, b)))).toBe(true);
  }
});
