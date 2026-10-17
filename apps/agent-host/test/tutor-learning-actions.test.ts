import { describe, expect, test } from "vitest";
import type { FractionBoard, FractionSubmission } from "@ai-scholar/session-contracts";
import { TutorLearningActions } from "../src/ai/tutor-learning-actions.js";

// 与 fixtures/fraction-learning-v1.json 中 boardStates[0] 一致的画布：两个孩子矩形 + 一个 AI 提示矩形。
const fixtureBoard: FractionBoard = {
  revision: 3,
  rectangles: [
    { id: "rect-child-1", wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2, 3, 4, 5, 6, 7, 8], owner: "child" },
    { id: "rect-child-2", wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2, 3, 4, 5, 6, 7], owner: "child" },
    { id: "rect-agent-1", wholeGroupId: "whole-2", rows: 1, columns: 2, shadedCells: [0], owner: "agent" },
  ],
};
const submission: FractionSubmission = { submissionId: "submission-1", challengeId: "fraction-compare-01", boardRevision: 3, hintUsed: false };

function boundActions(board: FractionBoard = fixtureBoard) {
  const actions = new TutorLearningActions("s-1");
  actions.bindSubmission(submission, board);
  return actions;
}
function showHint(over: Record<string, unknown> = {}) {
  return {
    actionId: "act-1", sessionId: "s-1", submissionId: "submission-1", boardRevision: 3,
    type: "showHintRectangle", wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2], ...over,
  };
}

describe("AI 白名单图形动作校验", () => {
  test("没有绑定有效提交时一律拒绝（未经提交不得有图形动作）", () => {
    const actions = new TutorLearningActions("s-1");
    const r = actions.apply(showHint());
    expect(r).toMatchObject({ ok: false, reason: "noActiveSubmission" });
  });

  test("合法 showHintRectangle 生成 owner=agent 矩形并推进 boardRevision", () => {
    const actions = boundActions();
    const r = actions.apply(showHint());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duplicate).toBe(false);
    expect(r.boardRevision).toBe(4);
    expect(r.command.type).toBe("showHintRectangle");
    if (r.command.type !== "showHintRectangle") return;
    expect(r.command.rectangle).toMatchObject({ wholeGroupId: "whole-1", rows: 3, columns: 4, shadedCells: [0, 1, 2], owner: "agent" });
    expect(r.command.rectangle.id).toBeTruthy();
    // 宿主记录的画布同步更新，孩子对象不变
    const board = actions.snapshot();
    expect(board?.rectangles).toHaveLength(4);
    expect(board?.rectangles.filter((x) => x.owner === "child")).toEqual(fixtureBoard.rectangles.filter((x) => x.owner === "child"));
  });

  test("AI 参数里夹带 owner=child 被忽略，矩形归属恒为 agent", () => {
    const actions = boundActions();
    const r = actions.apply(showHint({ owner: "child" }));
    expect(r.ok).toBe(true);
    if (r.ok && r.command.type === "showHintRectangle") expect(r.command.rectangle.owner).toBe("agent");
  });

  test("矩形必须通过 fractionRectangleSchema：越界、重复、超格数、零行都拒绝", () => {
    const actions = boundActions();
    expect(actions.apply(showHint({ actionId: "a-out", shadedCells: [12] }))).toMatchObject({ ok: false, reason: "invalidRectangle" });
    expect(actions.apply(showHint({ actionId: "a-dup", shadedCells: [1, 1] }))).toMatchObject({ ok: false, reason: "invalidRectangle" });
    expect(actions.apply(showHint({ actionId: "a-big", rows: 8, columns: 8, shadedCells: [] }))).toMatchObject({ ok: false, reason: "invalidRectangle" });
    expect(actions.apply(showHint({ actionId: "a-zero", rows: 0 }))).toMatchObject({ ok: false, reason: "invalidRectangle" });
    expect(actions.snapshot()?.revision).toBe(3); // 拒绝不改变画布
  });

  test("未知动作拒绝，不猜测纠正", () => {
    const actions = boundActions();
    const r = actions.apply({ actionId: "a-x", sessionId: "s-1", submissionId: "submission-1", boardRevision: 3, type: "eraseChildInk", objectId: "rect-child-1" });
    expect(r).toMatchObject({ ok: false, reason: "unknownAction" });
    expect(actions.snapshot()?.rectangles).toHaveLength(3);
  });

  test("任何动作不得修改 owner=child 的对象", () => {
    const actions = boundActions();
    expect(actions.apply({ actionId: "a-h", sessionId: "s-1", submissionId: "submission-1", boardRevision: 3, type: "highlightCells", objectId: "rect-child-1", cells: [0] }))
      .toMatchObject({ ok: false, reason: "childObjectImmutable" });
    expect(actions.apply({ actionId: "a-hide", sessionId: "s-1", submissionId: "submission-1", boardRevision: 3, type: "hideHint", objectId: "rect-child-1" }))
      .toMatchObject({ ok: false, reason: "childObjectImmutable" });
    expect(actions.snapshot()?.rectangles.find((x) => x.id === "rect-child-1")).toEqual(fixtureBoard.rectangles[0]);
  });

  test("highlight/hide 引用宿主记录中不存在的 objectId 拒绝", () => {
    const actions = boundActions();
    expect(actions.apply({ actionId: "a-h", sessionId: "s-1", submissionId: "submission-1", boardRevision: 3, type: "highlightCells", objectId: "nope", cells: [0] }))
      .toMatchObject({ ok: false, reason: "unknownObject" });
    expect(actions.apply({ actionId: "a-hide", sessionId: "s-1", submissionId: "submission-1", boardRevision: 3, type: "hideHint", objectId: "nope" }))
      .toMatchObject({ ok: false, reason: "unknownObject" });
  });

  test("highlightCells 校验格子范围并更新 agent 矩形", () => {
    const actions = boundActions();
    const r = actions.apply({ actionId: "a-h", sessionId: "s-1", submissionId: "submission-1", boardRevision: 3, type: "highlightCells", objectId: "rect-agent-1", cells: [1] });
    expect(r).toMatchObject({ ok: true, boardRevision: 4 });
    expect(actions.snapshot()?.rectangles.find((x) => x.id === "rect-agent-1")?.shadedCells).toEqual([1]);
    expect(actions.apply({ actionId: "a-bad", sessionId: "s-1", submissionId: "submission-1", boardRevision: 4, type: "highlightCells", objectId: "rect-agent-1", cells: [2] }))
      .toMatchObject({ ok: false, reason: "invalidCells" }); // 1x2 矩形没有格子 2
    expect(actions.apply({ actionId: "a-bad2", sessionId: "s-1", submissionId: "submission-1", boardRevision: 4, type: "highlightCells", objectId: "rect-agent-1", cells: [1, 1] }))
      .toMatchObject({ ok: false, reason: "invalidCells" });
  });

  test("hideHint 移除 agent 提示矩形，孩子对象不受影响", () => {
    const actions = boundActions();
    const r = actions.apply({ actionId: "a-hide", sessionId: "s-1", submissionId: "submission-1", boardRevision: 3, type: "hideHint", objectId: "rect-agent-1" });
    expect(r).toMatchObject({ ok: true, boardRevision: 4 });
    const board = actions.snapshot();
    expect(board?.rectangles.map((x) => x.id)).toEqual(["rect-child-1", "rect-child-2"]);
  });

  test("同一 actionId 幂等：重放返回首次结果，不重复改画布", () => {
    const actions = boundActions();
    const first = actions.apply(showHint());
    expect(first).toMatchObject({ ok: true, duplicate: false, boardRevision: 4 });
    const replay = actions.apply(showHint({ rows: 9, columns: 9 })); // 同 actionId 不同参数
    expect(replay).toMatchObject({ ok: true, duplicate: true, boardRevision: 4 });
    if (first.ok && replay.ok) expect(replay.command).toEqual(first.command);
    expect(actions.snapshot()?.rectangles).toHaveLength(4);
    // 失败结果同样幂等
    const failFirst = actions.apply({ actionId: "a-f", sessionId: "s-1", submissionId: "submission-1", boardRevision: 4, type: "hideHint", objectId: "nope" });
    const failReplay = actions.apply({ actionId: "a-f", sessionId: "s-1", submissionId: "submission-1", boardRevision: 4, type: "hideHint", objectId: "rect-child-1" });
    expect(failFirst).toMatchObject({ ok: false, reason: "unknownObject", duplicate: false });
    expect(failReplay).toMatchObject({ ok: false, reason: "unknownObject", duplicate: true });
  });

  test("动作必须绑定当前 sessionId/submissionId/boardRevision：旧提交图形不得应用到新画布", () => {
    const actions = boundActions();
    expect(actions.apply(showHint({ actionId: "a-s", sessionId: "other" }))).toMatchObject({ ok: false, reason: "wrongSession" });
    expect(actions.apply(showHint({ actionId: "a-r", boardRevision: 2 }))).toMatchObject({ ok: false, reason: "staleRevision" });
    // 孩子重新提交，宿主绑定新提交与新画布 revision
    const newSubmission: FractionSubmission = { submissionId: "submission-2", challengeId: "fraction-compare-01", boardRevision: 5, hintUsed: false };
    actions.bindSubmission(newSubmission, { ...fixtureBoard, revision: 5 });
    // 旧提交的迟到动作一律拒绝
    expect(actions.apply(showHint({ actionId: "a-old" }))).toMatchObject({ ok: false, reason: "staleSubmission" });
    expect(actions.apply(showHint({ actionId: "a-oldrev", submissionId: "submission-2", boardRevision: 3 }))).toMatchObject({ ok: false, reason: "staleRevision" });
    // 新提交的合法动作正常执行
    expect(actions.apply(showHint({ actionId: "a-new", submissionId: "submission-2", boardRevision: 5 }))).toMatchObject({ ok: true, boardRevision: 6 });
  });

  test("清除提交绑定后（切题）旧动作不再可应用", () => {
    const actions = boundActions();
    actions.clearSubmission();
    expect(actions.apply(showHint({ actionId: "a-late" }))).toMatchObject({ ok: false, reason: "noActiveSubmission" });
  });

  test("agent 提示矩形数量受契约上限约束", () => {
    const crowded: FractionBoard = {
      revision: 0,
      rectangles: [1, 2, 3, 4].map((n) => ({ id: `agent-${n}`, wholeGroupId: "w", rows: 1, columns: 2, shadedCells: [0], owner: "agent" as const })),
    };
    const actions = new TutorLearningActions("s-1");
    actions.bindSubmission({ submissionId: "sub-crowded", challengeId: "fraction-compare-01", boardRevision: 0, hintUsed: true }, crowded);
    expect(actions.apply({ actionId: "a-5", sessionId: "s-1", submissionId: "sub-crowded", boardRevision: 0, type: "showHintRectangle", wholeGroupId: "w", rows: 1, columns: 2, shadedCells: [] }))
      .toMatchObject({ ok: false, reason: "boardLimit" });
  });
});
