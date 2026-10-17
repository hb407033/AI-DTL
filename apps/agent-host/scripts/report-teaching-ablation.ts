import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw Error("absoluteExperimentDirectoryRequired");
const read = async (name: string) => JSON.parse(await fs.readFile(path.join(root, name), "utf8"));
const rows = (await fs.readFile(path.join(root, "results.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
const scores = [...await read("scores-initial.json"), ...await read("scores-followups.json")];
const fixtures = await read("fixtures.json"), ledger = await read("ledger.json"), rubric = await read("rubric.json");
if (rows.length !== rubric.maxCalls || ledger.calls !== rows.length) throw Error("callCountMismatch");
if (new Set(rows.map(r => r.id)).size !== rows.length || new Set(scores.map(s => s.id)).size !== rows.length)
  throw Error("duplicateResultOrGrade");
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
for (const f of fixtures) {
  const group = rows.filter(r => r.stage === "initial" && r.case === f.id);
  if (group.length !== 3 || new Set(group.map(r => r.arm)).size !== 3
    || new Set(group.map(r => r.inputHash)).size !== 1 || new Set(group.map(r => r.imageHash)).size !== 1)
    throw Error("unequalEvidence");
  if (hash(Buffer.from(f.imageBase64, "base64")) !== f.imageHash || hash(JSON.stringify(f.input)) !== f.inputHash)
    throw Error("fixtureHashMismatch");
  if (hash(f.full) !== f.fullHash || hash(f.compact) !== f.compactHash
    || f.full.split("\n").at(-1) !== f.compact.split("\n").at(-1)) throw Error("promptFactsMismatch");
  for (const r of group) if (r.promptHash !== (r.arm === "compact" ? f.compactHash : f.fullHash)) throw Error("promptHashMismatch");
}
for (const r of rows) {
  const grade = scores.find(s => s.id === r.id);
  if (!grade || grade.scores.length !== 5 || grade.scores.some((n: number) => ![0, 1, 2].includes(n))
    || grade.t1 == null || ![0, 1, 2].includes(grade.t1)
    || grade.t2 == null || ![0, 1, 2].includes(grade.t2)) throw Error("missingOrInvalidGrade");
}
const median = (values: number[]) => { const a = [...values].sort((x, y) => x - y), mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2; };
const summary = ["realtime", "thinking", "compact"].map(arm => {
  const a = rows.filter(r => r.arm === arm), initial = a.filter(r => r.stage === "initial");
  const grade = (r: any) => scores.find(s => s.id === r.id)!;
  const mean = (rs: any[]) => rs.reduce((n, r) => n + grade(r).scores.reduce((x: number, y: number) => x + y, 0), 0) / rs.length;
  const costKnown = a.filter(r => r.estimatedCostCny !== null);
  const knownCost = costKnown.reduce((n, r) => n + r.estimatedCostCny, 0);
  return { arm, requestedModel: a[0].model, requests: a.length, firstRoundMeanScore: mean(initial),
    followupMeanScore: mean(a.filter(r => r.stage === "followup")), overallMeanScore: mean(a),
    t1Mean: a.reduce((n, r) => n + grade(r).t1, 0) / a.length,
    t2Mean: a.reduce((n, r) => n + grade(r).t2, 0) / a.length,
    t3Note: "模拟样本不评T3",
    hardFailureCases: a.filter(r => grade(r).hard.length).map(r => ({ case: r.case, stage: r.stage, reasons: grade(r).hard })),
    hardFailureSummary: { 数学错误: a.filter(r => grade(r).hard.includes("数学错误")).length,
      抢答: a.filter(r => grade(r).hard.includes("抢答")).length,
      虚构画面: a.filter(r => grade(r).hard.includes("虚构画面")).length,
      贴标签: a.filter(r => grade(r).hard.includes("贴标签")).length,
      念动作名: a.filter(r => grade(r).hard.includes("念动作名")).length },
    validationPass: a.filter(r => !r.error && !r.validationError).length,
    requestErrors: a.filter(r => r.error).length, medianMs: median(a.map(r => r.ms)), maxMs: Math.max(...a.map(r => r.ms)),
    initialMedianMs: median(initial.map(r => r.ms)), knownCostCny: knownCost, unknownCostCalls: a.length - costKnown.length,
    avgKnownCostPerRequestCny: costKnown.length ? knownCost / costKnown.length : null,
    inputTokens: a.reduce((n, r) => n + (r.usage?.input_tokens ?? r.usage?.prompt_tokens ?? 0), 0),
    outputTokens: a.reduce((n, r) => n + (r.usage?.output_tokens ?? r.usage?.completion_tokens ?? 0), 0),
    reasoningTokens: arm === "thinking" ? a.reduce((n, r) => n + (r.usage?.completion_tokens_details?.reasoning_tokens ?? 0), 0) : null,
    reasoningObservedCalls: a.filter(r => r.reasoningObserved === true).length,
    cachedTokens: a.reduce((n, r) => n + (r.usage?.prompt_tokens_details?.cached_tokens ?? 0), 0),
    results: a.map(r => ({ id: r.id, case: r.case, stage: r.stage, ms: r.ms, estimatedCostCny: r.estimatedCostCny,
      score: grade(r).scores.reduce((x: number, y: number) => x + y, 0), hard: grade(r).hard,
      utterance: r.parsed?.utterance, note: grade(r).note, error: r.error, validationError: r.validationError })) };
});
const totalKnownCostCny = summary.reduce((n, s) => n + s.knownCostCny, 0);
  const report = { calls: rows.length, maxCalls: rubric.maxCalls, deadline: new Date(ledger.deadline).toISOString(),
  audit: { equalInitialEvidence: true, imageAndPromptHashesVerified: true, allResultsGraded: true,
    noAdditionalJudgeCalls: true, noSpeechGenerationCalls: true }, totalKnownCostCny,
  unknownCostCalls: summary.reduce((n, s) => n + s.unknownCostCalls, 0),
  pricingSource: "https://help.aliyun.com/zh/model-studio/model-pricing", pricingDate: "2026-10-11",
  pricingNote: "北京公开标价、已计返回的缓存折扣；思考包含在输出中，不重复加计；非实际账单，不含语音与优惠免费额。",
  summary };
await fs.writeFile(path.join(root, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, summary: summary.map(({ results, ...rest }) => rest) }, null, 2));
