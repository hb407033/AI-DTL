// packages/learning-kernel/src/orchestrator.ts
// 会话编排器：把儿童端事件变成状态机信号，按 5.0 表推进，在需要教学动作时向 RealtimeBridge 要提案、
// 经本地校验后转成儿童端出站消息，并把事件、提案裁决与快照落盘。时钟注入，窗口与超时用 tick(now) 驱动，便于确定性测试。
import type { ChildOutbound, EvidenceEvent, SemanticObject, TeachingProposal } from "@ai-scholar/session-contracts";
import type { RealtimeBridge, TurnContext, TurnPurpose } from "./bridge.js";
import type { ChallengeInput, DisciplineEvidence, LearningChallenge } from "./challenge.js";
import { EventLog, type AppendResult, type StoredEvent } from "./event-log.js";
import { clampBudget, evaluateEscalation, nextHintRung, type InterventionBudget } from "./hint-budget.js";
import type { DisciplinePlugin } from "./plugin.js";
import { validateProposal } from "./proposal-validator.js";
import { createSessionContext, transition, type SessionContext, type Signal } from "./session-state.js";
import { shouldSnapshot, type OrchestratorRuntime, type SessionStore } from "./store.js";

export interface OrchestratorDeps {
  sessionId: string;
  plugin: DisciplinePlugin;
  bridge: RealtimeBridge;
  store: SessionStore;
  clock: () => number;
  challengeInput: ChallengeInput;
  confirmationTimeoutMs?: number | undefined;
}

export interface HandleResult { append: AppendResult; outbound: ChildOutbound[] }

const CONFIRMATION_TIMEOUT_MS = 60_000;
const WAIT_NOTICE = "等我一下。";
const BRIDGE_DOWN_NOTICE = "现在没法给你提示，你可以先接着画。";

// 出站消息去掉 id 后的分配型联合（Omit 直接作用在联合上会丢掉各成员字段）
type OutboundBody = { [K in ChildOutbound["type"]]: Omit<Extract<ChildOutbound, { type: K }>, "id"> }[ChildOutbound["type"]];
const CONTEST_QUESTION = "哪里和你的想法不一样？";
const SOFT_LANDING_MESSAGE = "这是在试，不是考试。你想换一个更简单的、看看一个提示，还是今天先到这里？";

export class SessionOrchestrator {
  context: SessionContext = createSessionContext();
  challenge: LearningChallenge;
  transferChallenge: LearningChallenge | null = null;
  evidence: DisciplineEvidence[] = [];
  private budget: InterventionBudget;
  private log = new EventLog();
  private erasedHashes = new Set<string>();
  private agentObjects: SemanticObject[] = [];
  private childObjectIds: string[] = [];
  private lastProposalId: string | null = null;
  private lastLearnerTask = "";
  private lastSpoken: string | null = null;
  private windowStartedAt = 0;
  private lastNewStrategyAt = 0;
  private confirmationAskedAt: number | null = null;
  private pendingUnconfirmed = new Map<string, EvidenceEvent>();
  private outboundCounter = 0;
  private snapshotSeq = 0;
  private eventsSinceSnapshot = 0;
  private lastSnapshotAt = 0;

  constructor(private readonly deps: OrchestratorDeps) {
    this.challenge = deps.plugin.createChallenge(deps.challengeInput);
    this.budget = clampBudget(this.challenge.interventionBudget);
  }

  /** 宿主重启：从最新快照重建，快照之后的事件只灌回日志与证据，不触发桥接、不重发提示。库里没有则返回 null */
  static restore(deps: OrchestratorDeps): SessionOrchestrator | null {
    const snapshot = deps.store.latestSnapshot(deps.sessionId);
    if (!snapshot) return null;
    const orch = new SessionOrchestrator(deps);
    orch.context = snapshot.context;
    orch.challenge = snapshot.challenge;
    orch.transferChallenge = snapshot.transferChallenge;
    orch.evidence = [...snapshot.evidence];
    orch.budget = clampBudget(orch.challenge.interventionBudget);
    orch.snapshotSeq = snapshot.snapshotSeq;
    orch.lastSnapshotAt = snapshot.createdAt;
    if (snapshot.runtime) {
      orch.erasedHashes = new Set(snapshot.runtime.erasedHashes);
      orch.agentObjects = [...snapshot.runtime.agentObjects];
      orch.childObjectIds = [...snapshot.runtime.childObjectIds];
      orch.lastProposalId = snapshot.runtime.lastProposalId;
      orch.lastLearnerTask = snapshot.runtime.lastLearnerTask;
      orch.lastSpoken = snapshot.runtime.lastSpoken;
      orch.windowStartedAt = snapshot.runtime.windowStartedAt;
      orch.lastNewStrategyAt = snapshot.runtime.lastNewStrategyAt;
    }
    const events = deps.store.listEvents(deps.sessionId);
    orch.log = new EventLog(events);
    for (const stored of events) {
      if (stored.event.clientSeq > snapshot.lastConfirmedSeq) {
        orch.absorb(stored.event);
        orch.eventsSinceSnapshot += 1;
      }
    }
    return orch;
  }

  /** 儿童端断线：进入 PAUSED_TECH，停计时、停能力判断。非活动状态下无事发生 */
  techInterrupted(): ChildOutbound[] {
    const out: ChildOutbound[] = [];
    if (this.apply({ kind: "techInterrupted" }, out)) this.snapshotIfNeeded(true, this.deps.clock());
    return out;
  }

  /** 儿童端重连：快照之前的事件都已落盘，检查点视为一致，回原状态并从现在重新计窗口 */
  techRecovered(): ChildOutbound[] {
    const out: ChildOutbound[] = [];
    const now = this.deps.clock();
    if (this.apply({ kind: "techRecovered", checkpointConsistent: true }, out)) {
      this.beginWindow(now);
      this.snapshotIfNeeded(true, now);
    }
    return out;
  }

  /** 当前画面：重连或重开 App 时发给儿童端，让它不靠历史消息也能画出现在的状态 */
  viewSnapshot(): ChildOutbound[] {
    const out: ChildOutbound[] = [];
    let n = 0;
    const id = () => `snap-${++n}`;
    out.push({ type: "stateChanged", id: id(), state: this.context.state, hintLevel: this.context.hintLevel, presence: presenceFor(this.context.state) });
    if (this.lastLearnerTask) out.push({ type: "learnerTask", id: id(), text: this.lastLearnerTask });
    for (const object of this.agentObjects) out.push({ type: "canvasAction", id: id(), action: { kind: "upsertObject", object } });
    if (this.lastSpoken !== null) out.push({ type: "speak", id: id(), text: this.lastSpoken, hintLevel: this.context.hintLevel, interruptible: true });
    return out;
  }

  /** 重建时把快照之后的事件只当证据吸收：不改状态、不请求桥接 */
  private absorb(event: EvidenceEvent): void {
    const p = event.payload;
    if (p.type === "ERASE") { this.erasedHashes.add(p.contentHash); return; }
    if (p.type === "STROKE") this.childObjectIds.push(p.strokeId);
    const interpretable = p.type === "STROKE" || p.type === "UTTERANCE" || p.type === "ANSWER" || p.type === "EXPLAIN" || p.type === "SELECT" || p.type === "DRAG";
    if (!interpretable || event.quality === "unconfirmed") return;
    const current = this.context.state === "TRANSFER" && this.transferChallenge ? this.transferChallenge : this.challenge;
    this.evidence.push(...this.deps.plugin.interpretEvent(current, event, this.evidence));
  }

  async start(): Promise<ChildOutbound[]> {
    const now = this.deps.clock();
    this.deps.store.createSession({ sessionId: this.deps.sessionId, discipline: this.deps.plugin.manifest.id, challenge: this.challenge, createdAt: now });
    await this.deps.bridge.start(this.deps.sessionId);
    const out: ChildOutbound[] = [];
    this.apply({ kind: "challengeValidated" }, out);
    this.beginWindow(now);
    this.pushTask(this.challenge.learnerPrompt, out);
    this.snapshotIfNeeded(true, now);
    return out;
  }

  /** 第一步：同步进日志与存储。重放/缺口/冲突在这里就能回答，不等教学逻辑 */
  acceptEvent(event: EvidenceEvent, receivedAt: number = this.deps.clock()): AppendResult {
    const append = this.log.append(event, receivedAt);
    if (append.kind === "appended") {
      this.deps.store.appendEvent(this.deps.sessionId, append.stored);
      this.eventsSinceSnapshot += 1;
    }
    return append;
  }

  /** 第二步：对已落盘的新事件跑教学逻辑，产出儿童端消息并按事件 id 存起来供重放 */
  async processAccepted(stored: StoredEvent): Promise<ChildOutbound[]> {
    const now = this.deps.clock();
    const before = this.context.state;
    const out: ChildOutbound[] = [];
    await this.route(stored.event, out, now);
    this.deps.store.saveOutbound(this.deps.sessionId, stored.event.eventId, out);
    this.snapshotIfNeeded(before !== this.context.state, now);
    return out;
  }

  async handleEvent(event: EvidenceEvent): Promise<HandleResult> {
    const append = this.acceptEvent(event);
    if (append.kind === "duplicate") return { append, outbound: this.deps.store.getOutbound(this.deps.sessionId, event.eventId) ?? [] };
    if (append.kind !== "appended") return { append, outbound: [] };
    return { append, outbound: await this.processAccepted(append.stored) };
  }

  async tick(now: number): Promise<ChildOutbound[]> {
    const out: ChildOutbound[] = [];
    const before = this.context.state;
    if (this.context.state === "INDEPENDENT") {
      if (now - this.windowStartedAt >= this.challenge.independencePolicy.hardCapMs) {
        this.apply({ kind: "hardCapReached" }, out);
        await this.assess(out);
      } else if (now - this.lastNewStrategyAt >= this.challenge.independencePolicy.initialWindowMs) {
        this.apply({ kind: "windowExpired" }, out);
        await this.assess(out);
      }
    } else if (this.context.state === "INTERVENING" && now - this.lastNewStrategyAt >= this.challenge.independencePolicy.initialWindowMs && !this.context.newOutputSinceLastHint) {
      this.apply({ kind: "noNewOutputWillingToContinue" }, out);
      await this.assess(out);
    } else if (this.context.state === "WAITING_CONFIRMATION" && this.confirmationAskedAt !== null && now - this.confirmationAskedAt >= (this.deps.confirmationTimeoutMs ?? CONFIRMATION_TIMEOUT_MS)) {
      this.apply({ kind: "confirmationTimeout" }, out);
      this.confirmationAskedAt = null;
      this.pendingUnconfirmed.clear();
    }
    this.snapshotIfNeeded(before !== this.context.state, now);
    return out;
  }

  snapshotNow(): void { this.snapshotIfNeeded(true, this.deps.clock()); }

  // ---- 事件路由 ----
  private async route(event: EvidenceEvent, out: ChildOutbound[], now: number): Promise<void> {
    const p = event.payload;
    switch (p.type) {
      case "PAUSE_REQUEST": this.apply({ kind: "pauseRequest" }, out); return;
      case "RESUME_REQUEST": this.apply({ kind: "resume" }, out); return;
      case "CONTEST":
        if (this.apply({ kind: "contest", targetId: p.targetId ?? this.lastProposalId ?? undefined }, out)) {
          this.pushSpeak(CONTEST_QUESTION, 0, out);
        }
        return;
      case "HELP_REQUEST":
        if (this.apply({ kind: "helpRequest" }, out)) await this.assess(out);
        return;
      case "DONE":
        if (this.context.state === "INDEPENDENT" && this.apply({ kind: "childDone" }, out)) this.enterExplainBack(out);
        return;
      case "CONFIRM_TRANSCRIPT": {
        const original = this.pendingUnconfirmed.get(p.targetEventId);
        if (this.apply({ kind: "transcriptConfirmed" }, out)) {
          this.confirmationAskedAt = null;
          this.pendingUnconfirmed.delete(p.targetEventId);
          if (p.confirmed && original && original.payload.type === "UTTERANCE") {
            const text = p.correctedText ?? original.payload.text;
            const confirmed: EvidenceEvent = { ...original, quality: p.correctedText ? "corrected" : "confirmed", payload: { type: "UTTERANCE", text } };
            await this.handleChildOutput(confirmed, out, now);
          }
        }
        return;
      }
      case "SOFT_LANDING_CHOICE": await this.handleSoftLandingChoice(p.choice, out, now); return;
      case "MEMORY_ASSENT": this.apply({ kind: "memoryAssent", choice: p.choice }, out); return;
      case "ERASE": this.erasedHashes.add(p.contentHash); this.apply({ kind: "childOutput", isNewStrategy: false }, out); return;
      case "UTTERANCE":
        if (event.quality === "unconfirmed") {
          if (this.apply({ kind: "transcriptUncertain" }, out)) {
            this.pendingUnconfirmed.set(event.eventId, event);
            this.confirmationAskedAt = now;
            out.push(this.msg({ type: "confirmTranscript", targetEventId: event.eventId, text: p.text }));
          }
          return;
        }
        await this.handleChildOutput(event, out, now);
        return;
      case "STROKE": case "ANSWER": case "EXPLAIN": case "SELECT": case "DRAG":
        if (p.type === "STROKE") this.childObjectIds.push(p.strokeId);
        await this.handleChildOutput(event, out, now);
        return;
    }
  }

  private async handleChildOutput(event: EvidenceEvent, out: ChildOutbound[], now: number): Promise<void> {
    const p = event.payload;
    const isNewStrategy = !(p.type === "STROKE" && this.erasedHashes.has(p.contentHash));
    const state = this.context.state;
    const current = state === "TRANSFER" && this.transferChallenge ? this.transferChallenge : this.challenge;
    const fresh = this.deps.plugin.interpretEvent(current, event, this.evidence);
    this.evidence.push(...fresh);
    if (isNewStrategy) this.lastNewStrategyAt = now;

    if (state === "EXPLAIN_BACK" && p.type === "EXPLAIN") {
      const verdict = this.deps.plugin.checkExplainBack(this.challenge, p.text);
      if (verdict.passed) { if (this.apply({ kind: "explainBackPassed" }, out)) this.enterTransfer(out, now); }
      else if (this.apply({ kind: "explainBackRevealedGap" }, out)) await this.assess(out);
      return;
    }
    if (state === "TRANSFER" && p.type === "ANSWER" && this.transferChallenge) {
      if (this.deps.plugin.checkTransferAnswer(this.transferChallenge, p.text)) this.apply({ kind: "transferSucceeded", hasMemoryCandidate: false }, out);
      else if (this.apply({ kind: "transferFailed" }, out)) out.push(this.msg({ type: "softLanding", message: SOFT_LANDING_MESSAGE, options: ["simpler", "hint", "stop"] }));
      return;
    }
    if (state === "RECONSTRUCT" && (p.type === "ANSWER" || p.type === "EXPLAIN")) {
      this.apply({ kind: "childOutput", isNewStrategy }, out);
      if (this.apply({ kind: "reconstructDone" }, out)) this.enterExplainBack(out);
      return;
    }

    const wasIntervening = state === "INTERVENING";
    if (!this.apply({ kind: "childOutput", isNewStrategy }, out)) return;
    if (wasIntervening && this.context.state === "INDEPENDENT") this.withdrawAgentObjects(out);
    if (this.context.state === "INDEPENDENT" && this.deps.plugin.isExpectedEvidenceMet(this.challenge, this.evidence)) {
      if (this.apply({ kind: "childDone" }, out)) this.enterExplainBack(out);
    }
  }

  // ---- 评估与提示 ----
  private async assess(out: ChildOutbound[]): Promise<void> {
    if (this.context.state !== "ASSESSING") return;
    if (this.deps.plugin.isExpectedEvidenceMet(this.challenge, this.evidence)) {
      if (this.apply({ kind: "assessedIndependentSolution" }, out)) this.enterExplainBack(out);
      return;
    }
    const rung = nextHintRung(this.context);
    const verdict = evaluateEscalation(this.context, rung, this.budget);
    if (verdict.allowed) {
      if (this.apply({ kind: "assessedRecoverable" }, out)) await this.requestHint(rung, out);
      return;
    }
    if (verdict.reason === "noNewOutputSinceLastHint") {
      out.push(this.msg({ type: "stateChanged", state: this.context.state, hintLevel: this.context.hintLevel, presence: "waiting" }));
      return;
    }
    if (this.apply({ kind: "assessedBudgetExhausted" }, out)) out.push(this.msg({ type: "softLanding", message: SOFT_LANDING_MESSAGE, options: ["simpler", "hint", "stop"] }));
  }

  private async requestHint(level: number, out: ChildOutbound[]): Promise<void> {
    const turn = this.turn("hint", level);
    let proposal: TeachingProposal;
    let result: ReturnType<SessionOrchestrator["validate"]>;
    try {
      proposal = await this.deps.bridge.requestProposal(turn);
      result = this.validate(proposal);
      if (!result.accepted) {
        proposal = await this.deps.bridge.requestProposal({ ...turn, rejectionReasons: result.reasons });
        result = this.validate(proposal);
      }
    } catch {
      // 设计稿 13：桥接不可用就明说，不伪装正常，也不换模型；画布照常
      out.push(this.msg({ type: "notice", text: BRIDGE_DOWN_NOTICE }));
      return;
    }
    if (!result.accepted) { out.push(this.msg({ type: "notice", text: WAIT_NOTICE })); return; }

    this.apply({ kind: "hintIssued", level: proposal.hintLevel, liftsSoftBudget: result.liftsSoftBudget }, out);
    this.lastProposalId = proposal.proposalId;
    // 提示发出后重新计等待窗口，避免下一秒就因“无新产出”回到评估
    this.lastNewStrategyAt = this.deps.clock();
    this.emitProposal(proposal, out);
    if (proposal.hintLevel === 4 && this.apply({ kind: "demoIssued" }, out)) {
      this.withdrawAgentObjects(out);
      this.pushTask(proposal.learnerTask, out);
    }
  }

  private validate(proposal: TeachingProposal) {
    const result = validateProposal({ proposal, context: this.context, budget: this.budget, plugin: this.deps.plugin, protectedObjectIds: this.childObjectIds });
    this.deps.store.saveProposal(this.deps.sessionId, { proposalId: proposal.proposalId, accepted: result.accepted, reasons: result.accepted ? [] : result.reasons, proposal, decidedAt: this.deps.clock() });
    return result;
  }

  private emitProposal(proposal: TeachingProposal, out: ChildOutbound[]): void {
    this.pushSpeak(proposal.spokenResponse, proposal.hintLevel, out);
    for (const action of proposal.canvasActions) {
      if (action.kind === "upsertObject") {
        const index = this.agentObjects.findIndex((o) => o.id === action.object.id);
        if (index >= 0) this.agentObjects[index] = action.object; else this.agentObjects.push(action.object);
      } else if (action.kind === "removeObject") {
        this.agentObjects = this.agentObjects.filter((o) => o.id !== action.objectId);
      }
      out.push(this.msg({ type: "canvasAction", action }));
    }
    this.pushTask(proposal.learnerTask, out);
  }

  private withdrawAgentObjects(out: ChildOutbound[]): void {
    for (const object of this.agentObjects.splice(0)) out.push(this.msg({ type: "canvasAction", action: { kind: "removeObject", objectId: object.id } }));
  }

  private enterExplainBack(out: ChildOutbound[]): void {
    this.pushTask(this.challenge.explainBackSpec.prompt, out);
  }

  private enterTransfer(out: ChildOutbound[], now: number): void {
    this.transferChallenge = this.deps.plugin.createTransfer(this.challenge);
    this.beginWindow(now);
    this.pushTask(this.transferChallenge.learnerPrompt, out);
  }

  private async handleSoftLandingChoice(choice: "simpler" | "hint" | "stop", out: ChildOutbound[], now: number): Promise<void> {
    if (!this.apply({ kind: "softLandingChoice", choice }, out)) return;
    if (choice === "simpler") {
      this.challenge = this.deps.plugin.createChallenge({ ...this.deps.challengeInput, difficultyBand: "lower" });
      this.budget = clampBudget(this.challenge.interventionBudget);
      this.transferChallenge = null;
      this.evidence = [];
      this.apply({ kind: "challengeValidated" }, out);
      this.beginWindow(now);
      this.pushTask(this.challenge.learnerPrompt, out);
    } else if (choice === "hint") {
      await this.requestHint(Math.min(nextHintRung(this.context), this.budget.maxHintLevel), out);
    }
  }

  // ---- 工具 ----
  private apply(signal: Signal, out: ChildOutbound[]): boolean {
    const before = this.context.state;
    const result = transition(this.context, signal);
    this.context = result.context;
    if (!result.ok) return false;
    if (this.context.state !== before) {
      out.push(this.msg({ type: "stateChanged", state: this.context.state, hintLevel: this.context.hintLevel, presence: presenceFor(this.context.state) }));
    }
    return true;
  }

  private turn(purpose: TurnPurpose, allowedMaxHintLevel: number): TurnContext {
    return {
      sessionId: this.deps.sessionId, purpose, state: this.context.state, hintLevel: this.context.hintLevel, allowedMaxHintLevel,
      challenge: this.challenge, recentEvidence: this.evidence.slice(-10), recentEvents: this.log.all().slice(-10).map((s) => s.event), rejectionReasons: [],
    };
  }

  private beginWindow(now: number): void { this.windowStartedAt = now; this.lastNewStrategyAt = now; }

  private pushTask(text: string, out: ChildOutbound[]): void {
    this.lastLearnerTask = text;
    out.push(this.msg({ type: "learnerTask", text }));
  }

  private pushSpeak(text: string, hintLevel: number, out: ChildOutbound[]): void {
    this.lastSpoken = text;
    out.push(this.msg({ type: "speak", text, hintLevel, interruptible: true }));
  }

  private runtime(): OrchestratorRuntime {
    return {
      erasedHashes: [...this.erasedHashes], agentObjects: [...this.agentObjects], childObjectIds: [...this.childObjectIds],
      lastProposalId: this.lastProposalId, lastLearnerTask: this.lastLearnerTask, lastSpoken: this.lastSpoken,
      windowStartedAt: this.windowStartedAt, lastNewStrategyAt: this.lastNewStrategyAt,
    };
  }

  private msg(body: OutboundBody): ChildOutbound {
    this.outboundCounter += 1;
    return { ...body, id: `o-${this.outboundCounter}` } as ChildOutbound;
  }

  private snapshotIfNeeded(stateChanged: boolean, now: number): void {
    if (!shouldSnapshot({ stateChanged, eventsSinceSnapshot: this.eventsSinceSnapshot, msSinceSnapshot: now - this.lastSnapshotAt })) return;
    this.snapshotSeq += 1;
    this.deps.store.saveSnapshot(this.deps.sessionId, {
      snapshotSeq: this.snapshotSeq, context: this.context, lastConfirmedSeq: this.log.lastConfirmedSeq,
      challenge: this.challenge, transferChallenge: this.transferChallenge, evidence: [...this.evidence], createdAt: now, runtime: this.runtime(),
    });
    this.eventsSinceSnapshot = 0;
    this.lastSnapshotAt = now;
  }
}

function presenceFor(state: SessionContext["state"]): "listening" | "waiting" | "paused" {
  return state === "PAUSED_CHILD" || state === "PAUSED_TECH" ? "paused" : state === "WAITING_CONFIRMATION" ? "waiting" : "listening";
}
