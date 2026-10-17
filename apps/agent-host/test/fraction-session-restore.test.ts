import { describe, expect, test } from "vitest";
import type { FractionEnvelope } from "@ai-scholar/session-contracts";
import { fractionPack } from "../src/learning/fraction-pack.js";
import { FractionSession } from "../src/learning/fraction-session.js";

function cmd(sessionId: string, revision: number, type: string, payload: Record<string, unknown>, eventId: string, submissionId?: string): FractionEnvelope {
  return {
    schemaVersion: 1, sessionId, eventId, revision,
    ...(submissionId ? { submissionId } : {}),
    type, payload,
  } as FractionEnvelope;
}

// 一段覆盖多阶段的真实流程：探索提交 → 异议 → 澄清再提交 → 完成复盘 → 迁移 → 迁移中求助 → 完成 → 迁移提交 → 反馈 → 完成 → 暂停
function steps(s: FractionSession): (() => void)[] {
  return [
    () => expect(s.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 3 }, "e-submit-1", "sub-1"))).toMatchObject({ ok: true }),
    () => s.recordFeedback({ feedbackId: "fb-1", submissionId: "sub-1" }),
    () => expect(s.apply(cmd("s-1", 1, "contest", { feedbackId: "fb-1" }, "e-contest-1"))).toMatchObject({ ok: true }),
    () => expect(s.apply(cmd("s-1", 2, "submit", { challengeId: "fraction-compare-01", boardRevision: 4 }, "e-submit-2", "sub-2"))).toMatchObject({ ok: true }),
    () => s.completeReview(),
    () => expect(s.apply(cmd("s-1", 3, "startTransfer", { challengeId: "fraction-transfer-01" }, "e-transfer"))).toMatchObject({ ok: true }),
    () => expect(s.apply(cmd("s-1", 4, "requestHelp", { challengeId: "fraction-transfer-01" }, "e-help"))).toMatchObject({ ok: true }),
    () => s.completeReview(),
    () => expect(s.apply(cmd("s-1", 5, "submit", { challengeId: "fraction-transfer-01", boardRevision: 6 }, "e-submit-3", "sub-3"))).toMatchObject({ ok: true }),
    () => s.recordFeedback({ feedbackId: "fb-2", submissionId: "sub-3" }),
    () => s.completeReview(),
    () => expect(s.apply(cmd("s-1", 6, "pause", {}, "e-pause"))).toMatchObject({ ok: true }),
  ];
}
function run(s: FractionSession, from: number, to = Number.POSITIVE_INFINITY) {
  const all = steps(s);
  for (let i = from; i < Math.min(to, all.length); i++) all[i]!();
  return all.length;
}

describe("FractionSession 快照与恢复", () => {
  test("每个分割点 snapshot→restore→继续，最终状态与一路跑到底完全一致", () => {
    const probe = new FractionSession({ sessionId: "s-1", pack: fractionPack });
    const total = run(probe, 0, 0); // 只取步数
    for (let cut = 0; cut <= total; cut++) {
      const reference = new FractionSession({ sessionId: "s-1", pack: fractionPack });
      run(reference, 0);
      const interrupted = new FractionSession({ sessionId: "s-1", pack: fractionPack });
      run(interrupted, 0, cut);
      const restored = FractionSession.restore({ sessionId: "s-1", pack: fractionPack, snapshot: interrupted.snapshot() });
      run(restored, cut); // 从中断点继续
      expect(restored.snapshot(), `cut=${cut}`).toEqual(reference.snapshot());
    }
  });

  test("appliedEventIds 进快照：恢复后重放旧事件幂等返回 duplicate，而不是重复生效", () => {
    const s = new FractionSession({ sessionId: "s-1", pack: fractionPack });
    run(s, 0, 1); // e-submit-1 已生效，revision=1
    const restored = FractionSession.restore({ sessionId: "s-1", pack: fractionPack, snapshot: s.snapshot() });
    expect(restored.apply(cmd("s-1", 0, "submit", { challengeId: "fraction-compare-01", boardRevision: 3 }, "e-submit-1", "sub-1")))
      .toEqual({ ok: true, duplicate: true });
    expect(restored.submissions).toHaveLength(1);
    expect(restored.revision).toBe(1);
  });

  test("恢复后旧 revision 被拒绝、合法新事件正常流转", () => {
    const s = new FractionSession({ sessionId: "s-1", pack: fractionPack });
    run(s, 0, 3); // 异议后 clarifying，revision=2
    const restored = FractionSession.restore({ sessionId: "s-1", pack: fractionPack, snapshot: s.snapshot() });
    expect(restored.apply(cmd("s-1", 1, "pause", {}, "e-stale"))).toEqual({ ok: false, reason: "staleRevision" });
    expect(restored.apply(cmd("s-1", 2, "submit", { challengeId: "fraction-compare-01", boardRevision: 4 }, "e-submit-2b", "sub-2")))
      .toMatchObject({ ok: true, duplicate: false });
    expect(restored.phase).toBe("reviewing");
  });

  test("被异议反馈的使用资格跨恢复保留：contested 标记不失忆", () => {
    const s = new FractionSession({ sessionId: "s-1", pack: fractionPack });
    run(s, 0, 3); // fb-1 已被异议，revision=2
    const restored = FractionSession.restore({ sessionId: "s-1", pack: fractionPack, snapshot: s.snapshot() });
    expect(restored.isFeedbackUsable("fb-1")).toBe(false);
    // 恢复后记录新反馈并可再异议
    restored.apply(cmd("s-1", 2, "submit", { challengeId: "fraction-compare-01", boardRevision: 4 }, "e-submit-2b", "sub-2"));
    restored.recordFeedback({ feedbackId: "fb-9", submissionId: "sub-2" });
    expect(restored.isFeedbackUsable("fb-9")).toBe(true);
    expect(restored.apply(cmd("s-1", 3, "contest", { feedbackId: "fb-9" }, "e-contest-9"))).toMatchObject({ ok: true });
    expect(restored.isFeedbackUsable("fb-9")).toBe(false);
  });

  test("paused 状态恢复后 resume 回到暂停前阶段", () => {
    const s = new FractionSession({ sessionId: "s-1", pack: fractionPack });
    run(s, 0, 1); // reviewing
    s.apply(cmd("s-1", 1, "pause", {}, "e-pause-1")); // pausedFrom=reviewing
    expect(s.phase).toBe("paused");
    const restored = FractionSession.restore({ sessionId: "s-1", pack: fractionPack, snapshot: s.snapshot() });
    expect(restored.phase).toBe("paused");
    expect(restored.apply(cmd("s-1", 2, "resume", {}, "e-resume"))).toMatchObject({ ok: true });
    expect(restored.phase).toBe("reviewing");
  });

  test("非法快照拒绝恢复：缺字段、坏枚举、未知题目都抛错", () => {
    const s = new FractionSession({ sessionId: "s-1", pack: fractionPack });
    run(s, 0, 1);
    const good = s.snapshot();
    expect(() => FractionSession.restore({ sessionId: "s-1", pack: fractionPack, snapshot: { ...good, phase: "flying" } })).toThrow();
    expect(() => FractionSession.restore({ sessionId: "s-1", pack: fractionPack, snapshot: { phase: "exploring" } })).toThrow();
    expect(() => FractionSession.restore({
      sessionId: "s-1", pack: fractionPack,
      snapshot: { ...good, currentAttempt: { challengeId: "not-a-challenge", hintUsed: false } },
    })).toThrow();
  });
});
