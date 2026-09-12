import type { DiscriminatingProbe } from "../challenge.js";

export const PROBE_BUDGET = Object.freeze({ maxPerRun: 3, maxPerAssessing: 1 });

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const direction = (probe: DiscriminatingProbe, outcome: string, key: string) =>
  probe.outcomes[outcome]?.find((support) => support.hypothesisId === key)?.direction ?? "none";

/** 必须存在两种有区分力的回答，未出现的候选不能冒充反证。 */
export function separatesTwo(probe: DiscriminatingProbe, a: string, b: string): boolean {
  if (a === b) return false;
  const outcomes = Object.keys(probe.outcomes);
  return outcomes.some((o) => direction(probe, o, a) === "supports" && direction(probe, o, b) === "weakens")
    && outcomes.some((o) => direction(probe, o, a) === "weakens" && direction(probe, o, b) !== "weakens");
}

export function selectDiscriminatingProbe(input: {
  activeCandidates: readonly { hypothesisKey: string; supporting: number }[];
  probes: readonly DiscriminatingProbe[];
  usedProbeIds: readonly string[];
}): { probe: DiscriminatingProbe; discriminates: readonly [string, string] } | null {
  const sorted = [...input.activeCandidates].sort((a, b) => b.supporting - a.supporting || compare(a.hypothesisKey, b.hypothesisKey));
  const a = sorted[0]?.hypothesisKey, b = sorted[1]?.hypothesisKey;
  if (a === undefined || b === undefined) return null;
  const candidates = new Set(sorted.map((candidate) => candidate.hypothesisKey));
  const used = new Set(input.usedProbeIds);
  const touched = (probe: DiscriminatingProbe) => new Set(Object.values(probe.outcomes).flat()
    .map((support) => support.hypothesisId).filter((key) => candidates.has(key))).size;
  const probe = input.probes.filter((p) => separatesTwo(p, a, b)).sort((x, y) =>
    Number(used.has(x.id)) - Number(used.has(y.id)) || touched(y) - touched(x) || compare(x.id, y.id))[0];
  return probe ? { probe, discriminates: [a, b] } : null;
}
