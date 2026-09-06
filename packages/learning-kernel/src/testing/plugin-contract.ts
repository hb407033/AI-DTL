// packages/learning-kernel/src/testing/plugin-contract.ts
// 插件契约检查（设计稿 15.2）：每个插件的测试都调用它并断言全部通过，所有学科插件共用同一套检查。
// 返回结构化结果而不是直接断言，避免内核源码依赖测试框架。
import { teachingProposalSchema } from "@ai-scholar/session-contracts";
import { KERNEL_BUDGET_CEILING } from "../hint-budget.js";
import type { DisciplinePlugin } from "../plugin.js";

export interface ContractCheck { name: string; pass: boolean; detail: string }

export function runPluginContract(plugin: DisciplinePlugin): ContractCheck[] {
  const checks: ContractCheck[] = [];
  const push = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

  const anchor = plugin.manifest.curriculumVersions[0] ?? "";
  const challenge = plugin.createChallenge({ curriculumAnchor: anchor });
  push("manifestHasKinds", plugin.manifest.semanticObjectKinds.length > 0, "语义对象种类不能为空");
  push("challengeHasVisibleTask", challenge.learnerPrompt.length > 0 && challenge.expectedEvidence.length > 0);
  push("challengeDisciplineMatchesManifest", challenge.discipline === plugin.manifest.id);
  push("budgetWithinKernelCeiling",
    challenge.interventionBudget.softEscalations <= KERNEL_BUDGET_CEILING.softEscalations &&
    challenge.interventionBudget.hardEscalations <= KERNEL_BUDGET_CEILING.hardEscalations &&
    challenge.interventionBudget.maxHintLevel <= KERNEL_BUDGET_CEILING.maxHintLevel, "插件预算只能比内核更严");

  for (const level of [1, 2, 3, 4] as const) {
    const hint = challenge.hintLadder[level];
    const proposal = teachingProposalSchema.safeParse({ proposalId: `contract-${level}`, spokenResponse: hint.spokenResponse, learnerTask: hint.learnerTask, canvasActions: hint.canvasActions, hintLevel: level });
    push(`hintLevel${level}IsValidProposal`, proposal.success, proposal.success ? "" : proposal.error.message);
    const kindsOk = hint.canvasActions.every((a) => a.kind !== "upsertObject" || plugin.manifest.semanticObjectKinds.includes(a.object.kind));
    push(`hintLevel${level}UsesDeclaredKinds`, kindsOk, "提示里的语义对象种类必须在清单中声明");
  }
  push("demoHintRequiresRebuild", challenge.hintLadder[4].learnerTask.length > 0, "4 级演示后必须给出重建任务");

  const transfer = plugin.createTransfer(challenge);
  push("transferKeepsStructureChangesSurface", transfer.challengeId !== challenge.challengeId && transfer.learnerPrompt !== challenge.learnerPrompt && transfer.probeFamilyId === challenge.probeFamilyId);
  push("explainBackRejectsEmpty", plugin.checkExplainBack(challenge, "").passed === false);
  push("transferRejectsEmpty", plugin.checkTransferAnswer(transfer, "") === false);

  const probes = plugin.discriminatingProbes(challenge);
  const separates = probes.length > 0 && probes.every((probe) => {
    const outcomes = Object.values(probe.outcomes);
    if (outcomes.length < 2) return false;
    const touched = new Set(outcomes.flat().map((s) => s.hypothesisId));
    if (touched.size < 2) return false;
    return [...touched].some((h) => new Set(outcomes.map((o) => o.find((s) => s.hypothesisId === h)?.direction ?? "none")).size > 1);
  });
  push("discriminatingProbesSeparateHypotheses", separates, "每个探针至少要对两个假设给出不同方向的证据");
  return checks;
}
