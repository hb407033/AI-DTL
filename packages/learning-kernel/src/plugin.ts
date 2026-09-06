// packages/learning-kernel/src/plugin.ts
// 学科插件契约（设计稿 4.2、10.5）：插件回答“研究什么 → 怎样观察 → 怎样发问 → 怎样探索 → 什么算证据 → 怎样表达 → 怎样迁移”。
// 内核只通过这个接口与学科交互，不得出现任何学科字面量。
import type { ChallengeInput, DisciplineEvidence, DiscriminatingProbe, DueReview, EvidenceEvent, ExplainBackVerdict, KnownRecordRef, LearningChallenge } from "./challenge.js";

export interface DisciplinePluginManifest {
  id: string;
  displayName: string;
  version: string;
  semanticObjectKinds: string[];
  thinkingMoves: string[];
  artifactTypes: string[];
  curriculumVersions: string[];
  /** 难度带，由易到难有序。脚手架点记录时固化下标，账本此后不再问插件 */
  difficultyBands: readonly string[];
  /** 学科专有的贬义说法。存字符串模式而不是正则对象，manifest 才能整体序列化 */
  forbiddenClaimPatterns: readonly string[];
  /** 根因假设目录：孩子看到的猜想整句来自这里，内核一个字不加 */
  hypothesisCatalog: readonly { id: string; childFacingGuess: string; parentFacingLabel: string }[];
  /** 发展目标目录：id 到儿童版短语 */
  developmentGoals: readonly { id: string; childFacingGoalPhrase: string }[];
}

export interface DisciplinePlugin {
  manifest: DisciplinePluginManifest;
  createChallenge(input: ChallengeInput): LearningChallenge;
  interpretEvent(challenge: LearningChallenge, event: EvidenceEvent, history: DisciplineEvidence[]): DisciplineEvidence[];
  isExpectedEvidenceMet(challenge: LearningChallenge, evidence: DisciplineEvidence[]): boolean;
  checkExplainBack(challenge: LearningChallenge, text: string): ExplainBackVerdict;
  createTransfer(challenge: LearningChallenge): LearningChallenge;
  checkTransferAnswer(transfer: LearningChallenge, text: string): boolean;
  discriminatingProbes(challenge: LearningChallenge): DiscriminatingProbe[];
  /** 把孩子对探针的回答归到某个回答类别；归不上返回 null */
  classifyProbeOutcome(probe: DiscriminatingProbe, text: string): string | null;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, DisciplinePlugin>();

  register(plugin: DisciplinePlugin): void {
    if (this.plugins.has(plugin.manifest.id)) throw new Error(`插件 ${plugin.manifest.id} 已注册`);
    this.plugins.set(plugin.manifest.id, plugin);
  }

  get(id: string): DisciplinePlugin {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`插件 ${id} 未注册`);
    return plugin;
  }

  ids(): string[] { return [...this.plugins.keys()]; }
}

export type { ChallengeInput, DisciplineEvidence, DiscriminatingProbe, DueReview, ExplainBackVerdict, KnownRecordRef, LearningChallenge };
