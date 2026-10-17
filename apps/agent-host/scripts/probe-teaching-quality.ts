/** 有界教学质量回归：冻结三条真实失败，实际老师历史续聊；旧坏稿仅作故障注入对照。 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadQwenConfig } from "../src/ai/config.js";
import { requestWorkspaceText } from "../src/ai/qwen-workspace-session.js";
import { QwenTeachingDecisionProvider, type TeachingInput, type TeachingDecision } from "../src/ai/workspace-teaching-decision.js";
import { conversationAction } from "../src/learning/conversation-policy.js";
import { reserveProductionCall, type ProductionBudget } from "./production-teaching-probe-core.js";
import { costEstimate } from "./teaching-ablation-core.js";
import { assertPrivateDirectory } from "./teaching-continuity-repair-probe-core.js";
import type { UsageRecord } from "../src/ai/workspace-usage.js";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const write = (dir: string, name: string, value: unknown, exclusive = false) => fs.writeFile(path.join(dir, name), JSON.stringify(value, null, 2), { mode: 0o600, ...(exclusive ? { flag: "wx" } : {}) });
const append = (dir: string, name: string, value: unknown) => fs.appendFile(path.join(dir, name), JSON.stringify(value) + "\n", { mode: 0o600 });
const read = async <T>(dir: string, name: string): Promise<T> => JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
interface Fixture { id: string; input: TeachingInput; imageBase64: string; imageHash: string; oldDraft: TeachingDecision; sourceResultId: string; followups: string[] }
interface Cases { trajectories: Fixture[]; controls: { id: string; fixtureId: string; child: string; permission: TeachingInput["permission"] }[] }
interface ParentRow { id: string; caseId: string; inputHash: string; imageHash: string; decision: TeachingDecision | null; error: string | null }
interface Call { caseId: string; number: number; kind: "draft" | "review" | "repair"; raw: string | null; prompt: string; ms: number; error: string | null; usage: UsageRecord[]; cost: number | null }

export function classifyFaultReview(raw: string): boolean | null {
  try {
    const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/iu, "$1"));
    if (value.allowed === true && value.reason === "none") return true;
    if (value.allowed === false && ["answer_leak", "math_error", "fabricated_image", "repeated_question", "help_not_reduced", "relation_check_skipped", "review_overreach"].includes(value.reason)) return false;
  } catch { /* 无效复核不是坏稿已被正确检出。 */ }
  return null;
}

export function nextQualityInput(previous: TeachingInput, decision: TeachingDecision, child: string, id: string): TeachingInput {
  const next = structuredClone(previous);
  next.history.push(structuredClone(decision));
  next.record.feedback = next.history.map(d => ({ turnId: d.turnId, responseId: d.responseId, summary: d.utterance, contested: false }));
  next.child = child; next.turnId = hash(id + ":turn").slice(0, 32); next.responseId = hash(id + ":response").slice(0, 32);
  next.permission = conversationAction("dialogue", child) === "help" ? "hint" : "review";
  next.record.submissions.push({ submissionId: hash(id + ":submission").slice(0, 32), problemId: next.record.problem!.problemId,
    problemRevision: next.record.problem!.statement.revision, boardRevision: next.record.board.revision,
    previewId: next.imageId!, explanation: child });
  return next;
}

export async function prepareQualityProbe(source: string, output: string, hostRoot: string) {
  assertPrivateDirectory(output, source, path.resolve(hostRoot, "../.."));
  const rowsText = await fs.readFile(path.join(source, "repair-results.jsonl"), "utf8");
  const rows = rowsText.trim().split("\n").map(line => JSON.parse(line) as ParentRow);
  const specifications = [
    { id: "planting-1", followups: ["我还是不知道间隔在哪儿，帮我只看一处。", "我想不用画图，用手指当树，两个指头中间那段空隙就是间隔。我先自己试。"] },
    { id: "multiply-2", followups: ["我不会算那份的钱，帮我一下，先别告诉我最后多少钱。", "我想用钱来算，3.6元是36角，先给十份分钱，暂时不求四份总价。"] },
    { id: "equation-0", followups: ["我不懂花掉和找回的怎么分，帮我先弄清其中一笔。", "八元回到我手里，买书的钱和它合起来是付出的五十元，我想先自己改式子。"] },
  ];
  const sourceHashes: Record<string, string> = { "repair-results.jsonl": hash(rowsText) };
  const trajectories: Fixture[] = [];
  for (const spec of specifications) {
    const found = rows.filter(row => row.caseId === spec.id);
    if (found.length !== 1 || !found[0]!.decision || found[0]!.error) throw Error("missingActualFailureSample");
    const row = found[0]!;
    if (!/^[a-z0-9-]+$/iu.test(row.id)) throw Error("invalidArchivedId");
    const file = `input-${row.id}.json`, bytes = await fs.readFile(path.join(source, file), "utf8");
    const snapshot = JSON.parse(bytes) as { input: TeachingInput; imageBase64: string; imageHash: string; inputHash: string };
    if (hash(JSON.stringify({ ...snapshot.input, image: undefined })) !== row.inputHash || snapshot.inputHash !== row.inputHash
      || hash(Buffer.from(snapshot.imageBase64, "base64")) !== row.imageHash || snapshot.imageHash !== row.imageHash) throw Error("archiveHashMismatch");
    sourceHashes[file] = hash(bytes);
    trajectories.push({ ...spec, input: snapshot.input, imageBase64: snapshot.imageBase64, imageHash: snapshot.imageHash, oldDraft: row.decision!, sourceResultId: row.id });
  }
  const cases: Cases = { trajectories, controls: [
    { id: "legitimate-rehearing", fixtureId: "planting-1", child: "我没听清，刚才那句话再说一遍。", permission: "clarification" },
    { id: "legitimate-substitution", fixtureId: "equation-0", child: "我已改成三乘x加八等于五十，解出十四元，想代回原题检查。", permission: "review" },
    { id: "child-chosen-method", fixtureId: "multiply-2", child: "我自己准备先把3.6除以10，再乘4，还没算，只核对这个顺序对不对。", permission: "review" },
  ] };
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 }); await fs.mkdir(output, { mode: 0o700 });
  await write(output, "quality-cases.json", cases, true);
  await write(output, "quality-manifest.json", { sourceDirectory: source, sourceHashes, casesHash: hash(JSON.stringify(cases)),
    limits: { subrequests: 60, durationMs: 1200000, knownCostCny: 0.6 }, defaultChanged: false, t3: null,
    scopes: { genuineModelTrajectories: 9, legitimateControls: 3, archivedBadDraftFaultControls: 3 },
    note: "只冻结当时的实际前缀；后续只追加本次实际交付老师。原图不变化，后续孩子为口述模拟，不伪造新笔迹。故障注入原坏稿不是新模型输出，单独统计。价格沿用原实验北京标价估算，不含ASR/TTS、不是实付账单。" }, true);
}

export async function claimQualityBudget(output: string, parent?: string): Promise<ProductionBudget> {
  if (parent && path.resolve(output) !== path.join(path.resolve(parent), "followup")) throw Error("followupMustBeChildDirectory");
  const budget: ProductionBudget = parent ? await read(parent, "quality-ledger.json")
    : { calls: 0, maxCalls: 60, deadline: Date.now() + 1200000, knownCostCny: 0, costLimitCny: 0.6 };
  if (budget.maxCalls !== 60 || budget.costLimitCny !== 0.6 || !Number.isInteger(budget.calls)
    || budget.calls < 0 || budget.calls > 60 || !Number.isFinite(budget.deadline) || !Number.isFinite(budget.knownCostCny)) throw Error("invalidSharedBudget");
  await write(output, "quality-run-started.json", { time: new Date().toISOString(), parent: parent ?? null }, true);
  return budget;
}

export async function runQualityProbe(output: string, hostRoot: string, transport = requestWorkspaceText, parent?: string) {
  const manifest = await read<{ sourceDirectory: string; casesHash: string }>(output, "quality-manifest.json");
  assertPrivateDirectory(output, manifest.sourceDirectory, path.resolve(hostRoot, "../.."));
  if ((await fs.stat(output)).mode & 0o077) throw Error("privateDirectoryRequired");
  const cases = await read<Cases>(output, "quality-cases.json");
  if (hash(JSON.stringify(cases)) !== manifest.casesHash || cases.trajectories.length !== 3 || cases.controls.length !== 3) throw Error("changedFrozenCases");
  const config = loadQwenConfig(); if (config.decisionMode !== "realtime") throw Error("defaultRealtimeRequired");
  const budget = await claimQualityBudget(output, parent);
  const saveLedger = async () => { await write(output, "quality-ledger.json", budget); if (parent) await write(parent, "quality-ledger.json", budget); };
  const sources: Record<string, string> = {};
  for (const file of (await fs.readdir(path.join(hostRoot, "src"), { recursive: true })).filter(file => file.endsWith(".ts"))) {
    const bytes = await fs.readFile(path.join(hostRoot, "src", file)), target = path.join(output, "source-snapshot", file);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await fs.writeFile(target, bytes, { mode: 0o600, flag: "wx" }); sources[file] = hash(bytes);
  }
  const runnerBytes = await fs.readFile(path.join(hostRoot, "scripts/probe-teaching-quality.ts"));
  await fs.writeFile(path.join(output, "probe-teaching-quality.ts"), runnerBytes, { mode: 0o600, flag: "wx" });
  await write(output, "quality-run-version.json", { sources, runnerHash: hash(runnerBytes), casesHash: manifest.casesHash, mode: "realtime", voiceTested: false });
  const results: { id: string; kind: string; decision: TeachingDecision | null; error: string | null; ms: number; injectedDrafts: number; badAccepted: boolean | null; faultReviewed: boolean }[] = [];
  let blocked: string | null = null, unknownCosts = 0;
  const deadlineSignal = AbortSignal.timeout(Math.max(1, budget.deadline - Date.now()));
  const execute = async (id: string, kind: string, fixture: Fixture, input: TeachingInput, inject = false) => {
    await write(output, `input-${id}.json`, { input, imageBase64: fixture.imageBase64, imageHash: fixture.imageHash, inputHash: hash(JSON.stringify(input)),
      injectedOldDraft: inject ? fixture.oldDraft : null, sourceResultId: fixture.sourceResultId }, true);
    let first = true, sawDraft = false, faultReviewed = false, badAccepted: boolean | null = null;
    const request: typeof requestWorkspaceText = async (cfg, prompt, image, signal, context) => {
      if (inject && first) { first = false; sawDraft = true; return JSON.stringify(fixture.oldDraft); }
      first = false;
      try { reserveProductionCall(budget, Date.now()); } catch (error) { blocked = (error as Error).message; throw error; }
      await saveLedger();
      const call: Call = { caseId: id, number: budget.calls, kind: prompt.startsWith("你是独立的抢答复核器") ? "review" : sawDraft ? "repair" : "draft",
        raw: null, prompt, ms: 0, error: null, usage: [], cost: null };
      if (call.kind !== "review") sawDraft = true;
      const begin = performance.now();
      try {
        call.raw = await transport(cfg, prompt, image, signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal,
          { sessionId: context?.sessionId ?? input.record.sessionId, turnId: context?.turnId ?? input.turnId,
            purpose: "decision", onUsage: usage => { call.usage.push(usage); context?.onUsage?.(usage); } });
        if (inject && !faultReviewed && call.kind === "review") {
          faultReviewed = true;
          badAccepted = classifyFaultReview(call.raw);
        }
        return call.raw;
      } catch (error) { call.error = error instanceof Error ? error.message.slice(0, 240) : "requestFailed"; throw error; }
      finally {
        call.ms = Math.round(performance.now() - begin);
        const costs = call.usage.map(u => costEstimate(u.usage, "realtime"));
        call.cost = costs.length && costs.every(v => v !== null) ? costs.reduce<number>((sum, v) => sum + v!, 0) : null;
        budget.knownCostCny += costs.reduce<number>((sum, v) => sum + (v ?? 0), 0); if (call.cost === null) unknownCosts++;
        await append(output, "quality-calls.jsonl", call); await saveLedger();
      }
    };
    const result = { id, kind, decision: null as TeachingDecision | null, error: null as string | null, ms: 0, injectedDrafts: inject ? 1 : 0, badAccepted, faultReviewed };
    const started = performance.now();
    try { result.decision = await new QwenTeachingDecisionProvider(config, undefined, request).decide({ ...input, image: Buffer.from(fixture.imageBase64, "base64") },
      AbortSignal.any([deadlineSignal, AbortSignal.timeout(120000)])); }
    catch (error) { result.error = error instanceof Error ? error.message.slice(0, 240) : "decisionFailed"; }
    result.ms = Math.round(performance.now() - started); result.badAccepted = badAccepted; result.faultReviewed = faultReviewed;
    results.push(result); await append(output, "quality-results.jsonl", result);
    console.log(JSON.stringify({ id, kind, delivered: !!result.decision, error: result.error, badAccepted, ms: result.ms, totalCalls: budget.calls }));
    if (blocked) throw Error(blocked);
    return result;
  };
  try {
    for (const fixture of cases.trajectories.filter(f => !parent || f.id === "planting-1")) {
      let input = structuredClone(fixture.input);
      for (let index = 0; index < 3; index++) {
        const result = await execute(`${fixture.id}-turn-${index}`, "trajectory", fixture, input);
        if (result.error || !result.decision) break;
        if (index < 2) input = nextQualityInput(input, result.decision, fixture.followups[index]!, `${fixture.id}-${index + 1}`);
      }
    }
    for (const control of parent ? [] : cases.controls) {
      const fixture = cases.trajectories.find(f => f.id === control.fixtureId)!;
      const input = { ...structuredClone(fixture.input), child: control.child, permission: control.permission,
        turnId: hash(control.id + ":turn").slice(0, 32), responseId: hash(control.id + ":response").slice(0, 32) };
      await execute(control.id, "legitimate-control", fixture, input);
    }
    for (const fixture of cases.trajectories) await execute(`fault-${fixture.id}`, "archived-fault-control", fixture, structuredClone(fixture.input), true);
  } catch (error) { blocked ??= error instanceof Error ? error.message : "runFailed"; }
  const expected = [...cases.trajectories.filter(f => !parent || f.id === "planting-1").flatMap(f => Array.from({ length: 3 }, (_, i) => `${f.id}-turn-${i}`)), ...(parent ? [] : cases.controls.map(c => c.id)), ...cases.trajectories.map(f => `fault-${f.id}`)];
  const summary = { calls: budget.calls, knownEstimatedCostCny: budget.knownCostCny, estimatedTotalCostCny: unknownCosts ? null : budget.knownCostCny,
    unknownCosts, deadline: new Date(budget.deadline).toISOString(), attempted: results.length, delivered: results.filter(r => r.decision && !r.error).length,
    failed: results.filter(r => r.error || !r.decision).map(r => r.id), uncovered: expected.filter(id => !results.some(r => r.id === id)),
    badAccepted: results.filter(r => r.kind === "archived-fault-control" && r.badAccepted === true).map(r => r.id),
    faultNotReviewed: results.filter(r => r.kind === "archived-fault-control" && (!r.faultReviewed || r.badAccepted === null)).map(r => r.id),
    blocked, t1: null, t2: null, t3: null, passed: false, gradeStatus: "independent_review_required", voiceTested: false,
    note: "三条旧坏稿仅故障注入对照，不能算新模型老师回复；原有家庭数据不写入。" };
  await write(output, "quality-summary.json", summary); console.log(JSON.stringify(summary)); return summary;
}

async function main() {
  const args = process.argv.slice(2), flag = args.indexOf("--host-root");
  const hostRoot = flag >= 0 ? args.splice(flag, 2)[1]! : path.resolve(import.meta.dirname, "..");
  const [mode, first, second] = args;
  if (!first || !path.isAbsolute(first) || !path.isAbsolute(hostRoot)) throw Error("absolutePathsRequired");
  if (mode === "prepare" && second) await prepareQualityProbe(first, second, hostRoot);
  else if (mode === "run" || mode === "followup") {
    const output = mode === "followup" ? path.join(first, "followup") : first;
    if (mode === "followup") {
      // 仅一次补验，原结果不覆盖，预算与截止时间继承；不重新准备或重置计数。
      await fs.mkdir(output, { mode: 0o700 });
      for (const file of ["quality-cases.json", "quality-manifest.json"]) await fs.copyFile(path.join(first, file), path.join(output, file), 1);
    }
    const s = await runQualityProbe(output, hostRoot, requestWorkspaceText, mode === "followup" ? first : undefined);
    if (s.failed.length || s.uncovered.length || s.badAccepted.length || s.faultNotReviewed.length || s.blocked) process.exitCode = 2;
  }
  else throw Error("prepare ABS_SOURCE ABS_FRESH_OUTPUT --host-root ABS | run ABS_OUTPUT --host-root ABS");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(e => { console.error(e instanceof Error ? e.message : "probeFailed"); process.exitCode = 1; });
