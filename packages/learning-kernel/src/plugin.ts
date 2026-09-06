// packages/learning-kernel/src/plugin.ts
// 学科插件契约（设计稿 4.2、10.5）：插件回答“研究什么 → 怎样观察 → 怎样发问 → 怎样探索 → 什么算证据 → 怎样表达 → 怎样迁移”。
// 内核只通过这个接口与学科交互，不得出现任何学科字面量。
import type { ChallengeInput, DisciplineEvidence, DiscriminatingProbe, EvidenceEvent, ExplainBackVerdict, LearningChallenge } from "./challenge.js";

export interface DisciplinePluginManifest {
  id: string;
  displayName: string;
  version: string;
  semanticObjectKinds: string[];
  thinkingMoves: string[];
  artifactTypes: string[];
  curriculumVersions: string[];
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

export type { ChallengeInput, DisciplineEvidence, DiscriminatingProbe, ExplainBackVerdict, LearningChallenge };
