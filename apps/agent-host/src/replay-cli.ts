// apps/agent-host/src/replay-cli.ts
// 脚本回放：用固定的孩子事件序列 + 固定的桥接脚本跑一遍编排器，打印轨迹。
// 用于 15.3 模型行为测试与家长先导试验前的自检；没有 iPad 也能验证整条教学闭环。
import { readFileSync } from "node:fs";
import { InMemorySessionStore, ScriptedReplayBridge, SessionOrchestrator, type ReplayScript } from "@ai-scholar/learning-kernel";
import { mathPlugin } from "@ai-scholar/plugin-math";
import type { ChildOutbound, EventPayload } from "@ai-scholar/session-contracts";

export interface ChildEventScript { schemaVersion: 1; steps: Array<{ atMs: number; payload: EventPayload; quality?: "unconfirmed" | "confirmed" | undefined }> }

export interface ReplayTrace {
  finalState: string;
  hintLevels: number[];
  maxHintLevelUsed: number;
  independentSuccess: boolean;
  assistedRound: boolean;
  outbound: ChildOutbound[];
  policyErrors: number;
}

export async function runReplay(input: { script: ReplayScript; childEvents: ChildEventScript }): Promise<ReplayTrace> {
  const now = { t: 0 };
  const bridge = new ScriptedReplayBridge(input.script);
  const store = new InMemorySessionStore();
  const orchestrator = new SessionOrchestrator({ sessionId: "replay", plugin: mathPlugin, bridge, store, clock: () => now.t, challengeInput: { curriculumAnchor: mathPlugin.manifest.curriculumVersions[0] ?? "" } });
  const outbound: ChildOutbound[] = [...(await orchestrator.start())];
  let seq = 0;
  for (const step of input.childEvents.steps) {
    // 每一步之前按秒推进时钟，让窗口与超时逻辑真实生效
    while (now.t + 1_000 <= step.atMs) { now.t += 1_000; outbound.push(...(await orchestrator.tick(now.t))); }
    now.t = step.atMs;
    seq += 1;
    const result = await orchestrator.handleEvent({ eventId: `r-${seq}`, clientSessionId: "replay", deviceId: "replay", clientSeq: seq, occurredAt: now.t, quality: step.quality ?? "confirmed", source: "child_voice", semanticObjectIds: [], payload: step.payload });
    outbound.push(...result.outbound);
  }
  const hintLevels = store.listProposals("replay").filter((p) => p.accepted && p.proposal.hintLevel > 0).map((p) => p.proposal.hintLevel);
  return {
    finalState: orchestrator.context.state, hintLevels, maxHintLevelUsed: orchestrator.context.maxHintLevelUsed,
    independentSuccess: orchestrator.context.independentSuccess, assistedRound: orchestrator.context.assistedRound,
    outbound, policyErrors: orchestrator.context.policyErrors.length,
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const scriptPath = arg("--script") ?? new URL("../fixtures/scripted-happy-path.json", import.meta.url).pathname;
  const eventsPath = arg("--events") ?? new URL("../fixtures/child-events-help-path.json", import.meta.url).pathname;
  const trace = await runReplay({ script: JSON.parse(readFileSync(scriptPath, "utf8")), childEvents: JSON.parse(readFileSync(eventsPath, "utf8")) });
  for (const m of trace.outbound) console.log(JSON.stringify(m));
  console.log(JSON.stringify({ finalState: trace.finalState, hintLevels: trace.hintLevels, maxHintLevelUsed: trace.maxHintLevelUsed, independentSuccess: trace.independentSuccess, assistedRound: trace.assistedRound, policyErrors: trace.policyErrors }));
  process.exit(trace.finalState === "COMPLETED" ? 0 : 2);
}
