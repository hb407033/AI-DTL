import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { loadQwenConfig } from "../src/ai/config.js";
import { requestWorkspaceText } from "../src/ai/qwen-workspace-session.js";
import { requestThinkingText } from "../src/ai/qwen-thinking-text.js";
import { buildDecisionPrompt, QwenTeachingDecisionProvider, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import { conversationAction } from "../src/learning/conversation-policy.js";
import type { UsageRecord } from "../src/ai/workspace-usage.js";
import { costEstimate } from "./teaching-ablation-core.js";
import { buildProductionCases, reserveProductionCall, type ProductionBudget, type ArchiveFixture, type ProductionCase } from "./production-teaching-probe-core.js";

const [mode, directory, source] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory)) throw Error("absoluteExperimentDirectoryRequired");
const read = async (file: string) => JSON.parse(await fs.readFile(path.join(directory, file), "utf8"));
const save = (file: string, data: unknown) => fs.writeFile(path.join(directory, file), JSON.stringify(data, null, 2));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
if (mode === "prepare") {
  if (!source || !path.isAbsolute(source)) throw Error("absoluteOriginalExperimentRequired");
  const originals = JSON.parse(await fs.readFile(path.join(source, "fixtures.json"), "utf8"));
  const oldResults = (await fs.readFile(path.join(source, "results.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const cases = buildProductionCases(originals, oldResults);
  await fs.mkdir(directory, { recursive: true });
  const budget: ProductionBudget = { calls: 0, maxCalls: 240, deadline: Date.now() + 60 * 60 * 1000, knownCostCny: 0, costLimitCny: 3 };
  await fs.writeFile(path.join(directory, "production-ledger.json"), JSON.stringify(budget, null, 2), { flag: "wx" });
  await save("production-cases.json", cases);
  await save("production-manifest.json", { schemaVersion: 1, preparedAt: new Date().toISOString(),
    sourceHash: hash(JSON.stringify({ originals, oldResults })), casesHash: hash(JSON.stringify(cases)),
    modes: ["realtime", "thinking"], provider: "QwenTeachingDecisionProvider.decide including validation/review/one repair",
    singleTurnCases: cases.initial.length, multiturnFamilies: cases.multiturn.length,
    t3: null, t3Note: "模拟孩子，不评真实孩子接住与否", budget,
    prices: { source: "https://help.aliyun.com/zh/model-studio/model-pricing", date: "2026-10-13", basis: "北京公开标价估算，含返回缓存折扣；不含语音；非实付账单" } });
  console.log(JSON.stringify({ prepared: cases.initial.length, families: cases.multiturn.length, budget }));
} else if (mode === "run") {
  const lock = await fs.open(path.join(directory, "production.lock"), "wx");
  try {
    const config = loadQwenConfig();
    const budget: ProductionBudget = await read("production-ledger.json");
    if (budget.calls !== 0) throw Error("alreadyStartedNoRetry");
    const cases = await read("production-cases.json") as ReturnType<typeof buildProductionCases>;
    const manifest = await read("production-manifest.json");
    if (hash(JSON.stringify(cases)) !== manifest.casesHash) throw Error("changedFrozenCases");
    const sourceFiles = ["src/ai/workspace-teaching-decision.ts", "src/ai/qwen-thinking-text.ts", "src/learning/teaching-decision.ts", "src/learning/families/index.ts"];
    const hostRoot = path.resolve(import.meta.dirname, "..");
    const sources: Record<string, string> = {};
    for (const file of sourceFiles) { const bytes = await fs.readFile(path.join(hostRoot, file)); sources[file] = hash(bytes); await fs.writeFile(path.join(directory, path.basename(file) + ".snapshot"), bytes); }
    await save("production-run-version.json", { startedAt: new Date().toISOString(), sources, casesHash: manifest.casesHash });
    const rows: any[] = []; let stopped: string | null = null;
    const execute = async (fixture: ArchiveFixture, input: TeachingInput, selectedMode: "realtime" | "thinking", metadata: Record<string, unknown>) => {
      const id = randomUUID(), started = performance.now(), calls: any[] = [];
      const request: typeof requestWorkspaceText = async (cfg, instructions, image, signal, context) => {
        reserveProductionCall(budget, Date.now()); await save("production-ledger.json", budget);
        const number = budget.calls, callStart = performance.now(); let usage: UsageRecord | null = null;
        const call: any = { number, resultId: id, kind: instructions.startsWith("你是独立的抢答复核器") ? "review"
          : instructions.includes("上一稿未播放") ? "repair" : "decision", promptHash: hash(instructions), promptChars: instructions.length,
          mode: selectedMode, raw: null, error: null, estimatedCostCny: null };
        try {
          call.raw = await (selectedMode === "thinking" ? requestThinkingText : requestWorkspaceText)(cfg, instructions, image, signal,
            { sessionId: input.record.sessionId, turnId: input.turnId, purpose: "decision", onUsage: r => { usage = r; context?.onUsage?.(r); } });
          return call.raw;
        } catch (e) { call.error = (e as Error).name + ":" + (e as Error).message.slice(0, 120); throw e; }
        finally {
          call.ms = Math.round(performance.now() - callStart); call.usage = usage;
          call.estimatedCostCny = costEstimate((usage as UsageRecord | null)?.usage ?? null, selectedMode === "thinking" ? "thinking" : "realtime");
          if (call.estimatedCostCny !== null) budget.knownCostCny += call.estimatedCostCny;
          calls.push(call); await fs.appendFile(path.join(directory, "production-calls.jsonl"), JSON.stringify(call) + "\n");
          await save("production-ledger.json", budget);
        }
      };
      const result: any = { id, ...metadata, mode: selectedMode, child: input.child,
        inputHash: hash(JSON.stringify({ ...input, image: undefined })), imageHash: hash(input.image ?? Buffer.alloc(0)),
        promptHash: hash(buildDecisionPrompt(input)), decision: null, error: null };
      try {
        const provider = new QwenTeachingDecisionProvider({ ...config, decisionMode: selectedMode }, undefined, request);
        result.decision = await provider.decide(input, AbortSignal.timeout(Math.max(1, Math.min(120000, budget.deadline - Date.now()))));
      } catch (e) { result.error = (e as Error).message.slice(0, 160); }
      result.ms = Math.round(performance.now() - started); result.subcalls = calls.length;
      result.knownCostCny = calls.reduce((n, c) => n + (c.estimatedCostCny ?? 0), 0);
      result.unknownCostCalls = calls.filter(c => c.estimatedCostCny === null).length;
      rows.push(result); await fs.appendFile(path.join(directory, "production-results.jsonl"), JSON.stringify(result) + "\n");
      console.log(JSON.stringify({ case: result.caseId, stage: result.stage, mode: selectedMode, error: result.error,
        ms: result.ms, subcalls: result.subcalls, totalCalls: budget.calls }));
      if (calls.some(c => /callBudget|costBudget|deadline/u.test(c.error ?? "")) || Date.now() >= budget.deadline || budget.calls >= budget.maxCalls)
        throw Error("budgetStopped");
      return result;
    };
    try {
      for (const [index, f] of cases.initial.entries()) {
        for (const selectedMode of (index % 2 ? ["thinking", "realtime"] : ["realtime", "thinking"]) as ("realtime" | "thinking")[]) {
          const input = { ...structuredClone(f.input), image: Buffer.from(f.imageBase64, "base64") };
          await execute(f, input, selectedMode, { caseId: f.id, stage: "initial", category: f.category });
        }
      }
      for (const trajectory of cases.multiturn) {
        for (const selectedMode of ["realtime", "thinking"] as const) {
          const f = cases.initial.find(c => c.id === trajectory.baseId) as ProductionCase;
          const record = structuredClone(f.input.record);
          record.submissions = []; record.feedback = []; record.problem!.statement.text = trajectory.problem;
          const history: TeachingInput["history"] = [];
          for (const [index, child] of trajectory.turns.entries()) {
            const turnId = randomUUID(), responseId = randomUUID();
            const action = conversationAction("dialogue", child);
            record.submissions.push({ submissionId: randomUUID(), problemId: record.problem!.problemId,
              problemRevision: record.problem!.statement.revision, boardRevision: record.board.revision,
              previewId: f.input.imageId!, explanation: child });
            const input: TeachingInput = { record, turnId, responseId, child, history,
              permission: action === "help" ? "hint" : action === "correct" ? "clarification" : "review",
              imageId: f.input.imageId, image: Buffer.from(f.imageBase64, "base64") };
            const result = await execute(f, input, selectedMode, { caseId: `${trajectory.id}-${index}`, stage: "multiturn", family: trajectory.id,
              turnIndex: index, correctFrom: trajectory.correctFrom });
            if (!result.decision) break; // 固定脚本遇到未交付即停该会话，不跳过失败接正确答案。
            history.push(result.decision); record.feedback.push({ turnId, responseId, summary: result.decision.utterance, contested: false });
          }
        }
      }
    } catch (e) { stopped = (e as Error).message; }
    const summaries = ["realtime", "thinking"].map(selectedMode => {
      const a = rows.filter(r => r.mode === selectedMode), sorted = a.map(r => r.ms).sort((a, b) => a - b);
      const families = cases.multiturn.map(t => ({ family: t.id, completedTurns: a.filter(r => r.family === t.id && !r.error).length,
        expectedTurns: t.turns.length, lookBackAfterCorrect: a.some(r => r.family === t.id && r.turnIndex >= t.correctFrom && r.decision?.move === "look_back") }));
      return { mode: selectedMode, attempted: a.length, delivered: a.filter(r => !r.error).length, refused: a.filter(r => r.error).length,
        medianMs: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2 : null,
        knownCostCny: a.reduce((n, r) => n + r.knownCostCny, 0), unknownCostCalls: a.reduce((n, r) => n + r.unknownCostCalls, 0), families,
        t1: null, t2: null, t3: null, hardFailures: null, gradeStatus: "ungraded_not_zero" };
    });
    await save("production-summary.json", { stopped, calls: budget.calls, maxCalls: budget.maxCalls, deadline: new Date(budget.deadline).toISOString(),
      summaries, defaultSwitched: false, eligible: false, reason: "需逐条评分与真机证据，不自动宣布通过" });
    await save("production-blind.json", rows.map(r => ({ id: r.id, caseId: r.caseId, child: r.child, stage: r.stage,
      utterance: r.decision?.utterance ?? null, move: r.decision?.move ?? null, error: r.error })));
    await save("production-grading-template.json", rows.map(r => ({ id: r.id, t1: null, t2: null, t3: null, hard: null, note: "" })));
    console.log(JSON.stringify({ stopped, calls: budget.calls, summaries }));
  } finally { await lock.close(); await fs.unlink(path.join(directory, "production.lock")); }
} else throw Error("modeMustBePrepareOrRun");
