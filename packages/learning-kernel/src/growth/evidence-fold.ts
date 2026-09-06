// 证据链接与离散摘要（设计稿 §4）。
// 账本里唯一的事实行是「主张 ↔ 证据」链接；五个计数全部由它 fold 出来，从不增量累加、从不递减。
// 删除只把链接翻成失效再整体重算，所以「只由已确认且未删除的事件算出」是结构上成立的，
// 而不是靠每个写入点都记得维护计数。
import type { DisciplineEvidence } from "../challenge.js";
import type { EvidenceQuality } from "@ai-scholar/session-contracts";
import { linkIdOf } from "./constants.js";
import type { ChallengeRun, ClaimEvidenceLink, DiscreteCounts } from "./types.js";

export interface BuildLinksInput {
  run: ChallengeRun;
  evidence: readonly DisciplineEvidence[];
  /** 账本不信调用方给的质量，逐条回查 */
  qualityOf: (eventId: string) => EvidenceQuality;
  artifactVersionOf: (eventId: string) => string | null;
}

export interface BuildLinksResult {
  links: ClaimEvidenceLink[];
  /** 未确认的转写不成链接，单独计数供 Agent 视图查看，不进任何计数 */
  skippedUnconfirmed: number;
}

/**
 * 一条证据可产生多行链接：一行挂在主张上（主张级计数用），再为每个假设各挂一行。
 * 未确认的转写一条都不成链接——规范 13 要求未确认转写不得形成根因判断与长期记忆。
 */
export function buildEvidenceLinks(input: BuildLinksInput): BuildLinksResult {
  const links: ClaimEvidenceLink[] = [];
  let skippedUnconfirmed = 0;
  let order = 0;

  for (const evidence of input.evidence) {
    if (input.qualityOf(evidence.eventId) === "unconfirmed") {
      skippedUnconfirmed += 1;
      continue;
    }
    order += 1;
    const targets: Array<{ hypothesisKey: string | null; direction: "supports" | "weakens" }> = [
      { hypothesisKey: null, direction: netDirectionOf(evidence) },
      ...evidence.hypothesisSupport.map((support) => ({ hypothesisKey: support.hypothesisId, direction: support.direction })),
    ];
    for (const target of targets) {
      links.push({
        linkId: linkIdOf(input.run.runId, evidence.evidenceId, input.run.claimKey, target.hypothesisKey),
        learnerId: "", runId: input.run.runId, eventId: evidence.eventId, evidenceId: evidence.evidenceId,
        claimKey: input.run.claimKey, hypothesisKey: target.hypothesisKey, direction: target.direction,
        surfaceContextKey: evidence.surfaceContextKey,
        fromProbeId: evidence.fromProbeId ?? null,
        selfCorrection: evidence.selfCorrection,
        artifactVersionId: input.artifactVersionOf(evidence.eventId),
        observedAt: input.run.startedAt + order,
        status: "active",
      });
    }
  }
  return { links, skippedUnconfirmed };
}

/** 一条证据对主张本身的方向：只要它削弱了任何一个候选就记为削弱，没有假设时按支持记 */
function netDirectionOf(evidence: DisciplineEvidence): "supports" | "weakens" {
  if (evidence.hypothesisSupport.length === 0) return "supports";
  return evidence.hypothesisSupport.some((s) => s.direction === "weakens") ? "weakens" : "supports";
}

/** 同一轮内同一组链接的净方向：按观察时间取最后一条。两条原始链接都留在表里，不覆盖历史。 */
export function foldRunDirection(links: readonly ClaimEvidenceLink[]): "supports" | "weakens" {
  const active = links.filter((l) => l.status === "active");
  const last = active.reduce<ClaimEvidenceLink | null>((acc, l) => (acc === null || l.observedAt >= acc.observedAt ? l : acc), null);
  return last?.direction ?? "supports";
}

/**
 * 五个离散计数（设计稿 §4.2）。计数单位是「挑战」不是「事件」：
 * 一轮里说得多的孩子不该因此显得证据更足。
 */
export function summarizeClaim(links: readonly ClaimEvidenceLink[], runs: readonly ChallengeRun[]): DiscreteCounts {
  const active = links.filter((l) => l.status === "active" && l.hypothesisKey === null);
  const byRun = new Map<string, ClaimEvidenceLink[]>();
  for (const link of active) byRun.set(link.runId, [...(byRun.get(link.runId) ?? []), link]);

  let supportingChallenges = 0;
  let refutingChallenges = 0;
  for (const runLinks of byRun.values()) {
    if (foldRunDirection(runLinks) === "supports") supportingChallenges += 1;
    else refutingChallenges += 1;
  }

  const runById = new Map(runs.map((r) => [r.runId, r]));
  let independentTransferSuccesses = 0;
  let hintedSuccesses = 0;
  for (const runId of byRun.keys()) {
    const run = runById.get(runId);
    if (!run || run.transferOutcome !== "succeeded") continue;
    // 无提示迁移：这一轮不是辅助轮，迁移期没用过提示，也没绕道拿过提示
    if (!run.assistedRound && run.transferHintLevelUsed === 0 && !run.transferTainted) independentTransferSuccesses += 1;
    // 用过提示的成功照常记账：四级演示之后的零提示迁移允许写入，但依赖度不抹掉
    if (run.transferHintLevelUsed > 0 || run.maxHintLevelUsed > 0) hintedSuccesses += 1;
  }

  return {
    supportingChallenges,
    refutingChallenges,
    distinctSurfaceContexts: new Set(active.map((l) => l.surfaceContextKey)).size,
    independentTransferSuccesses,
    hintedSuccesses,
  };
}
