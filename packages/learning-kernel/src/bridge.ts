// packages/learning-kernel/src/bridge.ts
// RealtimeBridge（设计稿 10.8、11.3）：内核只认这个接口。三种实现输出同一个 TeachingProposal；
// 只有 codex 是 AI 模型路径，scripted 与 parent 不生成内容、不冒充在线。Codex 协议字段不得出现在这里。
import type { EvidenceEvent, TeachingProposal } from "@ai-scholar/session-contracts";
import type { DisciplineEvidence, LearningChallenge } from "./challenge.js";
import type { SessionState } from "./session-state.js";

export type TurnPurpose = "hint" | "explainBackPrompt" | "transferPrompt" | "softLanding" | "contestFollowUp";

export interface TurnContext {
  sessionId: string;
  purpose: TurnPurpose;
  state: SessionState;
  hintLevel: number;
  /** 本地内核授权的本轮最高提示级别；提案超过即被拒 */
  allowedMaxHintLevel: number;
  challenge: LearningChallenge;
  recentEvidence: DisciplineEvidence[];
  recentEvents: EvidenceEvent[];
  /** 上一次提案被拒的原因，供重述 */
  rejectionReasons: string[];
}

export interface RealtimeBridge {
  readonly kind: "codex" | "scripted" | "parent";
  start(sessionId: string): Promise<void>;
  requestProposal(turn: TurnContext): Promise<TeachingProposal>;
  stop(): Promise<void>;
}
