// packages/learning-kernel/src/bridges/parent-coach-bridge.ts
// 家长接管桥接：内核的提案请求挂起，家长在控制台输入一句话、一个动作与提示级别后才返回。
// 家长必须标注提示级别（设计稿 10.8），否则预算与退出趋势失真。
import type { CanvasAction, TeachingProposal } from "@ai-scholar/session-contracts";
import type { RealtimeBridge, TurnContext } from "../bridge.js";

export interface ParentInput {
  spokenResponse: string;
  learnerTask: string;
  hintLevel: number;
  canvasActions?: CanvasAction[] | undefined;
}

export class ParentCoachBridge implements RealtimeBridge {
  readonly kind = "parent" as const;
  private waiting: { turn: TurnContext; resolve: (p: TeachingProposal) => void; reject: (reason: Error) => void } | null = null;
  private counter = 0;

  async start(_sessionId: string): Promise<void> {}

  requestProposal(turn: TurnContext): Promise<TeachingProposal> {
    if (this.waiting) throw new Error("上一轮家长输入尚未完成");
    return new Promise((resolve, reject) => { this.waiting = { turn, resolve, reject }; });
  }

  pending(): TurnContext | null { return this.waiting?.turn ?? null; }

  submit(input: ParentInput): TeachingProposal {
    if (!this.waiting) throw new Error("没有等待中的请求");
    if (!Number.isInteger(input.hintLevel) || input.hintLevel < 0 || input.hintLevel > 5) throw new Error("家长输入必须标注 0–5 的提示级别");
    this.counter += 1;
    const proposal: TeachingProposal = {
      proposalId: `parent-${this.counter}`, spokenResponse: input.spokenResponse, learnerTask: input.learnerTask,
      canvasActions: input.canvasActions ?? [], expectedEvidence: [], hintLevel: input.hintLevel,
    };
    const { resolve } = this.waiting;
    this.waiting = null;
    resolve(proposal);
    return proposal;
  }

  async stop(): Promise<void> { const waiting = this.waiting; this.waiting = null; waiting?.reject(new Error("bridgeStopped")); }
}
