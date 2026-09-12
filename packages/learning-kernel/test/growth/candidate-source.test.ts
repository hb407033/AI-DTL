import { expect, test } from "vitest";
import { buildCandidateDraft } from "../../src/growth/candidate.js";
import { RunRecorder } from "../../src/growth/run-recorder.js";
import { fakePlugin } from "../helpers/fake-plugin.js";

function input() {
  const challenge = fakePlugin.createChallenge({ curriculumAnchor: "test" });
  const recorder = new RunRecorder("s", "kid");
  recorder.beginRun(challenge, 0, 1, 10);
  recorder.enterTransfer(15);
  recorder.noteTransferOutcome("succeeded");
  const run = recorder.snapshot(20);
  return { learnerId: "kid", candidateId: "c", run, links: [], now: 20,
    knownHypothesisKeys: [], forbiddenClaimPatterns: [] };
}

test("干净迁移无需根因假设也能生成候选", () => {
  const result = buildCandidateDraft(input());
  expect(result?.hypothesisKeys).toEqual([]);
  expect(result?.proposedBy).toBe("kernel");
  expect(result?.transferRefs).toHaveLength(1);
});

test("辅助轮和迁移提示污染都不生成候选", () => {
  for (const patch of [{ assistedRound: true }, { transferTainted: true }, { transferHintLevelUsed: 1 }]) {
    const value = input();
    expect(buildCandidateDraft({ ...value, run: { ...value.run, ...patch } })).toBeNull();
  }
});

test("桥接与内核同主张合并，模型原句不进入候选", () => {
  const value = input();
  const candidate = buildCandidateDraft({ ...value, bridgeCandidate: {
    description: value.run.claimKey, evidenceEventIds: [], hypothesisKeys: [],
  } });
  expect(candidate?.proposedBy).toBe("bridge+kernel");
  expect(candidate).not.toHaveProperty("description");
  expect(buildCandidateDraft({ ...value, bridgeCandidate: {
    description: "另一个完全不同的主张", evidenceEventIds: [], hypothesisKeys: [],
  } })).toBeNull();
});

test("桥接未知或未区分根因拒绝，不回退到自建", () => {
  const value = input();
  const bridgeCandidate = { description: value.run.claimKey, evidenceEventIds: [], hypothesisKeys: ["h"] };
  expect(buildCandidateDraft({ ...value, bridgeCandidate })).toBeNull();
  expect(buildCandidateDraft({ ...value, bridgeCandidate, knownHypothesisKeys: ["h"] })).toBeNull();
});

test("演示后独立重建的迁移保留历史最高提示", () => {
  const value = input();
  const result = buildCandidateDraft({ ...value, run: { ...value.run, reconstructed: true, maxHintLevelUsed: 4 } });
  expect(result?.transferRefs[0]).toMatchObject({ achievedVia: "afterDemoRebuild", maxHintLevelUsedInRound: 4 });
});
