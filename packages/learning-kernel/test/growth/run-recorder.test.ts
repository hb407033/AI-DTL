import { describe, expect, test } from "vitest";
import type { DisciplineEvidence, LearningChallenge } from "../../src/challenge.js";
import { RunRecorder } from "../../src/growth/run-recorder.js";
import { fakePlugin } from "../helpers/fake-plugin.js";

const challenge: LearningChallenge = fakePlugin.createChallenge({ curriculumAnchor: "fake/unit-1" });
const start = (at = 0) => {
  const recorder = new RunRecorder("s-1", "kid");
  recorder.beginRun(challenge, 1, 1, at);
  return recorder;
};
const evidence = (id: string, direction: "supports" | "weakens"): DisciplineEvidence => ({
  evidenceId: id, eventId: `e-${id}`, kind: "answer", summary: id,
  hypothesisSupport: [{ hypothesisId: "h1", direction }],
  surfaceContextKey: challenge.surfaceContextKey, selfCorrection: false,
});

test("探针预算独立且两次之间必须新产出，重启不能绕过", () => {
  const r = start();
  expect(r.canIssueProbe()).toBe(true);
  expect(r.noteProbeIssued("p1", ["h1", "h2"], 1)).toBe(true);
  expect(r.canIssueProbe()).toBe(false);
  expect(RunRecorder.from(r.toJSON()).canIssueProbe()).toBe(false);
  expect(r.noteProbeIssued("p2", ["h1", "h2"], 2)).toBe(false);
  for (const id of ["p2", "p3"]) { r.noteChildOutput(3); expect(r.noteProbeIssued(id, ["h1", "h2"], 4)).toBe(true); }
  r.noteChildOutput(5);
  expect(r.canIssueProbe()).toBe(false);
  expect(r.snapshot(6)).toMatchObject({ probesIssued: 3, maxHintLevelUsed: 0, escalationCount: 0 });
});
test("探针只凭当前前二的相反方向解决，新候选进入后失效", () => {
  const r = start();
  const supports = [{ hypothesisId: "h1", direction: "supports" as const }, { hypothesisId: "h2", direction: "weakens" as const }];
  r.noteEvidence({ ...evidence("x", "supports"), hypothesisSupport: supports }, 1);
  r.noteProbeIssued("p", ["h1", "h2"], 2);
  r.noteProbeOutcome("x", supports.slice(0, 1));
  expect(r.snapshot(3).probeResolved).toBe(false);
  r.noteProbeOutcome("x", supports);
  expect(r.snapshot(3).probeResolved).toBe(true);
  r.noteEvidence({ ...evidence("y", "supports"), hypothesisSupport: [{ hypothesisId: "h3", direction: "supports" }] }, 4);
  expect(r.snapshot(5).probeResolved).toBe(false);
});
test("序列化与恢复的嵌套事实不能从外部改写", () => {
  const r = start(); r.noteEvidence(evidence("x", "supports"), 1);
  const state = r.toJSON(); const restored = RunRecorder.from(state);
  state.run!.supportCount.h1 = 999; state.run!.usedProbeIds.push("injected");
  expect(r.activeCandidates()[0]?.supporting).toBe(1);
  expect(restored.activeCandidates()[0]?.supporting).toBe(1);
  expect(restored.usedProbeIds()).toEqual([]);
});

describe("一轮挑战的记账", () => {
  test("开轮生成新标识并把上一轮的记账清干净", () => {
    const recorder = start();
    recorder.noteHint(2, 5);
    const firstRunId = recorder.snapshot(9).runId;
    recorder.beginRun(challenge, 1, 10, 10);
    const second = recorder.snapshot(19);
    expect(second.runId).not.toBe(firstRunId);
    expect([second.maxHintLevelUsed, second.escalationCount]).toEqual([0, 0]);
  });

  test("首次有效产出的耗时只记第一次", () => {
    const recorder = start(100);
    recorder.noteFirstProductiveAction(400);
    recorder.noteFirstProductiveAction(900);
    expect(recorder.snapshot(1000).timeToFirstProductiveActionMs).toBe(300);
  });

  test("提示级别与升级次数照常累计", () => {
    const recorder = start();
    recorder.noteHint(1, 1);
    recorder.noteHint(2, 2);
    const snap = recorder.snapshot(9);
    expect([snap.maxHintLevelUsed, snap.escalationCount]).toEqual([2, 2]);
    expect(snap.transferTainted).toBe(false);
  });
});

describe("无提示迁移的判定堵住绕路", () => {
  test("迁移期间直接拿提示：迁移提示级别与污染标记都记上", () => {
    const recorder = start();
    recorder.enterTransfer(10);
    recorder.noteHint(2, 11);
    const snap = recorder.snapshot(20);
    expect(snap.transferHintLevelUsed).toBe(2);
    expect(snap.transferTainted).toBe(true);
  });

  test("绕道求助去评估再拿提示，一样算污染——判据不看当时处在哪个状态", () => {
    const recorder = start();
    recorder.enterTransfer(10);
    recorder.noteHint(1, 15);       // 实际发生在 INTERVENING，但迁移还没有结果
    expect(recorder.snapshot(20).transferTainted).toBe(true);
  });

  test("重进迁移不清污染标记，只有开新一轮才清", () => {
    const recorder = start();
    recorder.enterTransfer(10);
    recorder.noteHint(1, 11);
    recorder.enterTransfer(30);
    expect(recorder.snapshot(40).transferTainted).toBe(true);
    recorder.beginRun(challenge, 1, 50, 50);
    expect(recorder.snapshot(60).transferTainted).toBe(false);
  });

  test("迁移之前拿过提示不算污染：四级演示后的零提示迁移仍算无提示", () => {
    const recorder = start();
    recorder.noteHint(4, 5);
    recorder.enterTransfer(10);
    recorder.noteTransferOutcome("succeeded");
    const snap = recorder.snapshot(20);
    expect([snap.transferHintLevelUsed, snap.transferTainted, snap.maxHintLevelUsed]).toEqual([0, false, 4]);
    expect(snap.transferOutcome).toBe("succeeded");
  });
});

describe("辅助轮是粘性的", () => {
  test("本轮一旦被标为辅助轮就一直是，后续状态洗不掉", () => {
    const recorder = start();
    recorder.noteAssisted();
    recorder.noteChildOutput(5);
    expect(recorder.snapshot(9).assistedRound).toBe(true);
    recorder.beginRun(challenge, 1, 10, 10);
    expect(recorder.snapshot(19).assistedRound).toBe(false);
  });
});

describe("自我修正与活跃候选", () => {
  test("同一候选方向从支持翻成削弱、中间没给过提示，算孩子自己改对了", () => {
    const recorder = start();
    recorder.noteEvidence(evidence("a", "supports"), 1);
    recorder.noteEvidence(evidence("b", "weakens"), 2);
    expect(recorder.snapshot(9).selfCorrectionObserved).toBe(true);
  });

  test("中间给过提示就不算自己改对的", () => {
    const recorder = start();
    recorder.noteEvidence(evidence("a", "supports"), 1);
    recorder.noteHint(1, 2);
    recorder.noteEvidence(evidence("b", "weakens"), 3);
    expect(recorder.snapshot(9).selfCorrectionObserved).toBe(false);
  });

  test("插件直接标注的自我修正也算", () => {
    const recorder = start();
    recorder.noteEvidence({ ...evidence("a", "supports"), selfCorrection: true }, 1);
    expect(recorder.snapshot(9).selfCorrectionObserved).toBe(true);
  });

  test("活跃候选按支持次数排序，供选探针用", () => {
    const recorder = start();
    recorder.noteEvidence(evidence("a", "supports"), 1);
    recorder.noteEvidence({ ...evidence("b", "supports"), hypothesisSupport: [{ hypothesisId: "h2", direction: "supports" }] }, 2);
    recorder.noteEvidence({ ...evidence("c", "supports"), hypothesisSupport: [{ hypothesisId: "h2", direction: "supports" }] }, 3);
    expect(recorder.activeCandidates().map((c) => c.hypothesisKey)).toEqual(["h2", "h1"]);
  });

  test("本轮最多三个活跃候选，第四个保留证据但不参与当前选择", () => {
    const recorder = start();
    for (const key of ["h1", "h2", "h3", "h4"]) recorder.noteEvidence({ ...evidence(key, "supports"), hypothesisSupport: [{ hypothesisId: key, direction: "supports" }] }, 1);
    expect(recorder.activeCandidates().map(c => c.hypothesisKey)).toEqual(["h1", "h2", "h3"]);
  });

  test("新区分任务可从没有旧候选开始，只有明确相反结果才标记区分完成", () => {
    const recorder = start();
    recorder.noteProbeIssued("new-probe", ["h1", "h2"], 1);
    recorder.noteProbeOutcome("unclear", [{ hypothesisId: "h1", direction: "supports" }]);
    expect(recorder.snapshot(2).probeResolved).toBe(false);
    recorder.noteProbeOutcome("different", [{ hypothesisId: "h1", direction: "supports" }, { hypothesisId: "h2", direction: "weakens" }]);
    expect(recorder.snapshot(3)).toMatchObject({ probeResolved: true, discriminates: ["h1", "h2"] });
  });
});

describe("重启后接着记，不从零开始", () => {
  test("序列化再还原，全部记账续上", () => {
    const recorder = start();
    recorder.noteHint(2, 5);
    recorder.enterTransfer(10);
    recorder.noteHint(1, 11);
    recorder.noteAssisted();
    recorder.noteEvidence(evidence("a", "supports"), 12);
    recorder.noteProbeIssued("probe-1", ["h1", "h2"], 13);
    const before = recorder.snapshot(20);
    const restored = RunRecorder.from(JSON.parse(JSON.stringify(recorder.toJSON())));
    expect(restored.snapshot(20)).toEqual(before);
    expect(restored.usedProbeIds()).toEqual(["probe-1"]);
  });
});
