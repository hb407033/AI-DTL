import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { loadQwenConfig } from "../src/ai/config.js";
import { requestWorkspaceText } from "../src/ai/qwen-workspace-session.js";
import { QwenTeachingDecisionProvider, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import type { UsageRecord } from "../src/ai/workspace-usage.js";
import { costEstimate } from "./teaching-ablation-core.js";
import type { ArchiveFixture, ProductionBudget } from "./production-teaching-probe-core.js";
import {
  sha256, freezeFailedInputs, buildTrajectoryInput, appendDeliveredTurn, createRepairBudget,
  reserveRepairCall, continuitySummary, assertPrivateDirectory,
  type ArchivedResult, type ArchivedCall, type RepairCases, type FrozenFailure, type RepairResult,
} from "./teaching-continuity-repair-probe-core.js";

const privateJson = (directory: string, file: string, data: unknown, exclusive = false) =>
  fs.writeFile(path.join(directory, file), JSON.stringify(data, null, 2), { mode: 0o600, ...(exclusive ? { flag: "wx" } : {}) });
const append = (directory: string, file: string, data: unknown) =>
  fs.appendFile(path.join(directory, file), JSON.stringify(data) + "\n", { mode: 0o600 });
const readJson = async <T>(directory: string, file: string): Promise<T> => JSON.parse(await fs.readFile(path.join(directory, file), "utf8"));
const jsonl = <T>(text: string): T[] => text.split(/\r?\n/u).filter(line => line.trim()).map(line => JSON.parse(line));
const repositoryFor = (hostRoot: string) => path.resolve(hostRoot, "../..");

/** 输出叶目录必须全新；档案始终只读，prepare不需要任何凭据。 */
export async function prepareRepairProbe(output: string, source: string, hostRoot = path.resolve(import.meta.dirname, "..")) {
  assertPrivateDirectory(output, source, repositoryFor(hostRoot));
  const names = ["production-cases.json", "production-results.jsonl", "production-calls.jsonl", "production-manifest.json"] as const;
  const files = await Promise.all(names.map(name => fs.readFile(path.join(source, name), "utf8")));
  const cases = JSON.parse(files[0]!) as RepairCases;
  const rows = jsonl<ArchivedResult>(files[1]!);
  const calls = jsonl<ArchivedCall>(files[2]!);
  const replay = freezeFailedInputs(cases, rows, calls);
  if (cases.multiturn.length !== 5 || cases.multiturn.some(t => t.turns.length !== 6)
    || new Set(cases.multiturn.map(t => t.id)).size !== 5) throw Error("fiveFamiliesSixTurnsRequired");
  const continuous = cases.multiturn.map(trajectory => {
    const fixtures = cases.initial.filter(f => f.id === trajectory.baseId);
    if (fixtures.length !== 1) throw Error("missingTrajectoryFixture");
    return { trajectory: structuredClone(trajectory), fixture: structuredClone(fixtures[0]!) };
  });
  const frozen = { replay, continuous };
  const manifest = { schemaVersion: 1, preparedAt: new Date().toISOString(), sourceDirectory: path.resolve(source),
    sourceHashes: Object.fromEntries(names.map((name, i) => [name, sha256(files[i]!)])),
    originalManifest: JSON.parse(files[3]!), casesHash: sha256(JSON.stringify(frozen)),
    replayCases: replay.length, continuousFamilies: continuous.length, continuousTurns: 30,
    modes: ["realtime"], provider: "QwenTeachingDecisionProvider.decide with validation/review/repair",
    limits: { modelSubrequests: 120, durationMs: 1800000, knownCostCny: 2 },
    idsNote: "initial原输入直用；multiturn失败轮与submission的缺失随机ID确定性重建，真实历史ID保留。原错误与每条原始模型调用保存在replay provenance。",
    prices: { basis: "沿用原生产探针已记录的北京标价估算；未知usage/费用为null，已知费用上限不是实付账单上限。",
      inherited: JSON.parse(files[3]!).prices ?? null },
    t3: null, t3Note: "固定模拟孩子脚本，不评真实孩子接住情况。" };
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await fs.mkdir(output, { mode: 0o700 });
  await privateJson(output, "repair-cases.json", frozen, true);
  await privateJson(output, "repair-manifest.json", manifest, true);
  return manifest;
}

/** 永久保留；进程崩溃或预算耗尽也不能从同一目录重新付费调用。 */
export async function claimRepairRun(output: string) {
  await privateJson(output, "repair-run-started.json", { startedAt: new Date().toISOString() }, true);
}

async function snapshotSources(output: string, hostRoot: string) {
  const files = (await fs.readdir(path.join(hostRoot, "src"), { recursive: true })).filter(file => file.endsWith(".ts")).map(file => path.join("src", file));
  for (const file of ["scripts/probe-teaching-continuity-repair.ts", "scripts/teaching-continuity-repair-probe-core.ts",
    "scripts/production-teaching-probe-core.ts", "scripts/teaching-ablation-core.ts"]) {
    if (await fs.stat(path.join(hostRoot, file)).then(s => s.isFile(), () => false)) files.push(file);
  }
  const hashes: Record<string, string> = {};
  for (const file of files.sort()) {
    const bytes = await fs.readFile(path.join(hostRoot, file));
    const target = path.join(output, "source-snapshot", file);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    hashes[file] = sha256(bytes);
  }
  return hashes;
}

interface FrozenCases { replay: FrozenFailure[]; continuous: { trajectory: RepairCases["multiturn"][number]; fixture: ArchiveFixture;
  startIndex?: number; firstInput?: TeachingInput }[] }
interface ModelCall {
  number: number; resultId: string; kind: "draft" | "review" | "repair"; prompt: string; promptHash: string;
  imageHash: string; raw: string | null; error: string | null; ms: number; usage: UsageRecord[];
  estimatedCostCny: number | null;
}
interface RecordedResult extends RepairResult {
  id: string; mode: "realtime"; child: string; inputHash: string; imageHash: string;
  rawFinalJson: string | null; ms: number; subcalls: number; knownCostCny: number; unknownCostCalls: number;
  originalFailureId?: string;
}

interface FollowupParent {
  directory: string; budgetAtStart: ProductionBudget; sourceVersion: unknown; originalSummary: unknown;
  ledgerDirectories: string[];
}

/** 一个已终止父批次最多一次有限续验；历史结果原样保留，只更新共享预算账本。 */
export async function followupRepairProbe(parent: string, output: string,
  hostRoot = path.resolve(import.meta.dirname, ".."), transport = requestWorkspaceText, tail = false) {
  if (!path.isAbsolute(parent) || !path.isAbsolute(output) || !path.isAbsolute(hostRoot)) throw Error("absolutePrivateOutputRequired");
  const summary = await readJson<{ attempted: number; delivered: number; failed: number; calls: number }>(parent, "repair-summary.json")
    .catch(() => { throw Error("parentNotCompleted"); });
  if (!await fs.stat(path.join(parent, "repair-run-started.json")).then(s => s.isFile(), () => false)) throw Error("parentNotCompleted");
  const rows = jsonl<RecordedResult>(await fs.readFile(path.join(parent, "repair-results.jsonl"), "utf8"));
  if (summary.attempted !== rows.length || summary.delivered !== rows.filter(r => r.decision && !r.error).length
    || summary.failed !== rows.filter(r => !r.decision || r.error).length) throw Error("parentNotCompleted");
  const parentManifest = await readJson<{ sourceDirectory: string; casesHash: string; parentDirectory?: string }>(parent, "repair-manifest.json");
  assertPrivateDirectory(output, parentManifest.sourceDirectory, repositoryFor(hostRoot));
  if ((await fs.stat(parent)).mode & 0o077) throw Error("outputMustBePrivate0700");
  const parentCases = await readJson<FrozenCases>(parent, "repair-cases.json");
  if (sha256(JSON.stringify(parentCases)) !== parentManifest.casesHash) throw Error("changedFrozenCases");
  const budget = await readJson<ProductionBudget>(parent, "repair-ledger.json");
  if (budget.maxCalls !== 120 || budget.costLimitCny !== 2 || !Number.isInteger(budget.calls) || budget.calls < 0 || budget.calls > 120
    || !Number.isFinite(budget.knownCostCny) || budget.knownCostCny < 0 || !Number.isFinite(budget.deadline)
    || budget.calls !== summary.calls) throw Error("invalidParentBudget");
  // 顺着既有manifest查找唯一预算root，全部祖先必须与本轮父账本一致；不能以续验新目录重置额度。
  const ledgerDirectories = [path.resolve(parent)];
  let ancestor = parentManifest.parentDirectory;
  while (ancestor) {
    if (!path.isAbsolute(ancestor) || ledgerDirectories.includes(path.resolve(ancestor))) throw Error("invalidBudgetAncestry");
    const directory = path.resolve(ancestor);
    if ((await fs.stat(directory)).mode & 0o077) throw Error("outputMustBePrivate0700");
    const ancestralBudget = await readJson<ProductionBudget>(directory, "repair-ledger.json");
    if ((["calls", "maxCalls", "deadline", "knownCostCny", "costLimitCny"] as const)
      .some(key => ancestralBudget[key] !== budget[key])) throw Error("ancestorBudgetMismatch");
    ledgerDirectories.unshift(directory);
    ancestor = (await readJson<{ parentDirectory?: string }>(directory, "repair-manifest.json")).parentDirectory;
  }
  const failures = rows.filter(r => r.error || !r.decision);
  const replay: FrozenFailure[] = [];
  for (const row of failures.filter(r => r.stage === "replay")) {
    const fixture = parentCases.replay.find(f => f.id === row.caseId);
    if (!fixture || !/^[a-zA-Z0-9-]+$/u.test(row.id)) throw Error("missingParentReplayInput");
    const snapshot = await readJson<{ input: TeachingInput; imageBase64: string; inputHash: string; imageHash: string }>(parent, `input-${row.id}.json`);
    if (sha256(JSON.stringify({ ...snapshot.input, image: undefined })) !== row.inputHash || snapshot.inputHash !== row.inputHash
      || sha256(Buffer.from(snapshot.imageBase64, "base64")) !== row.imageHash || snapshot.imageHash !== row.imageHash) throw Error("changedParentInputSnapshot");
    replay.push({ ...structuredClone(fixture), input: structuredClone(snapshot.input), imageBase64: snapshot.imageBase64,
      inputHash: snapshot.inputHash, imageHash: snapshot.imageHash,
      provenance: { ...fixture.provenance, sourceResultId: row.id, sourceStage: "replay", sourceMode: "realtime",
        note: "父批次实际失败replay完整input快照原样续验；原失败档案保留，不合并成同版全量通过。" } });
  }
  const failedFamilies = new Set(failures.filter(r => r.stage === "multiturn").map(r => r.family));
  const continuous = structuredClone(parentCases.continuous.filter(c => failedFamilies.has(c.trajectory.id)));
  if (continuous.length !== failedFamilies.size || continuous.some(c => c.trajectory.turns.length !== 6)) throw Error("missingFailedFamily");
  if (!replay.length && !continuous.length) throw Error("noActualFailuresForFollowup");
  if (tail) {
    if (replay.length || !continuous.length) throw Error("tailRequiresOnlyFailedFamily");
    for (const item of continuous) {
      const failed = failures.filter(r => r.stage === "multiturn" && r.family === item.trajectory.id);
      if (failed.length !== 1 || failed[0]!.turnIndex == null || !/^[a-zA-Z0-9-]+$/u.test(failed[0]!.id)) throw Error("ambiguousTailFailure");
      const row = failed[0]!;
      const snapshot = await readJson<{ input: TeachingInput; imageBase64: string; inputHash: string; imageHash: string }>(parent, `input-${row.id}.json`);
      if (sha256(JSON.stringify({ ...snapshot.input, image: undefined })) !== row.inputHash || snapshot.inputHash !== row.inputHash
        || sha256(Buffer.from(snapshot.imageBase64, "base64")) !== row.imageHash || snapshot.imageHash !== row.imageHash) throw Error("changedParentInputSnapshot");
      const index = row.turnIndex!;
      if (index < 0 || index >= item.trajectory.turns.length || snapshot.input.history.length !== index
        || snapshot.input.child !== item.trajectory.turns[index]
        || snapshot.input.history.some((d, i) => d.child !== item.trajectory.turns[i])) throw Error("missingDeliveredPrefix");
      item.startIndex = index; item.firstInput = structuredClone(snapshot.input);
      item.fixture.imageBase64 = snapshot.imageBase64;
    }
  }
  const frozen: FrozenCases = { replay, continuous: structuredClone(continuous) };
  const parentSourceVersion = await readJson<unknown>(parent, "repair-run-version.json");
  const manifest = { schemaVersion: 1, kind: "finite-followup", preparedAt: new Date().toISOString(),
    parentDirectory: path.resolve(parent), budgetOwnerDirectory: ledgerDirectories[0], sourceDirectory: parentManifest.sourceDirectory,
    parentCasesHash: parentManifest.casesHash, casesHash: sha256(JSON.stringify(frozen)),
    budgetAtStart: structuredClone(budget), modes: ["realtime"], replayCases: replay.length,
    continuousFamilies: continuous.length, continuousTurns: continuous.reduce((sum, c) => sum + c.trajectory.turns.length - (c.startIndex ?? 0), 0),
    scope: tail ? "failed_tail_with_retained_delivered_prefix" : "only_actual_failed_replay_and_failed_families",
    retainedPrefix: continuous.reduce((sum, c) => sum + (c.startIndex ?? 0), 0),
    differentSourceVersions: true, originalCohortPassed: false,
    note: "仅续验父批次实际失败replay和失败family完整六轮；未重跑其他已完成family，不能声明原39条同一版本全通过。" };
  const config = loadQwenConfig();
  if (config.decisionMode !== "realtime") throw Error("productionDefaultMustRemainRealtime");
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await fs.mkdir(output, { mode: 0o700 });
  await privateJson(parent, "repair-followup-started.json", { output: path.resolve(output), startedAt: new Date().toISOString(),
    budgetAtStart: budget }, true);
  await claimRepairRun(output);
  await privateJson(output, "repair-cases.json", frozen, true);
  await privateJson(output, "repair-manifest.json", manifest, true);
  return executeRepairCohort(output, hostRoot, transport, config, frozen, manifest, budget,
    { directory: parent, ledgerDirectories, budgetAtStart: structuredClone(budget), sourceVersion: parentSourceVersion, originalSummary: summary });
}

/** 测试只可替换最低层传输；门禁、复核、修复始终经过真实生产provider。CLI始终使用生产Realtime传输。 */
export async function runRepairProbe(output: string, hostRoot = path.resolve(import.meta.dirname, ".."), transport = requestWorkspaceText) {
  if (!path.isAbsolute(output) || !path.isAbsolute(hostRoot)) throw Error("absolutePrivateOutputRequired");
  const manifest = await readJson<{ sourceDirectory: string; casesHash: string }>(output, "repair-manifest.json");
  assertPrivateDirectory(output, manifest.sourceDirectory, repositoryFor(hostRoot));
  if ((await fs.stat(output)).mode & 0o077) throw Error("outputMustBePrivate0700");
  const frozen = await readJson<FrozenCases>(output, "repair-cases.json");
  if (sha256(JSON.stringify(frozen)) !== manifest.casesHash) throw Error("changedFrozenCases");
  if (frozen.replay.length !== 9 || frozen.continuous.length !== 5 || frozen.continuous.some(c => c.trajectory.turns.length !== 6)) throw Error("changedFrozenCoverage");
  // runtime.env由启动方注入；脚本不读取、输出、存储密钥或完整配置。
  const config = loadQwenConfig();
  if (config.decisionMode !== "realtime") throw Error("productionDefaultMustRemainRealtime");
  await claimRepairRun(output);
  const budget = createRepairBudget(Date.now());
  return executeRepairCohort(output, hostRoot, transport, config, frozen, manifest, budget);
}

async function executeRepairCohort(output: string, hostRoot: string, transport: typeof requestWorkspaceText,
  config: ReturnType<typeof loadQwenConfig>, frozen: FrozenCases, manifest: { casesHash: string }, budget: ProductionBudget,
  parent?: FollowupParent) {
  const results: RecordedResult[] = [];
  let blocked: string | null = null;
  const budgetSignal = AbortSignal.timeout(Math.max(1, budget.deadline - Date.now()));
  const saveBudget = async () => {
    // 唯一root先写，再逐层父账本，最后写child；中途故障不能释放已经预占的额度。
    if (parent) for (const directory of parent.ledgerDirectories) await privateJson(directory, "repair-ledger.json", budget);
    await privateJson(output, "repair-ledger.json", budget);
  };
  const expectedCases = frozen.replay.length + frozen.continuous.reduce((sum, c) => sum + c.trajectory.turns.length - (c.startIndex ?? 0), 0);
  try {
    const sources = await snapshotSources(output, hostRoot);
    await privateJson(output, "repair-run-version.json", { startedAt: new Date().toISOString(), sources, casesHash: manifest.casesHash,
      mode: config.decisionMode, voiceTested: false, ...(parent ? { parentDirectory: parent.directory,
        parentSourceVersion: parent.sourceVersion, differentSourceVersions: true } : {}) });
    await saveBudget();
    if (Date.now() >= budget.deadline) throw Error("deadline");
    const execute = async (fixture: ArchiveFixture, input: TeachingInput,
      metadata: Pick<RecordedResult, "caseId" | "stage" | "family" | "turnIndex" | "originalFailureId">) => {
      const id = randomUUID(), started = performance.now(), calls: ModelCall[] = [];
      const inputSnapshot = { input: structuredClone(input), imageBase64: fixture.imageBase64,
        imageHash: sha256(Buffer.from(fixture.imageBase64, "base64")) };
      const inputHash = sha256(JSON.stringify({ ...inputSnapshot.input, image: undefined }));
      // 写入完整输入后才能付费；独立快照不会被下一轮history追加污染。
      await privateJson(output, `input-${id}.json`, { ...inputSnapshot, inputHash, ...metadata }, true);
      const request: typeof requestWorkspaceText = async (cfg, instructions, image, signal, context) => {
        try { reserveRepairCall(budget, Date.now()); }
        catch (error) { blocked = (error as Error).message; throw error; }
        await saveBudget();
        const begin = performance.now();
        const call: ModelCall = { number: budget.calls, resultId: id,
          kind: instructions.startsWith("你是独立的抢答复核器") ? "review" : calls.some(c => c.kind !== "review") ? "repair" : "draft",
          prompt: instructions, promptHash: sha256(instructions), imageHash: inputSnapshot.imageHash,
          raw: null, error: null, ms: 0, usage: [], estimatedCostCny: null };
        try {
          const boundedSignal = signal ? AbortSignal.any([signal, budgetSignal]) : budgetSignal;
          call.raw = await transport(cfg, instructions, image, boundedSignal, { ...context,
            sessionId: input.record.sessionId, turnId: input.turnId, purpose: "decision",
            onUsage: usage => { call.usage.push(usage); context?.onUsage?.(usage); } });
          return call.raw;
        } catch (error) { call.error = error instanceof Error ? error.message.slice(0, 240) : "requestFailed"; throw error; }
        finally {
          call.ms = Math.round(performance.now() - begin);
          const costs = call.usage.map(u => costEstimate(u.usage, "realtime"));
          call.estimatedCostCny = costs.length && costs.every(c => c !== null) ? costs.reduce<number>((sum, c) => sum + c!, 0) : null;
          // 一次调用的已知usage仍计入预算，部分未知的总价保持null。
          budget.knownCostCny += costs.reduce<number>((sum, c) => sum + (c ?? 0), 0);
          calls.push(call);
          await append(output, "repair-calls.jsonl", call);
          await saveBudget();
        }
      };
      const result: RecordedResult = { id, ...metadata, mode: "realtime", child: input.child, inputHash,
        imageHash: inputSnapshot.imageHash, decision: null, error: null, rawFinalJson: null,
        ms: 0, subcalls: 0, knownCostCny: 0, unknownCostCalls: 0 };
      try {
        const provider = new QwenTeachingDecisionProvider(config, undefined, request);
        result.decision = await provider.decide({ ...input, image: Buffer.from(fixture.imageBase64, "base64") },
          AbortSignal.any([budgetSignal, AbortSignal.timeout(Math.min(120000, Math.max(1, budget.deadline - Date.now())))]));
      } catch (error) { result.error = error instanceof Error ? error.message.slice(0, 240) : "decisionFailed"; }
      result.rawFinalJson = [...calls].reverse().find(c => c.kind !== "review")?.raw ?? null;
      result.ms = Math.round(performance.now() - started);
      result.subcalls = calls.length;
      result.knownCostCny = calls.reduce((sum, c) => sum + (c.estimatedCostCny ?? 0), 0);
      result.unknownCostCalls = calls.filter(c => c.estimatedCostCny === null).length;
      results.push(result);
      await append(output, "repair-results.jsonl", result);
      console.log(JSON.stringify({ case: result.caseId, stage: result.stage, delivered: !!result.decision,
        error: result.error, ms: result.ms, subcalls: result.subcalls, totalCalls: budget.calls, expectedCases }));
      if (blocked) throw Error(blocked);
      return result;
    };
    for (const fixture of frozen.replay) {
      await execute(fixture, structuredClone(fixture.input), { caseId: fixture.id, stage: "replay", originalFailureId: fixture.originalFailure.id });
    }
    for (const { trajectory, fixture, startIndex = 0, firstInput } of frozen.continuous) {
      const history: TeachingInput["history"] = structuredClone(firstInput?.history ?? []);
      for (let i = startIndex; i < trajectory.turns.length; i++) {
        const input = i === startIndex && firstInput ? structuredClone(firstInput)
          : buildTrajectoryInput(fixture, trajectory, i, history, parent ? "followup-continuous-realtime" : "continuous-realtime");
        const result = await execute(fixture, input, { caseId: `${trajectory.id}-${i}`, stage: "multiturn", family: trajectory.id, turnIndex: i });
        if (!result.decision || result.error) break;
        appendDeliveredTurn(history, result.decision);
      }
    }
  } catch (error) { blocked ??= error instanceof Error ? error.message.slice(0, 240) : "runFailed"; }
  if (Date.now() >= budget.deadline) blocked ??= "deadline";
  const childUnknownCostCalls = results.reduce((sum, r) => sum + r.unknownCostCalls, 0);
  const parentUnknownCostCalls = parent && typeof parent.originalSummary === "object" && parent.originalSummary
    && "unknownCostCalls" in parent.originalSummary && typeof parent.originalSummary.unknownCostCalls === "number"
    ? parent.originalSummary.unknownCostCalls : 0;
  const retainedPrefix = frozen.continuous.reduce((sum, c) => sum + (c.startIndex ?? 0), 0);
  const summary = { ...continuitySummary(frozen.replay, frozen.continuous.map(c => c.trajectory), results, blocked,
    Object.fromEntries(frozen.continuous.map(c => [c.trajectory.id, c.startIndex ?? 0]))),
    calls: budget.calls, maxCalls: 120, knownCostCny: budget.knownCostCny,
    unknownCostCalls: childUnknownCostCalls + parentUnknownCostCalls,
    estimatedTotalCostCny: childUnknownCostCalls + parentUnknownCostCalls ? null : budget.knownCostCny,
    deadline: new Date(budget.deadline).toISOString(), voiceTested: false,
    ...(parent ? { followupCalls: budget.calls - parent.budgetAtStart.calls,
      followupKnownCostCny: budget.knownCostCny - parent.budgetAtStart.knownCostCny,
      followupUnknownCostCalls: childUnknownCostCalls, parentDirectory: parent.directory, budgetOwnerDirectory: parent.ledgerDirectories[0],
      budgetAtStart: parent.budgetAtStart, originalSummary: parent.originalSummary,
      differentSourceVersions: true, originalCohortPassed: false,
      scope: retainedPrefix ? "failed_tail_with_retained_delivered_prefix" : "only_actual_failed_replay_and_failed_families", retainedPrefix,
      versionNote: "父批次原失败、未覆盖及结果保持不变；本次仅为新源码版本的有限失败续验，其他四族未在新版本重跑。" } : {}) };
  await privateJson(output, "repair-summary.json", summary);
  await privateJson(output, "repair-grading-template.json", results.map(r => ({ id: r.id, caseId: r.caseId,
    t1: null, t2: null, t3: null, hard: null, note: "" })));
  console.log(JSON.stringify(summary));
  return summary;
}

async function main() {
  const args = process.argv.slice(2), flag = args.indexOf("--host-root");
  const hostRoot = flag >= 0 ? args.splice(flag, 2)[1] : path.resolve(import.meta.dirname, "..");
  if (!hostRoot || !path.isAbsolute(hostRoot)) throw Error("absoluteHostRootRequired");
  const [mode, output, source] = args;
  if (!output || !path.isAbsolute(output)) throw Error("absolutePrivateOutputRequired");
  if (mode === "prepare") {
    if (!source || !path.isAbsolute(source)) throw Error("absoluteOriginalExperimentRequired");
    console.log(JSON.stringify(await prepareRepairProbe(output, source, hostRoot)));
  } else if (mode === "run") {
    const summary = await runRepairProbe(output, hostRoot);
    if (summary.failed || summary.uncovered || summary.blockedReason) process.exitCode = 2;
  } else if (mode === "followup" || mode === "tail") {
    if (!source || !path.isAbsolute(source)) throw Error("absoluteFreshFollowupOutputRequired");
    const summary = await followupRepairProbe(output, source, hostRoot, requestWorkspaceText, mode === "tail");
    if (summary.failed || summary.uncovered || summary.blockedReason) process.exitCode = 2;
  } else throw Error("usage: prepare ABS_PRIVATE_OUTPUT ABS_ARCHIVE | run ABS_PRIVATE_OUTPUT | followup ABS_PARENT ABS_FRESH_OUTPUT [--host-root ABS_AGENT_HOST]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "probeFailed"); process.exitCode = 1; });
}
