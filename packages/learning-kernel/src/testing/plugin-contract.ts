// packages/learning-kernel/src/testing/plugin-contract.ts
// 插件契约检查（设计稿 15.2）：每个插件的测试都调用它并断言全部通过，所有学科插件共用同一套检查。
// 返回结构化结果而不是直接断言，避免内核源码依赖测试框架。
import { teachingProposalSchema } from "@ai-scholar/session-contracts";
import { screenChildFacingText } from "../growth/forbidden-labels.js";
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

  // ── 成长记忆层要求插件提供的东西（设计稿 §1.2）──
  const bands = plugin.manifest.difficultyBands;
  push("manifestHasOrderedDifficultyBands", bands.length > 0 && bands.includes(challenge.difficultyBand), "难度带表非空，且生成的挑战落在表里");
  const roundTrip = JSON.parse(JSON.stringify(plugin.manifest)) as unknown;
  push("manifestForbiddenPatternsSerializable",
    plugin.manifest.forbiddenClaimPatterns.every((p) => typeof p === "string") && JSON.stringify(roundTrip) === JSON.stringify(plugin.manifest),
    "贬义说法存字符串模式，manifest 必须能整体序列化");

  const catalogIds = new Set(plugin.manifest.hypothesisCatalog.map((h) => h.id));
  const goal = plugin.manifest.developmentGoals.find((g) => g.id === challenge.developmentGoalId);
  push("developmentGoalDeclared", goal !== undefined && goal.childFacingGoalPhrase === challenge.childFacingGoalPhrase, "挑战的发展目标要在目录里，且儿童版说法与目录一致");

  const phrases = [challenge.childFacingGoalPhrase, challenge.surfaceContextLabel, ...plugin.manifest.hypothesisCatalog.map((h) => h.childFacingGuess)];
  const badPhrase = phrases.find((text) =>
    text.trim().length === 0 || [...text].length > 40 || /\d+\s*%|0\.\d/.test(text) ||
    screenChildFacingText({ childFacingText: text, evidenceSummaryText: "", targetObjectLabel: "", scopeLabel: "" }, plugin.manifest.forbiddenClaimPatterns).length > 0);
  push("childFacingPhrasesReadable", badPhrase === undefined, badPhrase === undefined ? "" : `这句话不适合给孩子看：${badPhrase}`);

  const sampleEvent = {
    eventId: "contract-e1", clientSessionId: "contract", deviceId: "contract", clientSeq: 1, occurredAt: 1,
    quality: "confirmed" as const, source: "child_voice" as const, semanticObjectIds: [],
    payload: { type: "ANSWER" as const, text: "0" },
  };
  const sampleEvidence = plugin.interpretEvent(challenge, sampleEvent, []);
  push("evidenceCarriesSurfaceContext",
    sampleEvidence.every((e) => e.surfaceContextKey.length > 0 && e.hypothesisSupport.every((h) => h.direction === "supports" || h.direction === "weakens")),
    "每条证据都要带非空表面情境键，方向只能是支持或削弱");

  const probes = plugin.discriminatingProbes(challenge);
  push("hypothesisCatalogCoversProbes",
    probes.every((probe) => Object.values(probe.outcomes).flat().every((sup) => catalogIds.has(sup.hypothesisId))),
    "探针涉及的每个假设都要在假设目录里，否则孩子看不到它的儿童版说法");
  push("classifyProbeOutcomeHasSample",
    probes.every((probe) => Object.keys(probe.outcomes).every((outcome) =>
      (probe.samples[outcome] ?? []).some((sample) => plugin.classifyProbeOutcome(probe, sample) === outcome))),
    "每个回答类别至少要有一条样例回答能被归回该类别");
  push("probeQuestionsReadable",
    probes.every((probe) => [...probe.question].length <= 40 && (probe.question.match(/[?？]/g) ?? []).length <= 1),
    "探针问句要孩子读得懂：不超过 40 字，最多一个问号");
  // 比「碰到两个假设」更严：必须存在两个候选 A、B 和两个回答类别，各自把 A、B 分向相反方向
  const separates = probes.length > 0 && probes.every((probe) => {
    const entries = Object.entries(probe.outcomes);
    if (entries.length < 2) return false;
    const ids = [...new Set(entries.flatMap(([, sups]) => sups.map((s) => s.hypothesisId)))];
    const dir = (outcome: string, id: string) => probe.outcomes[outcome]?.find((s) => s.hypothesisId === id)?.direction;
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const splits = entries.filter(([name]) => dir(name, a) !== undefined && dir(name, b) !== undefined && dir(name, a) !== dir(name, b));
        if (splits.length >= 2) return true;
      }
    }
    return false;
  });
  push("discriminatingProbesSeparateHypotheses", separates, "每个探针要有两个回答类别，把某两个候选分向相反方向");
  return checks;
}
