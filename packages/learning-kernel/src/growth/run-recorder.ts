// 一轮挑战的记账（设计稿 §10.3）。会话级、可序列化，宿主重启后接着记而不是从零开始。
//
// 两处口径是这个类存在的理由：
// 一、「无提示迁移」不能看提示发出时处在哪个状态。提示只可能在介入态发出，所以按状态判断的话
//     那个字段永远是 0，门禁形同虚设。这里改成：迁移一旦开始，在拿到结果之前的任何提示都算污染，
//     孩子绕道求助去评估再拿提示同样算。重进迁移不清，只有开新一轮才清。
// 二、辅助轮是粘性的：本轮曾经为真就一直为真，不被后续状态洗掉。软着陆之后换简单题，
//     新一轮的记账清零，但辅助标记会立刻被重新置上，脚手架点因此绑定本次挑战而不是上一题。
import type { DisciplineEvidence, HypothesisSupport, LearningChallenge } from "../challenge.js";
import { PROBE_BUDGET } from "./probe-selection.js";
import { claimKeyOf } from "./constants.js";
import type { ChallengeRun } from "./types.js";

export interface RunRecorderState {
  sessionId: string;
  learnerId: string;
  runSeq: number;
  run: RunFacts | null;
}

interface RunFacts {
  runId: string;
  challengeId: string;
  discipline: string;
  probeFamilyId: string;
  difficultyBand: string;
  difficultyBandIndex: number;
  developmentGoalId: string;
  childFacingGoalPhrase: string;
  surfaceContextKey: string;
  surfaceContextLabel: string;
  claimKey: string;
  startedAt: number;
  firstServerSeq: number;
  lastServerSeq: number;
  artifactVersionIds: string[];
  maxHintLevelUsed: number;
  escalationCount: number;
  probesIssued: number;
  newOutputSinceLastProbe: boolean;
  usedProbeIds: string[];
  issuedPair?: readonly [string, string];
  discriminates: string[];
  probeResolved: boolean;
  transferOpen: boolean;
  transferOutcome: "succeeded" | "failed" | "none";
  transferHintLevelUsed: number;
  transferTainted: boolean;
  reconstructed: boolean;
  assistedRound: boolean;
  selfCorrectionObserved: boolean;
  firstProductiveActionAt: number | null;
  /** 每个候选最近一次的方向，以及那之后有没有给过提示；用来判定孩子是不是自己改对的 */
  directionOf: Record<string, "supports" | "weakens">;
  hintedSince: Record<string, boolean>;
  supportCount: Record<string, number>;
  candidateOrder: string[];
}

export class RunRecorder {
  private runSeq = 0;
  private facts: RunFacts | null = null;

  constructor(private readonly sessionId: string, private readonly learnerId: string) {}

  /** 每次挑战校验通过都要调，含软着陆换简单题那条路径 */
  beginRun(challenge: LearningChallenge, difficultyBandIndex: number, firstServerSeq: number, at: number): void {
    this.runSeq += 1;
    this.facts = {
      runId: `${this.sessionId}-run-${this.runSeq}`,
      challengeId: challenge.challengeId,
      discipline: challenge.discipline,
      probeFamilyId: challenge.probeFamilyId,
      difficultyBand: challenge.difficultyBand,
      difficultyBandIndex,
      developmentGoalId: challenge.developmentGoalId,
      childFacingGoalPhrase: challenge.childFacingGoalPhrase,
      surfaceContextKey: challenge.surfaceContextKey,
      surfaceContextLabel: challenge.surfaceContextLabel,
      claimKey: claimKeyOf(challenge.discipline, challenge.probeFamilyId, challenge.developmentGoalId),
      startedAt: at,
      firstServerSeq,
      lastServerSeq: firstServerSeq,
      artifactVersionIds: [],
      maxHintLevelUsed: 0, escalationCount: 0, probesIssued: 0, newOutputSinceLastProbe: false, usedProbeIds: [], discriminates: [], probeResolved: false,
      transferOpen: false, transferOutcome: "none", transferHintLevelUsed: 0, transferTainted: false,
      reconstructed: false, assistedRound: false, selfCorrectionObserved: false,
      firstProductiveActionAt: null,
      directionOf: {}, hintedSince: {}, supportCount: {}, candidateOrder: [],
    };
  }

  private get run(): RunFacts {
    if (!this.facts) throw new Error("还没有开始任何一轮挑战");
    return this.facts;
  }

  get started(): boolean { return this.facts !== null; }

  noteFirstProductiveAction(at: number): void {
    if (this.run.firstProductiveActionAt === null) this.run.firstProductiveActionAt = at;
  }

  noteChildOutput(at: number): void {
    this.noteFirstProductiveAction(at);
    this.run.newOutputSinceLastProbe = true;
  }

  get newOutputSinceLastProbe(): boolean { return this.run.newOutputSinceLastProbe; }

  canIssueProbe(): boolean {
    return this.run.probesIssued < PROBE_BUDGET.maxPerRun
      && (this.run.probesIssued === 0 || this.run.newOutputSinceLastProbe);
  }

  noteHint(level: number, _at: number): void {
    const run = this.run;
    run.maxHintLevelUsed = Math.max(run.maxHintLevelUsed, level);
    run.escalationCount += 1;
    for (const key of Object.keys(run.hintedSince)) run.hintedSince[key] = true;
    if (run.transferOpen) {
      run.transferHintLevelUsed = Math.max(run.transferHintLevelUsed, level);
      run.transferTainted = true;
    }
  }

  enterTransfer(_at: number): void { this.run.transferOpen = true; }

  noteTransferOutcome(outcome: "succeeded" | "failed"): void {
    this.run.transferOutcome = outcome;
    this.run.transferOpen = false;
  }

  noteReconstructed(): void { this.run.reconstructed = true; }

  noteAssisted(): void { this.run.assistedRound = true; }

  noteProbeIssued(probeId: string, discriminates: readonly [string, string], _at: number): boolean {
    if (!this.canIssueProbe()) return false;
    const run = this.run;
    run.probesIssued += 1;
    run.usedProbeIds.push(probeId);
    run.issuedPair = discriminates;
    run.newOutputSinceLastProbe = false;
    return true;
  }

  noteProbeOutcome(outcomeKey: string, support: readonly HypothesisSupport[]): void {
    if (!outcomeKey || this.run.probesIssued === 0) return;
    const [a, b] = this.run.issuedPair ?? [];
    if (!a || !b) return;
    const da = support.find((s) => s.hypothesisId === a)?.direction;
    const db = support.find((s) => s.hypothesisId === b)?.direction;
    if (da && db && da !== db) {
      this.run.probeResolved = true;
      this.run.discriminates = [a, b];
    }
  }

  noteEvidence(evidence: DisciplineEvidence, at: number): void {
    const run = this.run;
    const previousTop = this.activeCandidates().slice(0, 2).map((c) => c.hypothesisKey).sort().join("\u0000");
    this.noteFirstProductiveAction(at);
    if (evidence.selfCorrection) run.selfCorrectionObserved = true;
    for (const support of evidence.hypothesisSupport) {
      const key = support.hypothesisId;
      const previous = run.directionOf[key];
      // 同一候选方向从支持翻成削弱、且这中间没给过提示，就是孩子自己发现不对改过来的
      if (previous === "supports" && support.direction === "weakens" && run.hintedSince[key] === false) {
        run.selfCorrectionObserved = true;
      }
      run.directionOf[key] = support.direction;
      run.hintedSince[key] = false;
      if (support.direction === "supports") run.supportCount[key] = (run.supportCount[key] ?? 0) + 1;
      if (!run.candidateOrder.includes(key)) run.candidateOrder.push(key);
    }
    const currentTop = this.activeCandidates().slice(0, 2).map((c) => c.hypothesisKey).sort().join("\u0000");
    if (previousTop !== currentTop) {
      run.probeResolved = false;
      run.discriminates = [];
    }
  }

  noteArtifactVersion(id: string): void {
    if (!this.run.artifactVersionIds.includes(id)) this.run.artifactVersionIds.push(id);
  }

  noteServerSeq(seq: number): void { this.run.lastServerSeq = Math.max(this.run.lastServerSeq, seq); }

  /** 本轮出现过的候选，按支持次数从多到少；选区分性探针时取前两个 */
  activeCandidates(): readonly { hypothesisKey: string; supporting: number }[] {
    const run = this.run;
    return run.candidateOrder
      .map((key) => ({ hypothesisKey: key, supporting: run.supportCount[key] ?? 0 }))
      .sort((a, b) => b.supporting - a.supporting || (a.hypothesisKey < b.hypothesisKey ? -1 : a.hypothesisKey > b.hypothesisKey ? 1 : 0)).slice(0, 3);
  }

  usedProbeIds(): readonly string[] { return [...this.run.usedProbeIds]; }

  /** 唯一的取值方法：拿到的是一份完整的轮次事实，不给外部零散读写内部状态的口子 */
  snapshot(now: number): ChallengeRun {
    const run = this.run;
    return {
      runId: run.runId, sessionId: this.sessionId, challengeId: run.challengeId, discipline: run.discipline,
      probeFamilyId: run.probeFamilyId, difficultyBand: run.difficultyBand, difficultyBandIndex: run.difficultyBandIndex,
      developmentGoalId: run.developmentGoalId, childFacingGoalPhrase: run.childFacingGoalPhrase,
      surfaceContextKey: run.surfaceContextKey, surfaceContextLabel: run.surfaceContextLabel, claimKey: run.claimKey,
      startedAt: run.startedAt, endedAt: now, firstServerSeq: run.firstServerSeq, lastServerSeq: run.lastServerSeq,
      artifactVersionIds: [...run.artifactVersionIds],
      maxHintLevelUsed: run.maxHintLevelUsed, escalationCount: run.escalationCount, probesIssued: run.probesIssued,
      transferOutcome: run.transferOutcome, transferHintLevelUsed: run.transferHintLevelUsed, transferTainted: run.transferTainted,
      reconstructed: run.reconstructed, assistedRound: run.assistedRound, selfCorrectionObserved: run.selfCorrectionObserved,
      timeToFirstProductiveActionMs: run.firstProductiveActionAt === null ? null : run.firstProductiveActionAt - run.startedAt,
      probeResolved: run.probeResolved, discriminates: [...run.discriminates],
    };
  }

  toJSON(): RunRecorderState {
    return { sessionId: this.sessionId, learnerId: this.learnerId, runSeq: this.runSeq, run: structuredClone(this.facts) };
  }

  static from(state: RunRecorderState): RunRecorder {
    const recorder = new RunRecorder(state.sessionId, state.learnerId);
    recorder.runSeq = state.runSeq;
    recorder.facts = structuredClone(state.run);
    // 旧快照没有间隔事实，按尚无新产出恢复，不能借重启绕过预算。
    if (recorder.facts) recorder.facts.newOutputSinceLastProbe ??= false;
    return recorder;
  }
}
