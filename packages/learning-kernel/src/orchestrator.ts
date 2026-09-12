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
import { shouldSnapshot, type MemoryPreviewState, type OrchestratorRuntime, type SessionStore } from "./store.js";
import { resolveConfirmedEvents } from "./transcript-confirmation.js";
import { RunRecorder } from "./growth/run-recorder.js";
import { NULL_LEDGER } from "./growth/null-ledger.js";
import type { GrowthAssentPort, GrowthSessionPort } from "./growth/ports.js";
import type { ContestTarget, MemoryCandidate, SessionGateSnapshot } from "./growth/types.js";
import type { BridgeCandidate } from "./growth/candidate.js";
import { createHash } from "node:crypto";
import { selectDiscriminatingProbe, separatesTwo } from "./growth/probe-selection.js";

export interface OrchestratorDeps {
  sessionId: string;
  learnerId?: string | undefined;
  ledger?: GrowthSessionPort | undefined;
  assent?: GrowthAssentPort | undefined;
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
  private lastTaskContestTarget: ContestTarget | undefined;
  private lastSpeakContestTarget: ContestTarget | undefined;
  private windowStartedAt = 0;
  private lastNewStrategyAt = 0;
  private confirmationAskedAt: number | null = null;
  private pendingUnconfirmed = new Map<string, EvidenceEvent>();
  private outboundCounter = 0;
  private snapshotSeq = 0;
  private eventsSinceSnapshot = 0;
  private lastSnapshotAt = 0;
  private recorder: RunRecorder;
  private readonly ledger: GrowthSessionPort;
  private readonly assentSink: GrowthAssentPort;
  private readonly learnerId: string;
  private memoryPreview: MemoryPreviewState | undefined;
  private previewNonceCounter = 0;
  private artifactVersionId: string | undefined;
  private lastMemoryCandidate: BridgeCandidate | undefined;
  private bridgeCandidateRejected = false;
  private pendingProbe: OrchestratorRuntime["pendingProbe"];

  constructor(private readonly deps: OrchestratorDeps) {
    this.learnerId = deps.learnerId ?? "child-1";
    this.ledger = deps.ledger ?? NULL_LEDGER.session;
    this.assentSink = deps.assent ?? NULL_LEDGER.assent;
    this.challenge = deps.plugin.createChallenge({ ...deps.challengeInput,
      knownRecords: this.ledger.activeModel(this.learnerId, deps.plugin.manifest.id).map(record => ({ recordId: record.recordId, claimKey: record.claimKey, developmentGoalId: record.targetObject.id, ...record.scope })),
      dueReviews: this.ledger.dueReviews(this.learnerId, deps.plugin.manifest.id, deps.clock()) });
    this.budget = clampBudget(this.challenge.interventionBudget);
    this.recorder = new RunRecorder(deps.sessionId, this.learnerId);
  }

  /** 宿主重启：从最新快照重建，快照之后的事件只灌回日志与证据，不触发桥接、不重发提示。库里没有则返回 null */
  static restore(deps: OrchestratorDeps): SessionOrchestrator | null {
    const snapshot = deps.store.latestSnapshot(deps.sessionId);
    if (!snapshot) return null;
    const orch = new SessionOrchestrator(deps);
    orch.context = snapshot.context;
    // 旧快照升级：旧版冻结集合只记录提案 id，迁移时保留冻结而非清空。
    if (!orch.context.frozenTargets) {
      const legacy = snapshot.context as SessionContext & { frozenTargetIds?: string[] };
      orch.context = { ...snapshot.context, frozenTargets: (legacy.frozenTargetIds ?? []).map(id => ({ kind: "proposal", id })) };
    }
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
      orch.lastTaskContestTarget = snapshot.runtime.lastTaskContestTarget;
      orch.lastSpeakContestTarget = snapshot.runtime.lastSpeakContestTarget;
      orch.windowStartedAt = snapshot.runtime.windowStartedAt;
      orch.lastNewStrategyAt = snapshot.runtime.lastNewStrategyAt;
      orch.outboundCounter = snapshot.runtime.outboundCounter ?? 0;   // 续号，避免重启后与历史出站 id 撞号
      if (snapshot.runtime.runRecorder) orch.recorder = RunRecorder.from(snapshot.runtime.runRecorder);
      orch.memoryPreview = snapshot.runtime.memoryPreview;
      orch.previewNonceCounter = snapshot.runtime.previewNonceCounter ?? 0;
      orch.artifactVersionId = snapshot.runtime.artifactVersionId;
      orch.bridgeCandidateRejected = snapshot.runtime.bridgeCandidateRejected ?? false;
      orch.pendingProbe = snapshot.runtime.pendingProbe;
    }
    const events = deps.store.listEvents(deps.sessionId);
    orch.log = new EventLog(events);
    // 按推导后的有效质量吸收：孩子确认过的转写不能因为重启就被当成没确认
    const resolved = resolveConfirmedEvents(events.map((e) => e.event));
    for (const [index, stored] of events.entries()) {
      if (stored.event.clientSeq > snapshot.lastConfirmedSeq) {
        orch.absorb(resolved[index] ?? stored.event);
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
    const id = () => `o-${++this.outboundCounter}`;
    out.push({ type: "stateChanged", id: id(), state: this.context.state, hintLevel: this.context.hintLevel, presence: presenceFor(this.context.state) });
    out.push({ type: "learnerTask", id: id(), text: this.lastLearnerTask || this.taskForCurrentState(), contestTarget: this.lastTaskContestTarget ?? { kind: "session", id: this.deps.sessionId } });
    for (const object of this.agentObjects) out.push({ type: "canvasAction", id: id(), action: { kind: "upsertObject", object } });
    if (this.lastSpoken !== null) out.push({ type: "speak", id: id(), text: this.lastSpoken, hintLevel: this.context.hintLevel, interruptible: true, contestTarget: this.lastSpeakContestTarget ?? { kind: "session", id: this.deps.sessionId } });
    if (this.context.state === "MEMORY_PENDING" && this.memoryPreview) this.pushPreview(out);
    return out;
  }

  /** 没有记录过任务文字（例如旧快照）时按状态推导：迁移用迁移题，讲回用讲回问句，其余用当前挑战 */
  private taskForCurrentState(): string {
    if (this.context.state === "TRANSFER" && this.transferChallenge) return this.transferChallenge.learnerPrompt;
    if (this.context.state === "EXPLAIN_BACK") return this.challenge.explainBackSpec.prompt;
    return this.challenge.learnerPrompt;
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

  private disposed = false;
  /** 删除提交后取消旧运行时；异步桥接返回也不得恢复旧内容。 */
  dispose(): void { this.disposed = true; void this.deps.bridge.stop(); }

  /** 第一步：同步进日志与存储。重放/缺口/冲突在这里就能回答，不等教学逻辑 */
  acceptEvent(event: EvidenceEvent, receivedAt: number = this.deps.clock()): AppendResult {
    if (this.disposed) throw new Error("sessionRuntimeInvalidated");
    const append = this.log.append(event, receivedAt);
    if (append.kind === "appended") {
      this.deps.store.appendEvent(this.deps.sessionId, append.stored, this.artifactVersionId);
      if (this.recorder.started) this.recorder.noteServerSeq(append.stored.serverSeq);
      this.eventsSinceSnapshot += 1;
    }
    return append;
  }

  /** 第二步：对已落盘的新事件跑教学逻辑，产出儿童端消息并按事件 id 存起来供重放 */
  async processAccepted(stored: StoredEvent): Promise<ChildOutbound[]> {
    if (this.disposed) return [];
    const now = this.deps.clock();
    const before = this.context.state;
    const out: ChildOutbound[] = [];
    await this.route(stored.event, out, now);
    if (this.disposed) return [];
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
    if (this.disposed) return [];
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
        if (this.apply({ kind: "contest", target: p.target }, out)) {
          this.persistRun(now);
          this.ledger.contest({ learnerId: this.learnerId, target: p.target, sessionId: this.deps.sessionId,
            runId: this.recorder.snapshot(now).runId, eventId: event.eventId });
          this.pushSpeak(CONTEST_QUESTION, 0, out);
        }
        return;
      case "HELP_REQUEST":
        if (this.context.state === "CONTESTED") { this.startContestVerification(out, now); return; }
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
      case "MEMORY_ASSENT": this.handleMemoryAssent(event, out, now); return;
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
    if (state === "CONTESTED") return;
    if (state === "ASSESSING" && this.pendingProbe && (p.type === "UTTERANCE" || p.type === "ANSWER" || p.type === "EXPLAIN")) {
      const probe = this.deps.plugin.discriminatingProbes(this.challenge).find(item => item.id === this.pendingProbe?.probeId);
      this.recorder.noteChildOutput(now);
      const outcome = probe ? this.deps.plugin.classifyProbeOutcome(probe, p.text) : null;
      if (probe && outcome && probe.outcomes[outcome]) {
        const support = probe.outcomes[outcome];
        const evidence: DisciplineEvidence = { evidenceId: `probe-${event.eventId}`, eventId: event.eventId, kind: "probe_outcome",
          summary: outcome, hypothesisSupport: support, surfaceContextKey: this.challenge.surfaceContextKey, fromProbeId: probe.id, selfCorrection: false };
        this.evidence.push(evidence);
        this.recorder.noteEvidence(evidence, now);
        this.recorder.noteProbeOutcome(outcome, support);
      }
      this.pendingProbe = undefined;
      // 探针回答也是孩子对当前题目的产出；保留插件能明确识别的领域证据。
      const interpreted = this.deps.plugin.interpretEvent(this.challenge, event, this.evidence);
      this.evidence.push(...interpreted);
      for (const evidence of interpreted) this.recorder.noteEvidence(evidence, now);
      this.apply({ kind: "childOutput", isNewStrategy: true }, out);
      await this.assess(out);
      return;
    }
    const current = state === "TRANSFER" && this.transferChallenge ? this.transferChallenge : this.challenge;
    const fresh = this.deps.plugin.interpretEvent(current, event, this.evidence);
    this.evidence.push(...fresh);
    if (this.recorder.started) {
      this.recorder.noteChildOutput(now);
      for (const evidence of fresh) this.recorder.noteEvidence(evidence, now);
      if (isNewStrategy) this.recorder.noteFirstProductiveAction(now);
    }
    if (state === "INDEPENDENT" && this.challenge.probeId && !this.recorder.snapshot(now).probeResolved && (p.type === "ANSWER" || p.type === "UTTERANCE" || p.type === "EXPLAIN")) {
      const probe = this.deps.plugin.discriminatingProbes(this.challenge).find(item => item.id === this.challenge.probeId);
      const outcome = probe ? this.deps.plugin.classifyProbeOutcome(probe, p.text) : null;
      if (probe && outcome && probe.outcomes[outcome]) {
        const support = probe.outcomes[outcome];
        const evidence: DisciplineEvidence = { evidenceId: `probe-${event.eventId}`, eventId: event.eventId, kind: "probe_outcome", summary: outcome,
          hypothesisSupport: support, surfaceContextKey: this.challenge.surfaceContextKey, fromProbeId: probe.id, selfCorrection: false };
        this.evidence.push(evidence);
        this.recorder.noteEvidence(evidence, now);
        this.recorder.noteProbeOutcome(outcome, support);
      }
    }
    if (isNewStrategy) this.lastNewStrategyAt = now;

    if (state === "EXPLAIN_BACK" && p.type === "EXPLAIN") {
      const verdict = this.deps.plugin.checkExplainBack(this.challenge, p.text);
      if (verdict.passed) { if (this.apply({ kind: "explainBackPassed" }, out)) this.enterTransfer(out, now); }
      else if (this.apply({ kind: "explainBackRevealedGap" }, out)) await this.assess(out);
      return;
    }
    if (state === "TRANSFER" && p.type === "ANSWER" && this.transferChallenge) {
      if (this.deps.plugin.checkTransferAnswer(this.transferChallenge, p.text)) {
        this.recorder.noteTransferOutcome("succeeded");
        const run = this.recorder.snapshot(now);
        this.ledger.ingestRun({ learnerId: this.learnerId, run, evidence: this.evidence, pluginPolicy: this.pluginPolicy(),
          qualityOf: id => this.deps.store.effectiveQualityOf(this.deps.sessionId, id),
          artifactVersionOf: id => this.deps.store.listEvents(this.deps.sessionId).find(row => row.event.eventId === id)?.artifactVersionId ?? this.artifactVersionId ?? null });
        const snapshot = this.gateSnapshot(now);
        const candidate = this.ledger.nextCandidateToAsk(this.learnerId, this.challenge.discipline, snapshot) ??
          this.ledger.buildAndPreflight({ learnerId: this.learnerId, run, snapshot,
            bridgeCandidate: this.lastMemoryCandidate, bridgeCandidateRejected: this.bridgeCandidateRejected,
            plugin: { forbiddenClaimPatterns: this.deps.plugin.manifest.forbiddenClaimPatterns,
              knownHypothesisKeys: this.deps.plugin.manifest.hypothesisCatalog.map(item => item.id) } }).candidate;
        if (this.apply({ kind: "transferSucceeded", hasMemoryCandidate: candidate !== null }, out) && candidate) this.emitMemoryPreview(candidate, out, now);
      } else {
        this.recorder.noteTransferOutcome("failed");
        if (this.apply({ kind: "transferFailed" }, out)) out.push(this.msg({ type: "softLanding", message: SOFT_LANDING_MESSAGE, options: ["simpler", "hint", "stop"] }));
      }
      return;
    }
    if (state === "RECONSTRUCT" && (p.type === "ANSWER" || p.type === "EXPLAIN")) {
      this.apply({ kind: "childOutput", isNewStrategy }, out);
      if (this.apply({ kind: "reconstructDone" }, out)) this.enterExplainBack(out);
      return;
    }

    const wasIntervening = state === "INTERVENING";
    if (!this.apply({ kind: "childOutput", isNewStrategy }, out)) return;
    if (this.context.state === "ASSESSING") { await this.assess(out); return; }
    if (wasIntervening && this.context.state === "INDEPENDENT") this.withdrawAgentObjects(out);
    if (this.context.state === "INDEPENDENT" && this.deps.plugin.isExpectedEvidenceMet(this.challenge, this.evidence)) {
      if (this.apply({ kind: "childDone" }, out)) this.enterExplainBack(out);
    }
  }

  // ---- 评估与提示 ----
  private async assess(out: ChildOutbound[]): Promise<void> {
    if (this.context.state !== "ASSESSING") return;
    if (this.pendingProbe) return;
    if (this.deps.plugin.isExpectedEvidenceMet(this.challenge, this.evidence)) {
      if (this.apply({ kind: "assessedIndependentSolution" }, out)) this.enterExplainBack(out);
      return;
    }
    if (this.recorder.canIssueProbe() && !this.recorder.snapshot(this.deps.clock()).probeResolved) {
      const blocked = new Set(this.ledger.blockedHypothesisKeys(this.learnerId, this.challenge.discipline));
      const selected = selectDiscriminatingProbe({ activeCandidates: this.recorder.activeCandidates().filter(row => !blocked.has(row.hypothesisKey)),
        probes: this.deps.plugin.discriminatingProbes(this.challenge), usedProbeIds: this.recorder.usedProbeIds() });
      if (selected && this.apply({ kind: "probeIssued" }, out) && this.recorder.noteProbeIssued(selected.probe.id, selected.discriminates, this.deps.clock())) {
        this.pendingProbe = { probeId: selected.probe.id, discriminates: selected.discriminates, issuedAt: this.deps.clock() };
        this.pushSpeak(selected.probe.question, 0, out);
        this.pushTask(selected.probe.question, out);
        return;
      }
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
      if (this.disposed) return;
      result = this.validate(proposal);
      if (!result.accepted) {
        proposal = await this.deps.bridge.requestProposal({ ...turn, rejectionReasons: result.reasons });
        if (this.disposed) return;
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
    if (proposal.memoryCandidate) {
      this.lastMemoryCandidate = { ...proposal.memoryCandidate, hypothesisKeys: proposal.memoryCandidate.hypothesisKeys ?? [] };
      this.bridgeCandidateRejected ||= !result.accepted && result.reasons.some(reason => reason.startsWith("memory:"));
    }
    this.deps.store.saveProposal(this.deps.sessionId, { proposalId: proposal.proposalId, accepted: result.accepted, reasons: result.accepted ? [] : result.reasons, proposal, decidedAt: this.deps.clock(), runId: this.recorder.snapshot(this.deps.clock()).runId });
    return result;
  }

  private emitProposal(proposal: TeachingProposal, out: ChildOutbound[]): void {
    this.ledger.recordProposalContext(this.learnerId, proposal.proposalId, this.recorder.activeCandidates().map(row => row.hypothesisKey));
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

  private startContestVerification(out: ChildOutbound[], now: number): void {
    const targetKeys = this.context.frozenTargets.filter(target => target.kind === "hypothesis").map(target => target.id);
    const probes = this.deps.plugin.discriminatingProbes(this.challenge);
    let selected: { id: string; pair: [string, string] } | undefined;
    for (const probe of probes) {
      const keys = [...new Set(Object.values(probe.outcomes).flat().map(s => s.hypothesisId))];
      for (const a of keys) for (const b of keys) {
        if ((!targetKeys.length || targetKeys.includes(a) || targetKeys.includes(b)) && separatesTwo(probe, a, b)) selected ??= { id: probe.id, pair: [a, b] };
      }
    }
    if (!selected) { out.push(this.msg({ type: "notice", text: "这条先保持待核实；我还没有找到合适的新任务。" })); return; }
    let challenge: LearningChallenge;
    try {
      challenge = this.deps.plugin.createChallenge({ ...this.deps.challengeInput, probeFamilyId: this.challenge.probeFamilyId,
        difficultyBand: this.challenge.difficultyBand, requiredProbeId: selected.id, competingHypothesisIds: selected.pair });
    } catch {
      out.push(this.msg({ type: "notice", text: "这条先保持待核实；新任务还没准备好。" })); return;
    }
    if (challenge.probeId !== selected.id || !selected.pair.every(key => challenge.discriminates?.includes(key))) {
      out.push(this.msg({ type: "notice", text: "这条先保持待核实；新任务还不能区分刚才的想法。" })); return;
    }
    if (!this.apply({ kind: "contestNewTask" }, out)) return;
    this.persistRun(now, true);
    this.challenge = challenge;
    this.budget = clampBudget(challenge.interventionBudget);
    this.transferChallenge = null;
    this.evidence = [];
    this.lastProposalId = null;
    this.lastSpoken = null;
    this.lastSpeakContestTarget = undefined;
    this.withdrawAgentObjects(out);
    this.apply({ kind: "challengeValidated" }, out);
    this.recorder.noteProbeIssued(selected.id, selected.pair, now);
    this.beginWindow(now);
    this.pushTask(challenge.learnerPrompt, out);
  }

  private enterTransfer(out: ChildOutbound[], now: number): void {
    this.recorder.enterTransfer(now);
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

  private gateSnapshot(now: number): SessionGateSnapshot {
    const run = this.recorder.snapshot(now);
    return { sessionId: this.deps.sessionId, runId: run.runId, takenAt: now, state: this.context.state,
      assistedRound: run.assistedRound, frozenTargets: this.context.frozenTargets,
      maxHintLevelUsedInRound: run.maxHintLevelUsed, transferHintLevelUsedInRound: run.transferHintLevelUsed,
      transferTainted: run.transferTainted, probeResolved: run.probeResolved, previewNonce: this.memoryPreview?.nonce ?? null };
  }

  private persistRun(now: number, closed = false): void {
    if (!this.recorder.started) return;
    const run = this.recorder.snapshot(now);
    this.ledger.ingestRun({ learnerId: this.learnerId, run: closed ? run : { ...run, endedAt: null }, evidence: this.evidence, pluginPolicy: this.pluginPolicy(),
      qualityOf: id => this.deps.store.effectiveQualityOf(this.deps.sessionId, id),
      artifactVersionOf: id => this.deps.store.listEvents(this.deps.sessionId).find(row => row.event.eventId === id)?.artifactVersionId ?? this.artifactVersionId ?? null });
  }

  private pluginPolicy() { return { forbiddenClaimPatterns: this.deps.plugin.manifest.forbiddenClaimPatterns, knownHypothesisKeys: this.deps.plugin.manifest.hypothesisCatalog.map(row => row.id) }; }

  private emitMemoryPreview(candidate: MemoryCandidate, out: ChildOutbound[], now: number): void {
    const nonce = candidate.previewNonce ?? `pv-${this.deps.sessionId}-${++this.previewNonceCounter}`;
    this.memoryPreview = { candidateId: candidate.candidateId, nonce, tier: candidate.tier,
      childFacingText: candidate.childFacingText, evidenceSummaryText: candidate.evidenceSummaryText,
      contestTarget: candidate.contestTarget, shownAt: candidate.shownAt ?? now };
    this.ledger.markPreviewShown(this.learnerId, candidate.candidateId, nonce, now);
    this.pushPreview(out);
  }

  private pushPreview(out: ChildOutbound[]): void {
    const preview = this.memoryPreview;
    if (!preview) return;
    out.push(this.msg({ type: "memoryPreview", candidateId: preview.candidateId, previewNonce: preview.nonce,
      tier: preview.tier, childFacingText: preview.childFacingText, evidenceSummaryText: preview.evidenceSummaryText,
      contestTarget: preview.contestTarget }));
  }

  private handleMemoryAssent(event: EvidenceEvent, out: ChildOutbound[], now: number): void {
    const p = event.payload;
    if (p.type !== "MEMORY_ASSENT") return;
    const preview = this.memoryPreview;
    if (!preview || preview.candidateId !== p.candidateId || preview.nonce !== p.previewNonce) {
      this.context.policyErrors.push({ code: "guardFailed", from: this.context.state, signal: "memoryAssent" });
      out.push(this.msg({ type: "notice", text: "我这边没找到刚才那张卡片，我们重新看一次。" }));
      if (this.context.state === "MEMORY_PENDING") this.pushPreview(out);
      return;
    }
    const snapshot = this.gateSnapshot(now);
    const input = { learnerId: this.learnerId, candidateId: p.candidateId, previewNonce: p.previewNonce,
      choice: p.choice, eventId: event.eventId, answeredAt: now, snapshot };
    const { wouldCommit } = this.ledger.evaluateAssent(input);
    const moved = this.apply({ kind: "memoryAssent", choice: p.choice, localRulesPassed: wouldCommit }, out);
    if (!moved && this.context.state !== "MEMORY_PENDING") {
      out.push(this.msg({ type: "notice", text: "先回到刚才的卡片，再慢慢选；你的选择还没有提交。" }));
      return;
    }
    const decision = this.assentSink.recordAssent({ ...input, transitionAccepted: moved, stateAfterTransition: this.context.state });
    if (!moved || (p.choice === "record" && !decision.outcome.committed)) {
      this.ledger.holdCandidate(this.learnerId, p.candidateId);
      out.push(this.msg({ type: "notice", text: "这条先不记下来，你不用重新选择。" }));
      out.push(this.msg({ type: "memoryDismissed", candidateId: p.candidateId, reason: "held" }));
      if (this.context.state === "MEMORY_PENDING") this.apply({ kind: "memoryHeld" }, out);
    } else {
      if (p.choice === "disagree") this.ledger.contest({ learnerId: this.learnerId, target: preview.contestTarget,
        sessionId: this.deps.sessionId, runId: snapshot.runId, eventId: event.eventId });
      out.push(this.msg({ type: "memoryDismissed", candidateId: p.candidateId, reason: p.choice === "record" ? "recorded" : p.choice }));
    }
    this.memoryPreview = undefined;
  }

  // ---- 工具 ----
  private apply(signal: Signal, out: ChildOutbound[]): boolean {
    if (this.disposed) return false;
    const before = this.context.state;
    const result = transition(this.context, signal);
    this.context = result.context;
    if (!result.ok) return false;
    if (signal.kind === "challengeValidated") {
      this.lastMemoryCandidate = undefined;
      this.bridgeCandidateRejected = false;
      this.pendingProbe = undefined;
      this.recorder.beginRun(this.challenge, this.deps.plugin.manifest.difficultyBands.indexOf(this.challenge.difficultyBand), this.log.lastConfirmedSeq + 1, this.deps.clock());
      const run = this.recorder.snapshot(this.deps.clock());
      this.artifactVersionId = `${run.runId}-artifact-v1`;
      this.ledger.ingestArtifactVersion({ learnerId: this.learnerId, artifactId: `${run.runId}-artifact`, artifactVersionId: this.artifactVersionId,
        sessionId: this.deps.sessionId, discipline: this.challenge.discipline, versionNo: 1, writer: "host_snapshot",
        contentRef: `session:${this.deps.sessionId}:run:${run.runId}`, contentHash: createHash("sha256").update(run.runId).digest("hex"), payload: {} });
      this.recorder.noteArtifactVersion(this.artifactVersionId);
    }
    if (this.recorder.started) {
      if (this.context.assistedRound) this.recorder.noteAssisted();
      if (signal.kind === "hintIssued") this.recorder.noteHint(signal.level, this.deps.clock());
      if (signal.kind === "reconstructDone") this.recorder.noteReconstructed();
      if (this.context.state === "COMPLETED" || (signal.kind === "softLandingChoice" && signal.choice === "simpler")) this.persistRun(this.deps.clock(), true);
    }
    if (!["MEMORY_PENDING", "WAITING_CONFIRMATION", "PAUSED_CHILD", "PAUSED_TECH"].includes(this.context.state)) this.memoryPreview = undefined;
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
    this.lastTaskContestTarget = this.taskContestTarget();
    out.push(this.msg({ type: "learnerTask", text, contestTarget: this.lastTaskContestTarget }));
  }

  private taskContestTarget(): { kind: "hypothesis" | "session"; id: string } {
    const key = this.recorder.started ? this.recorder.activeCandidates()[0]?.hypothesisKey : undefined;
    return key ? { kind: "hypothesis", id: key } : { kind: "session", id: this.deps.sessionId };
  }

  private pushSpeak(text: string, hintLevel: number, out: ChildOutbound[]): void {
    this.lastSpoken = text;
    this.lastSpeakContestTarget = this.lastProposalId ? { kind: "proposal", id: this.lastProposalId } : { kind: "session", id: this.deps.sessionId };
    out.push(this.msg({ type: "speak", text, hintLevel, interruptible: true, contestTarget: this.lastSpeakContestTarget }));
  }

  private runtime(): OrchestratorRuntime {
    return {
      erasedHashes: [...this.erasedHashes], agentObjects: [...this.agentObjects], childObjectIds: [...this.childObjectIds],
      lastProposalId: this.lastProposalId, lastLearnerTask: this.lastLearnerTask, lastSpoken: this.lastSpoken,
      lastTaskContestTarget: this.lastTaskContestTarget, lastSpeakContestTarget: this.lastSpeakContestTarget,
      windowStartedAt: this.windowStartedAt, lastNewStrategyAt: this.lastNewStrategyAt, outboundCounter: this.outboundCounter,
      runRecorder: this.recorder.toJSON(), artifactVersionId: this.artifactVersionId,
      previewNonceCounter: this.previewNonceCounter, memoryPreview: this.memoryPreview,
      // 自由描述不能进快照；未完成对齐的来源在恢复后保守拒绝，绝不静默改成自建。
      bridgeCandidateRejected: this.bridgeCandidateRejected || this.lastMemoryCandidate !== undefined,
      pendingProbe: this.pendingProbe,
    };
  }

  private msg(body: OutboundBody): ChildOutbound {
    this.outboundCounter += 1;
    return { ...body, id: `o-${this.outboundCounter}` } as ChildOutbound;
  }

  private snapshotIfNeeded(stateChanged: boolean, now: number): void {
    if (this.disposed) return;
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
