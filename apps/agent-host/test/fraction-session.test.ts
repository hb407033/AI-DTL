import { describe, expect, test } from "vitest";
import type { FractionEnvelope } from "@ai-scholar/session-contracts";
import { FRACTION_PACK_VERSION, fractionPack, getChallenge } from "../src/learning/fraction-pack.js";
import { FractionSession } from "../src/learning/fraction-session.js";

let seq = 0;
function cmd(sessionId: string, revision: number, type: string, payload: Record<string, unknown>): FractionEnvelope {
  return {
    schemaVersion: 1, sessionId, eventId: `e-${++seq}`, revision,
    ...(type === "submit" ? { submissionId: `sub-${seq}` } : {}),
    type, payload,
  } as FractionEnvelope;
}

describe("三题题包", () => {
  test("题包有版本，包含探索/针对性/迁移三题且 id 唯一", () => {
    expect(FRACTION_PACK_VERSION).toBeTruthy();
    expect(fractionPack.version).toBe(FRACTION_PACK_VERSION);
    const ids = fractionPack.challenges.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(getChallenge("fraction-compare-01")?.role).toBe("explore");
    expect(getChallenge("fraction-whole-01")?.role).toBe("targeted");
    expect(getChallenge("fraction-transfer-01")?.role).toBe("transfer");
  });

  test("人工核验依据成立：3/4>2/3、1/2=2/4、4/5>3/4", () => {
    expect(getChallenge("fraction-compare-01")?.verification).toContain("9/12");
    expect(getChallenge("fraction-whole-01")?.verification).toContain("1/2");
    expect(getChallenge("fraction-transfer-01")?.verification).toContain("16/20");
  });

  test("核验依据不出现在给孩子看的题干里，提示与题干分开保存", () => {
    for (const c of fractionPack.challenges) {
      expect(c.prompt).not.toContain(c.verification);
      for (const leaked of ["9/12", "8/12", "16/20", "15/20", "通分"]) {
        expect(c.prompt, `${c.id} 题干不得包含 ${leaked}`).not.toContain(leaked);
      }
      expect(Array.isArray(c.hints)).toBe(true);
    }
  });
});

describe("分数学习会话状态机", () => {
  const newSession = () => new FractionSession({ sessionId: "s-1", pack: fractionPack });

  test("初始为 exploring，revision 为 0，当前尝试为探索题且无提示", () => {
    const s = newSession();
    expect(s.phase).toBe("exploring");
    expect(s.revision).toBe(0);
    expect(s.currentAttempt).toMatchObject({ challengeId: "fraction-compare-01", hintUsed: false });
  });

  test("探索中主动 submit 进入 reviewing，记录不可变提交快照", () => {
    const s = newSession();
    const r = s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 3 }));
    expect(r).toEqual({ ok: true, duplicate: false });
    expect(s.phase).toBe("reviewing");
    expect(s.revision).toBe(1);
    expect(s.submissions).toHaveLength(1);
    expect(s.submissions[0]).toMatchObject({ challengeId: "fraction-compare-01", boardRevision: 3, hintUsed: false });
  });

  test("同 eventId 重放只生效一次", () => {
    const s = newSession();
    const e = cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 3 });
    expect(s.apply(e)).toEqual({ ok: true, duplicate: false });
    expect(s.apply({ ...e })).toEqual({ ok: true, duplicate: true });
    expect(s.phase).toBe("reviewing");
    expect(s.revision).toBe(1);
    expect(s.submissions).toHaveLength(1);
  });

  test("旧 revision 被拒绝且不改变状态", () => {
    const s = newSession();
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    const r = s.apply(cmd("s-1", 0, "pause", {}));
    expect(r).toEqual({ ok: false, reason: "staleRevision" });
    expect(s.phase).toBe("reviewing");
  });

  test("sessionId 不匹配的 envelope 被拒绝", () => {
    const s = newSession();
    expect(s.apply(cmd("other", 0, "pause", {}))).toEqual({ ok: false, reason: "wrongSession" });
  });

  test("未知题目或与当前尝试不符的提交被拒绝", () => {
    const s = newSession();
    expect(s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-unknown", boardRevision: 0 })))
      .toEqual({ ok: false, reason: "unknownChallenge" });
    expect(s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-transfer-01", boardRevision: 0 })))
      .toEqual({ ok: false, reason: "challengeMismatch" });
    expect(s.phase).toBe("exploring");
  });

  test("求助进入 reviewing，完成反馈后回到原作答阶段且尝试带提示标记", () => {
    const s = newSession();
    expect(s.apply(cmd("s-1", 0, "requestHelp", { challengeId: "fraction-compare-01" })).ok).toBe(true);
    expect(s.phase).toBe("reviewing");
    expect(s.currentAttempt.hintUsed).toBe(true);
    s.completeReview();
    expect(s.phase).toBe("exploring");
    const r = s.apply(cmd("s-1", 1, "submit", { challengeId: "fraction-compare-01", boardRevision: 4 }));
    expect(r).toEqual({ ok: true, duplicate: false });
    expect(s.submissions.at(-1)).toMatchObject({ hintUsed: true });
  });

  test("submit 后 completeReview 回到 exploring", () => {
    const s = newSession();
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    s.completeReview();
    expect(s.phase).toBe("exploring");
  });

  test("completeReview 只在 reviewing 合法", () => {
    const s = newSession();
    expect(() => s.completeReview()).toThrowError();
  });

  test("reviewing 中 contest 进入 clarifying，被异议反馈失去使用资格", () => {
    const s = newSession();
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    const submissionId = s.submissions[0]!.submissionId;
    s.recordFeedback({ feedbackId: "fb-1", submissionId });
    expect(s.isFeedbackUsable("fb-1")).toBe(true);
    const r = s.apply(cmd("s-1", 1, "contest", { feedbackId: "fb-1" }));
    expect(r).toEqual({ ok: true, duplicate: false });
    expect(s.phase).toBe("clarifying");
    expect(s.isFeedbackUsable("fb-1")).toBe(false);
  });

  test("contest 未知反馈被拒绝", () => {
    const s = newSession();
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    expect(s.apply(cmd("s-1", 1, "contest", { feedbackId: "nope" }))).toEqual({ ok: false, reason: "unknownFeedback" });
    expect(s.phase).toBe("reviewing");
  });

  test("clarifying 中重新 submit 回到 reviewing", () => {
    const s = newSession();
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    s.recordFeedback({ feedbackId: "fb-1", submissionId: s.submissions[0]!.submissionId });
    s.apply(cmd("s-1", 1, "contest", { feedbackId: "fb-1" }));
    const r = s.apply(cmd("s-1", 2, "submit", { challengeId: "fraction-compare-01", boardRevision: 2 }));
    expect(r).toEqual({ ok: true, duplicate: false });
    expect(s.phase).toBe("reviewing");
    expect(s.submissions).toHaveLength(2);
  });

  test("pause 保存前态，resume 恢复；paused 中不接受教学命令", () => {
    const s = newSession();
    expect(s.apply(cmd("s-1", 0, "pause", {})).ok).toBe(true);
    expect(s.phase).toBe("paused");
    expect(s.apply(cmd("s-1", 1, "submit", { challengeId: "fraction-compare-01", boardRevision: 0 })))
      .toEqual({ ok: false, reason: "invalidTransition" });
    expect(s.apply(cmd("s-1", 1, "resume", {})).ok).toBe(true);
    expect(s.phase).toBe("exploring");
  });

  test("reviewing 中 pause 后 resume 回到 reviewing", () => {
    const s = newSession();
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    s.apply(cmd("s-1", 1, "pause", {}));
    expect(s.phase).toBe("paused");
    s.apply(cmd("s-1", 2, "resume", {}));
    expect(s.phase).toBe("reviewing");
  });

  test("startTransfer 进入迁移作答，submit 后回 reviewing，记录迁移提交", () => {
    const s = newSession();
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    s.completeReview();
    expect(s.apply(cmd("s-1", 1, "startTransfer", { challengeId: "fraction-transfer-01" })).ok).toBe(true);
    expect(s.phase).toBe("transfer");
    expect(s.currentAttempt).toMatchObject({ challengeId: "fraction-transfer-01", hintUsed: false });
    const r = s.apply(cmd("s-1", 2, "submit", { challengeId: "fraction-transfer-01", boardRevision: 5 }));
    expect(r).toEqual({ ok: true, duplicate: false });
    expect(s.phase).toBe("reviewing");
    expect(s.submissions.at(-1)).toMatchObject({ challengeId: "fraction-transfer-01", hintUsed: false });
  });

  test("startTransfer 只允许迁移题，且 transfer 中不能嵌套", () => {
    const s = newSession();
    expect(s.apply(cmd("s-1", 0, "startTransfer", { challengeId: "fraction-compare-01" })))
      .toEqual({ ok: false, reason: "notTransferChallenge" });
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    s.apply(cmd("s-1", 1, "startTransfer", { challengeId: "fraction-transfer-01" }));
    expect(s.apply(cmd("s-1", 2, "startTransfer", { challengeId: "fraction-transfer-01" })))
      .toEqual({ ok: false, reason: "invalidTransition" });
  });

  test("迁移中求助后回到 transfer 再提交，提交标 hintUsed=true", () => {
    const s = newSession();
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    s.apply(cmd("s-1", 1, "startTransfer", { challengeId: "fraction-transfer-01" }));
    expect(s.apply(cmd("s-1", 2, "requestHelp", { challengeId: "fraction-transfer-01" })).ok).toBe(true);
    expect(s.phase).toBe("reviewing");
    s.completeReview();
    expect(s.phase).toBe("transfer");
    const r = s.apply(cmd("s-1", 3, "submit", { challengeId: "fraction-transfer-01", boardRevision: 6 }));
    expect(r).toEqual({ ok: true, duplicate: false });
    expect(s.submissions.at(-1)).toMatchObject({ challengeId: "fraction-transfer-01", hintUsed: true });
  });

  test("finishSession 结束本次学习；结束后拒绝一切命令", () => {
    const s = newSession();
    s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 1 }));
    expect(s.apply(cmd("s-1", 1, "finishSession", { reason: "rest" })).ok).toBe(true);
    expect(s.phase).toBe("finished");
    expect(s.apply(cmd("s-1", 2, "pause", {}))).toEqual({ ok: false, reason: "invalidTransition" });
  });
});
