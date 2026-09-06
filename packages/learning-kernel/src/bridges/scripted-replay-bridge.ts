// packages/learning-kernel/src/bridges/scripted-replay-bridge.ts
// 脚本回放桥接：按固定脚本逐轮返回提案，用于确定性测试（正常、越级、非法画布、转写错误等场景）。
// 脚本的 purpose 若与内核请求不一致立即报错，避免测试静默错位。
import type { TeachingProposal } from "@ai-scholar/session-contracts";
import type { RealtimeBridge, TurnContext, TurnPurpose } from "../bridge.js";

export interface ReplayScript {
  scriptVersion: 1;
  turns: Array<{ purpose?: TurnPurpose | undefined; proposal: TeachingProposal }>;
}

export class ScriptedReplayBridge implements RealtimeBridge {
  readonly kind = "scripted" as const;
  private cursor = 0;
  readonly requests: TurnContext[] = [];

  constructor(private readonly script: ReplayScript) {}

  async start(_sessionId: string): Promise<void> { this.cursor = 0; }

  async requestProposal(turn: TurnContext): Promise<TeachingProposal> {
    this.requests.push(turn);
    const entry = this.script.turns[this.cursor];
    if (!entry) throw new Error(`脚本已耗尽：第 ${this.cursor + 1} 轮没有提案（purpose=${turn.purpose}）`);
    if (entry.purpose && entry.purpose !== turn.purpose) throw new Error(`脚本第 ${this.cursor + 1} 轮 purpose 不匹配：期望 ${entry.purpose}，内核请求 ${turn.purpose}`);
    this.cursor += 1;
    return entry.proposal;
  }

  async stop(): Promise<void> {}
}
