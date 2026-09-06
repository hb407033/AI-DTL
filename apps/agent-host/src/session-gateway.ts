// apps/agent-host/src/session-gateway.ts
// 会话网关的纯逻辑：把 WebSocket 文本帧变成编排器调用，把编排器输出包成 ServerFrame。
// 一个进程内可同时承载多个会话；每个会话一个编排器与一个桥接实例。不碰 socket，便于测试。
import {
  ParentCoachBridge, SessionOrchestrator, type DisciplinePlugin, type ParentInput, type RealtimeBridge, type SessionStore, type TurnContext,
} from "@ai-scholar/learning-kernel";
import { SESSION_PROTOCOL_VERSION, clientFrameSchema, type ChildOutbound, type ServerFrame } from "@ai-scholar/session-contracts";

export interface SessionHostOptions {
  plugin: DisciplinePlugin;
  store: SessionStore;
  makeBridge: (sessionId: string) => RealtimeBridge;
  clock: () => number;
  curriculumAnchor?: string | undefined;
}

export interface ParentView {
  sessionId: string;
  state: string;
  hintLevel: number;
  assistedRound: boolean;
  challengePrompt: string;
  pending: { purpose: TurnContext["purpose"]; allowedMaxHintLevel: number } | null;
  recentEvidence: Array<{ kind: string; summary: string }>;
  policyErrors: number;
}

interface Live { orchestrator: SessionOrchestrator; bridge: RealtimeBridge; chain: Promise<void> }

export function createSessionHost(options: SessionHostOptions) {
  const sessions = new Map<string, Live>();
  const parentBridges = new Map<string, ParentCoachBridge>();
  const listeners = new Map<string, Set<(frames: ServerFrame[]) => void>>();
  const v = SESSION_PROTOCOL_VERSION;
  const wrap = (messages: ChildOutbound[]): ServerFrame[] => messages.map((message) => ({ protocolVersion: v, type: "outbound", message }));

  function live(sessionId: string): Live {
    const found = sessions.get(sessionId);
    if (!found) throw new Error(`会话 ${sessionId} 未打开`);
    return found;
  }

  /** 会话内串行：教学逻辑按事件顺序跑，tick 也排进同一条链 */
  function enqueue(sessionId: string, job: () => Promise<ChildOutbound[]>): void {
    const session = live(sessionId);
    session.chain = session.chain.then(async () => {
      const frames = wrap(await job());
      if (frames.length > 0) host.broadcast(sessionId, frames);
    }).catch(() => undefined);
  }

  const host = {
    /** 家长桥接按会话懒创建；makeBridge 返回它就让该会话走家长接管 */
    parentBridge(sessionId: string): ParentCoachBridge {
      const bridge = parentBridges.get(sessionId) ?? new ParentCoachBridge();
      parentBridges.set(sessionId, bridge);
      return bridge;
    },

    async open(sessionId: string): Promise<ServerFrame[]> {
      const existing = sessions.get(sessionId);
      if (existing) return [];
      const bridge = options.makeBridge(sessionId);
      if (bridge instanceof ParentCoachBridge) parentBridges.set(sessionId, bridge);
      const orchestrator = new SessionOrchestrator({
        sessionId, plugin: options.plugin, bridge, store: options.store, clock: options.clock,
        challengeInput: { curriculumAnchor: options.curriculumAnchor ?? options.plugin.manifest.curriculumVersions[0] ?? "" },
      });
      sessions.set(sessionId, { orchestrator, bridge, chain: Promise.resolve() });
      return wrap(await orchestrator.start());
    },

    /** 只回 ack/nack/error；教学输出经 subscribe 推送。重放时把当时的出站消息一并补发 */
    async handleFrame(sessionId: string, raw: string, now: number): Promise<ServerFrame[]> {
      let json: unknown;
      try { json = JSON.parse(raw); } catch { return [{ protocolVersion: v, type: "error", reason: "invalidJson" }]; }
      const parsed = clientFrameSchema.safeParse(json);
      if (!parsed.success) return [{ protocolVersion: v, type: "error", reason: "invalidFrame" }];
      const frame = parsed.data;
      const { orchestrator } = live(sessionId);
      const append = orchestrator.acceptEvent(frame.event, now);
      if (append.kind === "seqGap") return [{ protocolVersion: v, type: "nack", reason: "seqGap", expectedSeq: append.expectedSeq }];
      if (append.kind === "conflict") return [{ protocolVersion: v, type: "nack", reason: "payloadConflict", expectedSeq: frame.clientSeq }];
      if (append.kind === "duplicate") {
        const ack: ServerFrame = { protocolVersion: v, type: "ack", id: frame.id, clientSeq: frame.clientSeq, serverReceivedAt: append.stored.receivedAt };
        return [ack, ...wrap(options.store.getOutbound(sessionId, frame.event.eventId) ?? [])];
      }
      const stored = append.stored;
      enqueue(sessionId, () => orchestrator.processAccepted(stored));
      return [{ protocolVersion: v, type: "ack", id: frame.id, clientSeq: frame.clientSeq, serverReceivedAt: now }];
    },

    async tick(sessionId: string, now: number): Promise<void> {
      enqueue(sessionId, () => live(sessionId).orchestrator.tick(now));
      await host.idle(sessionId);
    },

    /** 等该会话的处理链空闲（测试与家长 API 用） */
    async idle(sessionId: string): Promise<void> { await live(sessionId).chain; },

    parentView(sessionId: string): ParentView {
      const { orchestrator } = live(sessionId);
      const bridge = parentBridges.get(sessionId);
      const pending = bridge?.pending() ?? null;
      return {
        sessionId, state: orchestrator.context.state, hintLevel: orchestrator.context.hintLevel, assistedRound: orchestrator.context.assistedRound,
        challengePrompt: orchestrator.challenge.learnerPrompt,
        pending: pending ? { purpose: pending.purpose, allowedMaxHintLevel: pending.allowedMaxHintLevel } : null,
        recentEvidence: orchestrator.evidence.slice(-10).map((e) => ({ kind: e.kind, summary: e.summary })),
        policyErrors: orchestrator.context.policyErrors.length,
      };
    },

    submitParentProposal(sessionId: string, input: ParentInput): void {
      const bridge = parentBridges.get(sessionId);
      if (!bridge) throw new Error(`会话 ${sessionId} 不是家长接管模式`);
      bridge.submit(input);
    },

    /** 编排器在 handleFrame 之外产生的输出（tick 触发的提示）通过监听器推给 socket */
    subscribe(sessionId: string, listener: (frames: ServerFrame[]) => void): () => void {
      const set = listeners.get(sessionId) ?? new Set();
      set.add(listener);
      listeners.set(sessionId, set);
      return () => { set.delete(listener); };
    },
    broadcast(sessionId: string, frames: ServerFrame[]): void {
      for (const listener of listeners.get(sessionId) ?? []) listener(frames);
    },
    sessionIds(): string[] { return [...sessions.keys()]; },
  };
  return host;
}

export type SessionHost = ReturnType<typeof createSessionHost>;
