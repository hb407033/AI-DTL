// 分数学习会话：唯一权威流程写入者（2026-09-17 批准设计）。
// exploring/transfer 作答 → submit/requestHelp 进 reviewing → completeReview 回原作答阶段；
// reviewing 中 contest 进 clarifying；pause 只存前态不前进；finished 仅表示本次结束。
import { z } from "zod";
import {
  fractionEnvelopeSchema,
  fractionPhaseSchema,
  fractionSubmissionSchema,
  type FractionEnvelope,
  type FractionPhase,
  type FractionSubmission,
} from "@ai-scholar/session-contracts";
import { getChallenge, type fractionPack } from "./fraction-pack.js";

export type FractionApplyResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; reason: string };

type WorkingPhase = "exploring" | "transfer";

interface Attempt {
  challengeId: string;
  hintUsed: boolean;
}

interface FeedbackRecord {
  submissionId: string;
  contested: boolean;
}

// 恢复快照：含幂等表 appliedEventIds——缺了它重连后重复提交会重复生效。
// pausedFrom 记录暂停前阶段；恢复后 resume 必须回到原阶段。
export const fractionSessionSnapshotSchema = z.object({
  phase: fractionPhaseSchema,
  revision: z.number().int().nonnegative(),
  currentAttempt: z.object({ challengeId: z.string().min(1), hintUsed: z.boolean() }),
  submissions: z.array(fractionSubmissionSchema),
  appliedEventIds: z.array(z.string().min(1)),
  feedback: z.array(z.object({
    feedbackId: z.string().min(1),
    submissionId: z.string().min(1),
    contested: z.boolean(),
  })),
  originPhase: z.enum(["exploring", "transfer"]),
  pausedFrom: z.enum(["exploring", "reviewing", "clarifying", "transfer", "finished"]),
});
export type FractionSessionSnapshot = z.infer<typeof fractionSessionSnapshotSchema>;

export class FractionSession {
  readonly sessionId: string;
  private readonly pack: typeof fractionPack;
  phase: FractionPhase = "exploring";
  revision = 0;
  currentAttempt: Attempt;
  readonly submissions: FractionSubmission[] = [];
  private readonly appliedEventIds = new Set<string>();
  private readonly feedback = new Map<string, FeedbackRecord>();
  private originPhase: WorkingPhase = "exploring";
  private pausedFrom: Exclude<FractionPhase, "paused"> = "exploring";

  constructor(options: { sessionId: string; pack: typeof fractionPack }) {
    this.sessionId = options.sessionId;
    this.pack = options.pack;
    const explore = this.pack.challenges.find((c) => c.role === "explore");
    if (!explore) throw new Error("fractionPackMissingExplore");
    this.currentAttempt = { challengeId: explore.id, hintUsed: false };
  }

  /** 导出恢复所需的全部内部状态；返回值是深拷贝，外部改动不影响会话。 */
  snapshot(): FractionSessionSnapshot {
    return structuredClone({
      phase: this.phase,
      revision: this.revision,
      currentAttempt: this.currentAttempt,
      submissions: this.submissions,
      appliedEventIds: [...this.appliedEventIds],
      feedback: [...this.feedback.entries()].map(([feedbackId, record]) => ({ feedbackId, ...record })),
      originPhase: this.originPhase,
      pausedFrom: this.pausedFrom,
    });
  }

  /** 从快照完整还原；非法快照（坏结构/未知题目）直接抛错，不产生半成品会话。 */
  static restore(options: { sessionId: string; pack: typeof fractionPack; snapshot: unknown }): FractionSession {
    const parsed = fractionSessionSnapshotSchema.safeParse(options.snapshot);
    if (!parsed.success) throw new Error("invalidSnapshot");
    const snap = parsed.data;
    if (!getChallenge(snap.currentAttempt.challengeId)) throw new Error("invalidSnapshotChallenge");
    const session = new FractionSession({ sessionId: options.sessionId, pack: options.pack });
    session.phase = snap.phase;
    session.revision = snap.revision;
    session.currentAttempt = { ...snap.currentAttempt };
    session.submissions.push(...snap.submissions.map((s) => ({ ...s })));
    for (const id of snap.appliedEventIds) session.appliedEventIds.add(id);
    for (const f of snap.feedback) session.feedback.set(f.feedbackId, { submissionId: f.submissionId, contested: f.contested });
    session.originPhase = snap.originPhase;
    session.pausedFrom = snap.pausedFrom;
    return session;
  }

  /** 宿主在 AI 反馈实际呈现给孩子后登记；contest 只能针对已登记的反馈。 */
  recordFeedback(record: { feedbackId: string; submissionId: string }): void {
    this.feedback.set(record.feedbackId, { submissionId: record.submissionId, contested: false });
  }

  /** 被异议的反馈失去使用资格，不得再参与后续结论。 */
  isFeedbackUsable(feedbackId: string): boolean {
    const record = this.feedback.get(feedbackId);
    return !!record && !record.contested;
  }

  /** 反馈交互结束（未异议）后由宿主调用，回到进入 reviewing 前的作答阶段。 */
  completeReview(): void {
    if (this.phase !== "reviewing") throw new Error("completeReviewOutsideReviewing");
    this.phase = this.originPhase;
  }

  apply(raw: FractionEnvelope): FractionApplyResult {
    const parsed = fractionEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalidEnvelope" };
    const envelope = parsed.data;
    if (envelope.sessionId !== this.sessionId) return { ok: false, reason: "wrongSession" };
    if (this.appliedEventIds.has(envelope.eventId)) return { ok: true, duplicate: true };
    if (envelope.revision !== this.revision) return { ok: false, reason: "staleRevision" };
    const result = this.transition(envelope);
    if (!result.ok) return result;
    this.appliedEventIds.add(envelope.eventId);
    this.revision += 1;
    return { ok: true, duplicate: false };
  }

  private transition(envelope: FractionEnvelope): FractionApplyResult {
    const invalid = { ok: false as const, reason: "invalidTransition" };
    if (this.phase === "finished") return invalid;
    switch (envelope.type) {
      case "submit": {
        if (this.phase !== "exploring" && this.phase !== "transfer" && this.phase !== "clarifying") return invalid;
        const challenge = getChallenge(envelope.payload.challengeId);
        if (!challenge) return { ok: false, reason: "unknownChallenge" };
        if (challenge.id !== this.currentAttempt.challengeId) return { ok: false, reason: "challengeMismatch" };
        this.submissions.push({
          submissionId: envelope.submissionId,
          challengeId: challenge.id,
          boardRevision: envelope.payload.boardRevision,
          hintUsed: this.currentAttempt.hintUsed,
        });
        if (this.phase !== "clarifying") this.originPhase = this.phase;
        this.phase = "reviewing";
        return { ok: true, duplicate: false };
      }
      case "requestHelp": {
        if (this.phase !== "exploring" && this.phase !== "transfer") return invalid;
        const challenge = getChallenge(envelope.payload.challengeId);
        if (!challenge) return { ok: false, reason: "unknownChallenge" };
        if (challenge.id !== this.currentAttempt.challengeId) return { ok: false, reason: "challengeMismatch" };
        this.currentAttempt.hintUsed = true;
        this.originPhase = this.phase;
        this.phase = "reviewing";
        return { ok: true, duplicate: false };
      }
      case "contest": {
        if (this.phase !== "reviewing") return invalid;
        const record = this.feedback.get(envelope.payload.feedbackId);
        if (!record) return { ok: false, reason: "unknownFeedback" };
        record.contested = true;
        this.phase = "clarifying";
        return { ok: true, duplicate: false };
      }
      case "startTransfer": {
        if (this.phase !== "exploring" && this.phase !== "reviewing") return invalid;
        const challenge = getChallenge(envelope.payload.challengeId);
        if (!challenge) return { ok: false, reason: "unknownChallenge" };
        if (challenge.role !== "transfer") return { ok: false, reason: "notTransferChallenge" };
        this.currentAttempt = { challengeId: challenge.id, hintUsed: false };
        this.phase = "transfer";
        return { ok: true, duplicate: false };
      }
      case "pause": {
        if (this.phase === "paused") return invalid;
        this.pausedFrom = this.phase;
        this.phase = "paused";
        return { ok: true, duplicate: false };
      }
      case "resume": {
        if (this.phase !== "paused") return invalid;
        this.phase = this.pausedFrom;
        return { ok: true, duplicate: false };
      }
      case "finishSession": {
        this.phase = "finished";
        return { ok: true, duplicate: false };
      }
    }
  }
}
