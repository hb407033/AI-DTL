import { expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  freezeFailedInputs, buildTrajectoryInput, appendDeliveredTurn,
  createRepairBudget, reserveRepairCall, continuitySummary, assertPrivateDirectory,
  type ArchivedResult,
} from "../scripts/teaching-continuity-repair-probe-core.js";
import type { TeachingInput, TeachingDecision } from "../src/ai/workspace-teaching-decision.js";
import { claimRepairRun, prepareRepairProbe, runRepairProbe, followupRepairProbe } from "../scripts/probe-teaching-continuity-repair.js";
import type { requestWorkspaceText } from "../src/ai/qwen-workspace-session.js";

const base = (): TeachingInput => ({
  record: { sessionId: "session", problem: { problemId: "problem", statement: { text: "原题", revision: 0 },
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } },
    board: { revision: 0 }, submissions: [{ explanation: "旧孩子" }], feedback: [{ summary: "旧老师" }] },
  turnId: "original-turn", responseId: "original-response", child: "最初", history: [], imageId: "image", permission: "review",
} as unknown as TeachingInput);
const decision = (child: string, index: number): TeachingDecision => ({ child, turnId: `t${index}`, responseId: `r${index}`,
  utterance: `真实老师${index}`, evidenceIds: [`t${index}`], resolved: [], move: "justify", focus: "verify",
  problemId: "problem", problemRevision: 0, observation: "孩子原话", method: "ordinary", handoff: false });
function archive() {
  const trajectory = { id: "divide", baseId: "base", problem: "题目54除6", correctFrom: 2, turns: ["孩子0", "孩子1", "孩子2", "未来孩子"] };
  const cases = { initial: [{ id: "base", input: base(), imageBase64: Buffer.from("photo").toString("base64") }], multiturn: [trajectory] };
  const rows: ArchivedResult[] = [
    { id: "initial-failed", caseId: "base", stage: "initial", mode: "thinking", child: "最初", error: "decisionNeedsReview", decision: null },
    { id: "old0", caseId: "divide-0", family: "divide", stage: "multiturn", mode: "realtime", turnIndex: 0, child: "孩子0", error: null, decision: decision("孩子0", 0) },
    { id: "other-mode", caseId: "divide-0", family: "divide", stage: "multiturn", mode: "thinking", turnIndex: 0, child: "别的模式孩子", error: null, decision: decision("别的模式孩子", 0) },
    { id: "old1", caseId: "divide-1", family: "divide", stage: "multiturn", mode: "realtime", turnIndex: 1, child: "孩子1", error: null, decision: decision("孩子1", 1) },
    { id: "multi-failed", caseId: "divide-2", family: "divide", stage: "multiturn", mode: "realtime", turnIndex: 2, child: "孩子2", error: "timeout", decision: null },
    { id: "future", caseId: "divide-3", family: "divide", stage: "multiturn", mode: "realtime", turnIndex: 3, child: "未来孩子", error: null, decision: decision("未来孩子", 3) },
  ];
  return { cases, rows, calls: [{ resultId: "multi-failed", kind: "review", raw: '{"allowed":false,"reason":"math_error"}' }] };
}

test("冻结原始失败输入不改动；多轮只重建同family/mode失败前实际交付前缀", () => {
  const { cases, rows, calls } = archive();
  const before = JSON.stringify({ cases, rows, calls });
  const frozen = freezeFailedInputs(cases as any, rows, calls, 2);
  expect(frozen).toHaveLength(2);
  expect(frozen[0]!.input).toEqual(cases.initial[0]!.input);
  const multi = frozen[1]!;
  expect(multi.input.history.map(h => h.utterance)).toEqual(["真实老师0", "真实老师1"]);
  expect(multi.input.record.submissions.map(s => s.explanation)).toEqual(["孩子0", "孩子1", "孩子2"]);
  expect(multi.input.record.feedback.map(f => f.summary)).toEqual(["真实老师0", "真实老师1"]);
  expect(JSON.stringify(multi.input)).not.toMatch(/未来孩子|别的模式孩子|旧孩子|旧老师/);
  expect(multi.originalFailure).toEqual(rows[4]);
  expect(multi.originalCalls).toEqual(calls);
  expect(multi.input.turnId).not.toBe("original-turn");
  expect(multi.provenance.idsReconstructed).toBe(true);
  expect(multi.imageHash).toHaveLength(64);
  expect(freezeFailedInputs(cases as any, rows, calls, 2)).toEqual(frozen);
  expect(JSON.stringify({ cases, rows, calls })).toBe(before);
});

test("生产provider复核拒绝会修复再复核；拒绝后的raw不能被算成交付，真实老师仅来自门禁通过", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "continuity-run-test-"));
  vi.stubEnv("DASHSCOPE_API_KEY", "test-runtime-key");
  vi.stubEnv("AI_DTL_QWEN_WORKSPACE_ID", "test-workspace");
  vi.stubEnv("AI_DTL_DECISION_MODE", "realtime");
  const output = path.join(temporary, "prepared"), source = path.join(temporary, "archive");
  const host = path.resolve(import.meta.dirname, "..");
  try {
    await fs.mkdir(source);
    const fixture = { id: "base", input: base(), imageBase64: Buffer.from("photo").toString("base64") };
    const trajectories = Array.from({ length: 5 }, (_, i) => ({ id: `family${i}`, baseId: "base", problem: "未解析题", correctFrom: 3,
      turns: Array.from({ length: 6 }, (_, j) => `族${i}孩子${j}`) }));
    const cases = { initial: [fixture], multiturn: trajectories };
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: `failure${i}`, caseId: "base", stage: "initial", mode: "realtime", child: "最初", error: "decisionNeedsReview", decision: null }));
    await fs.writeFile(path.join(source, "production-cases.json"), JSON.stringify(cases));
    await fs.writeFile(path.join(source, "production-results.jsonl"), rows.map(r => JSON.stringify(r)).join("\n"));
    await fs.writeFile(path.join(source, "production-calls.jsonl"), "");
    await fs.writeFile(path.join(source, "production-manifest.json"), "{}");
    await prepareRepairProbe(output, source, host);
    let modelCalls = 0;
    const transport: typeof requestWorkspaceText = async (_config, prompt, _image, _signal, context) => {
      modelCalls++;
      if (prompt.startsWith("你是独立的抢答复核器")) {
        const facts = JSON.parse(prompt.split("\n").at(-1)!);
        return JSON.stringify({ allowed: facts.child !== "族0孩子1", reason: facts.child === "族0孩子1" ? "math_error" : "none" });
      }
      return JSON.stringify({ analysis: "仅用于隔离探针测试", focus: "verify", move: "justify", observation: "孩子本轮原话",
        evidenceIds: [context!.turnId], utterance: "先承接你刚才这一步。", method: "ordinary", handoff: false });
    };
    const summary = await runRepairProbe(output, host, transport);
    expect(summary).toMatchObject({ status: "incomplete", attempted: 35, delivered: 34, failed: 1, uncovered: 4,
      estimatedTotalCostCny: null, passed: false });
    expect(summary.families[0]).toMatchObject({ stoppedAtTurn: 1, uncoveredTurns: [2, 3, 4, 5] });
    expect(summary.families[1]).toMatchObject({ completedTurns: 6 });
    const calls = (await fs.readFile(path.join(output, "repair-calls.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const results = (await fs.readFile(path.join(output, "repair-results.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const refused = results.find(r => r.caseId === "family0-1");
    expect(refused).toMatchObject({ decision: null, error: "decisionNeedsReview", subcalls: 4 });
    expect(calls.filter(c => c.resultId === refused.id).map(c => c.kind)).toEqual(["draft", "review", "repair", "review"]);
    expect(refused.rawFinalJson).toContain("先承接你刚才这一步");
    expect(modelCalls).toBe(calls.length);
    expect(summary.unknownCostCalls).toBe(calls.length);
    expect(summary.calls).toBe(72);
    const nextInputFile = results.find(r => r.caseId === "family1-1").id;
    const nextInput = JSON.parse(await fs.readFile(path.join(output, `input-${nextInputFile}.json`), "utf8"));
    expect(nextInput.input.history[0].utterance).toBe("先承接你刚才这一步。");
    expect(nextInput.input.record.submissions).toHaveLength(2);
    await expect(runRepairProbe(output, host, transport)).rejects.toThrow();
    expect(modelCalls).toBe(72);

    const limitedOutput = path.join(temporary, "cost-limited");
    await prepareRepairProbe(limitedOutput, source, host);
    let limitedCalls = 0;
    const expensive: typeof requestWorkspaceText = async (cfg, prompt, image, signal, context) => {
      limitedCalls++;
      context!.onUsage!({ sessionId: context!.sessionId, turnId: context!.turnId, callId: "cost-call",
        purpose: "decision", model: "qwen3.8-omni-flash-realtime", status: "completed",
        usage: { input_tokens: 1400000, output_tokens: 0 }, estimatedCostCny: null });
      return transport(cfg, prompt, image, signal, context);
    };
    const limited = await runRepairProbe(limitedOutput, host, expensive);
    expect(limited).toMatchObject({ status: "blocked", blockedReason: "costBudget", calls: 1,
      attempted: 1, delivered: 0, failed: 1, uncovered: 38, knownCostCny: 2.1, passed: false });
    expect(limitedCalls).toBe(1);
  } finally { vi.unstubAllEnvs(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test("丢失前缀、重复档案或失败数不匹配必须停止，不能缩减失败样本", () => {
  const { cases, rows, calls } = archive();
  expect(() => freezeFailedInputs(cases as any, rows, calls)).toThrow("nineActualFailuresRequired");
  expect(() => freezeFailedInputs(cases as any, rows.filter(r => r.id !== "old1"), calls, 2)).toThrow("missingDeliveredPrefix");
  expect(() => freezeFailedInputs(cases as any, [...rows, rows[1]!], calls, 2)).toThrow("ambiguousDeliveredPrefix");
});

test("连续会话只追加已交付老师，输入为独立快照，求助权限沿用生产策略", () => {
  const { cases } = archive();
  const f = cases.initial[0]!;
  const trajectory = cases.multiturn[0]!;
  trajectory.turns[1] = "我还是不会，给我一个小动作";
  const history: TeachingDecision[] = [];
  const first = buildTrajectoryInput(f as any, trajectory, 0, history, "live");
  const saved = JSON.stringify(first);
  const d = { ...decision(first.child, 0), turnId: first.turnId, responseId: first.responseId };
  appendDeliveredTurn(history, d);
  const second = buildTrajectoryInput(f as any, trajectory, 1, history, "live");
  expect(second.permission).toBe("hint");
  expect(second.history).toEqual([d]);
  expect(second.record.submissions).toHaveLength(2);
  expect(second.record.feedback[0]!.summary).toBe(d.utterance);
  expect(JSON.stringify(first)).toBe(saved);
  expect(() => buildTrajectoryInput(f as any, trajectory, 2, history, "live")).toThrow("missingDeliveredPrefix");
});

test("统一预算从run起算30分钟，draft/review/repair都共享120次及2元上限", () => {
  const budget = createRepairBudget(1000);
  expect(budget).toEqual({ calls: 0, maxCalls: 120, deadline: 1801000, knownCostCny: 0, costLimitCny: 2 });
  for (let n = 0; n < 120; n++) reserveRepairCall(budget, 1001);
  expect(() => reserveRepairCall(budget, 1002)).toThrow("callBudget");
  expect(() => reserveRepairCall({ ...budget, calls: 0 }, 1801000)).toThrow("deadline");
  expect(() => reserveRepairCall({ ...budget, calls: 0, knownCostCny: 2 }, 1002)).toThrow("costBudget");
});

test("未交付终止该轨迹且后续标记未覆盖，预算阻塞不能报告零失败或自动验收", () => {
  const { cases } = archive();
  const frozen = [{ id: "replay" }] as any;
  const rows = [
    { caseId: "replay", stage: "replay", decision: null, error: "decisionNeedsReview" },
    { caseId: "divide-0", stage: "multiturn", family: "divide", turnIndex: 0, decision: decision("孩子0", 0), error: null },
    { caseId: "divide-1", stage: "multiturn", family: "divide", turnIndex: 1, decision: null, error: "callBudget" },
  ];
  const summary = continuitySummary(frozen, cases.multiturn, rows as any, "callBudget");
  expect(summary).toMatchObject({ status: "blocked", expected: 5, attempted: 3, delivered: 1, failed: 2, uncovered: 2, passed: false, hardFailures: null });
  expect(summary.families[0]).toMatchObject({ completedTurns: 1, expectedTurns: 4, stoppedAtTurn: 1, uncoveredTurns: [2, 3] });
  const empty = continuitySummary(frozen, cases.multiturn, [], null);
  expect(empty).toMatchObject({ status: "incomplete", uncovered: 5, hardFailures: null, passed: false });
});

test("prepare/run只接受私有绝对目录，拒绝相对路径、源码目录及原始档案覆盖", () => {
  expect(() => assertPrivateDirectory("relative", "/private/archive", "/private/repo")).toThrow("absolutePrivateOutputRequired");
  expect(() => assertPrivateDirectory("/private/archive/output", "/private/archive", "/private/repo")).toThrow("sourceOutputOverlap");
  expect(() => assertPrivateDirectory("/private/repo/output", "/private/archive", "/private/repo")).toThrow("outputInsideRepository");
  expect(() => assertPrivateDirectory("/private/results", "/private/archive", "/private/repo")).not.toThrow();
});

test("prepare冻结9条原失败及五族六轮，私有目录只建一次，运行永久标记禁止重跑", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "continuity-probe-test-"));
  try {
    const source = path.join(temporary, "source"), output = path.join(temporary, "prepared"), host = path.join(temporary, "repository", "apps", "agent-host");
    await fs.mkdir(source);
    const fixture = { id: "base", input: base(), imageBase64: Buffer.from("photo").toString("base64") };
    const cases = { initial: [fixture], multiturn: Array.from({ length: 5 }, (_, i) => ({ id: `family${i}`, baseId: "base", problem: "题", correctFrom: 3, turns: Array.from({ length: 6 }, (_, j) => `孩子${j}`) })) };
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: `failure${i}`, caseId: "base", stage: "initial", mode: "realtime", child: "最初", error: "decisionNeedsReview", decision: null }));
    const files = { "production-cases.json": JSON.stringify(cases), "production-results.jsonl": rows.map(r => JSON.stringify(r)).join("\n"),
      "production-calls.jsonl": "", "production-manifest.json": JSON.stringify({ schemaVersion: 1 }) };
    for (const [file, contents] of Object.entries(files)) await fs.writeFile(path.join(source, file), contents);
    const manifest = await prepareRepairProbe(output, source, host);
    expect(manifest).toMatchObject({ replayCases: 9, continuousFamilies: 5, continuousTurns: 30, modes: ["realtime"] });
    expect((await fs.stat(output)).mode & 0o077).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(output, "repair-cases.json"), "utf8")).replay).toHaveLength(9);
    await expect(prepareRepairProbe(output, source, host)).rejects.toThrow();
    await claimRepairRun(output);
    await expect(claimRepairRun(output)).rejects.toThrow();
    for (const [file, contents] of Object.entries(files)) expect(await fs.readFile(path.join(source, file), "utf8")).toBe(contents);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("followup只补已完成父批次的实际失败，两条replay原快照加失败family六轮，共用77起算预算及deadline", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "continuity-followup-test-"));
  vi.stubEnv("DASHSCOPE_API_KEY", "test-runtime-key");
  vi.stubEnv("AI_DTL_QWEN_WORKSPACE_ID", "test-workspace");
  vi.stubEnv("AI_DTL_DECISION_MODE", "realtime");
  const parent = path.join(temporary, "parent"), child = path.join(parent, "followup"), host = path.resolve(import.meta.dirname, "..");
  try {
    await fs.mkdir(parent, { mode: 0o700 });
    const fixture = { id: "base", input: base(), imageBase64: Buffer.from("photo").toString("base64") };
    const originalFailures = Array.from({ length: 9 }, (_, i) => ({ id: `failure${i}`, caseId: "base", stage: "initial", mode: "realtime", child: "最初", error: "decisionNeedsReview", decision: null }));
    const replay = freezeFailedInputs({ initial: [fixture], multiturn: [] }, originalFailures, []);
    const continuous = Array.from({ length: 5 }, (_, i) => ({ fixture, trajectory: { id: `family${i}`, baseId: "base", problem: "未解析题", correctFrom: 3,
      turns: Array.from({ length: 6 }, (_, j) => `族${i}孩子${j}`) } }));
    const frozen = { replay, continuous };
    const rows = replay.map((f, i) => ({ id: `parent-replay${i}`, caseId: f.id, stage: "replay", inputHash: f.inputHash, imageHash: f.imageHash,
      decision: i < 2 ? null : decision("最初", 0), error: i < 2 ? "decisionNeedsReview" : null }));
    const parentRows: unknown[] = [...rows];
    for (let family = 0; family < 5; family++) for (let turn = 0; turn < (family === 0 ? 3 : 6); turn++) parentRows.push({
      id: `parent-family${family}-${turn}`, caseId: `family${family}-${turn}`, stage: "multiturn", family: `family${family}`, turnIndex: turn,
      decision: family === 0 && turn === 2 ? null : decision(`族${family}孩子${turn}`, turn), error: family === 0 && turn === 2 ? "decisionNeedsReview" : null,
    });
    const budget = { ...createRepairBudget(Date.now()), calls: 77, knownCostCny: 0.2318625 };
    const protectedFiles = { "repair-cases.json": JSON.stringify(frozen), "repair-results.jsonl": parentRows.map(r => JSON.stringify(r)).join("\n"),
      "repair-summary.json": JSON.stringify({ status: "incomplete", attempted: 36, delivered: 33, failed: 3, uncovered: 3, calls: 77 }),
      "repair-manifest.json": JSON.stringify({ sourceDirectory: path.join(temporary, "archive"), casesHash: (await import("../scripts/teaching-continuity-repair-probe-core.js")).sha256(JSON.stringify(frozen)) }),
      "repair-run-version.json": JSON.stringify({ sources: { "src/provider.ts": "old-version" } }), "repair-run-started.json": "{}" };
    for (const [file, text] of Object.entries(protectedFiles)) await fs.writeFile(path.join(parent, file), text, { mode: 0o600 });
    await fs.writeFile(path.join(parent, "repair-ledger.json"), JSON.stringify(budget), { mode: 0o600 });
    for (let i = 0; i < 2; i++) await fs.writeFile(path.join(parent, `input-parent-replay${i}.json`), JSON.stringify({ input: replay[i]!.input,
      inputHash: replay[i]!.inputHash, imageBase64: fixture.imageBase64, imageHash: replay[i]!.imageHash }), { mode: 0o600 });
    let calls = 0;
    const transport: typeof requestWorkspaceText = async (_cfg, prompt, _image, _signal, context) => {
      calls++;
      const parentLedger = JSON.parse(await fs.readFile(path.join(parent, "repair-ledger.json"), "utf8"));
      const childLedger = JSON.parse(await fs.readFile(path.join(child, "repair-ledger.json"), "utf8"));
      expect(parentLedger).toEqual(childLedger);
      expect(parentLedger.calls).toBe(77 + calls);
      expect(parentLedger.deadline).toBe(budget.deadline);
      if (prompt.startsWith("你是独立的抢答复核器")) return '{"allowed":true,"reason":"none"}';
      return JSON.stringify({ focus: "verify", observation: "孩子本轮原话", evidenceIds: [context!.turnId],
        utterance: "先承接你刚才这一步。", method: "ordinary", handoff: false });
    };
    const summary = await followupRepairProbe(parent, child, host, transport);
    expect(summary).toMatchObject({ expected: 8, attempted: 8, delivered: 8, failed: 0, uncovered: 0,
      calls: 93, followupCalls: 16, knownCostCny: budget.knownCostCny, originalCohortPassed: false, differentSourceVersions: true, passed: false });
    const childFrozen = JSON.parse(await fs.readFile(path.join(child, "repair-cases.json"), "utf8"));
    expect(childFrozen.replay.map((f: any) => f.input)).toEqual(replay.slice(0, 2).map(f => f.input));
    expect(childFrozen.continuous.map((c: any) => c.trajectory.id)).toEqual(["family0"]);
    const finalLedger = JSON.parse(await fs.readFile(path.join(parent, "repair-ledger.json"), "utf8"));
    expect(finalLedger).toMatchObject({ calls: 93, deadline: budget.deadline, knownCostCny: budget.knownCostCny });
    for (const [file, text] of Object.entries(protectedFiles)) expect(await fs.readFile(path.join(parent, file), "utf8")).toBe(text);
    await expect(followupRepairProbe(parent, path.join(temporary, "second-followup"), host, transport)).rejects.toThrow();
    expect(calls).toBe(16);
  } finally { vi.unstubAllEnvs(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test("followup拒绝未完成父批次，不创建运行标记或发生传输", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "continuity-unfinished-test-"));
  const parent = path.join(temporary, "parent");
  await fs.mkdir(parent, { mode: 0o700 });
  try {
    await expect(followupRepairProbe(parent, path.join(temporary, "child"))).rejects.toThrow("parentNotCompleted");
    expect(await fs.readdir(parent)).toEqual([]);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("grandchild tail保留四轮真实history，只验末两轮；root预算108起算且三处账本不重置", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "continuity-grandchild-test-"));
  vi.stubEnv("DASHSCOPE_API_KEY", "test-runtime-key"); vi.stubEnv("AI_DTL_QWEN_WORKSPACE_ID", "test-workspace"); vi.stubEnv("AI_DTL_DECISION_MODE", "realtime");
  const root = path.join(temporary, "root"), parent = path.join(temporary, "parent"), output = path.join(temporary, "final"), host = path.resolve(import.meta.dirname, "..");
  try {
    await fs.mkdir(root, { mode: 0o700 }); await fs.mkdir(parent, { mode: 0o700 });
    const budget = { ...createRepairBudget(Date.now()), calls: 108, knownCostCny: 0.2640705 };
    const fixture = { id: "base", input: base(), imageBase64: Buffer.from("photo").toString("base64") };
    const frozen = { replay: [], continuous: [{ fixture, trajectory: { id: "planting", baseId: "base", problem: "未解析题", correctFrom: 3,
      turns: Array.from({ length: 6 }, (_, i) => `孩子${i}`) } }] };
    const { sha256 } = await import("../scripts/teaching-continuity-repair-probe-core.js");
    const prefix = Array.from({ length: 4 }, (_, i) => decision(`孩子${i}`, i));
    const input = buildTrajectoryInput(fixture, frozen.continuous[0]!.trajectory, 4, prefix, "actual-parent-input");
    const inputHash = sha256(JSON.stringify(input)), imageHash = sha256(Buffer.from(fixture.imageBase64, "base64"));
    const protectedFiles = { "repair-cases.json": JSON.stringify(frozen), "repair-summary.json": JSON.stringify({ attempted: 1, delivered: 0, failed: 1, calls: 108 }),
      "repair-results.jsonl": JSON.stringify({ id: "planting-failed", caseId: "planting-4", stage: "multiturn", family: "planting", turnIndex: 4, inputHash, imageHash, decision: null, error: "latestEvidenceRequired" }),
      "input-planting-failed.json": JSON.stringify({ input, inputHash, imageHash, imageBase64: fixture.imageBase64 }),
      "repair-manifest.json": JSON.stringify({ parentDirectory: root, sourceDirectory: path.join(temporary, "archive"), casesHash: sha256(JSON.stringify(frozen)) }),
      "repair-run-version.json": "{}", "repair-run-started.json": "{}" };
    for (const [file, text] of Object.entries(protectedFiles)) await fs.writeFile(path.join(parent, file), text, { mode: 0o600 });
    await fs.writeFile(path.join(root, "repair-manifest.json"), "{}", { mode: 0o600 });
    await fs.writeFile(path.join(root, "repair-followup-started.json"), JSON.stringify({ output: parent }), { mode: 0o600 });
    for (const directory of [root, parent]) await fs.writeFile(path.join(directory, "repair-ledger.json"), JSON.stringify(budget), { mode: 0o600 });
    let calls = 0;
    const transport: typeof requestWorkspaceText = async (_cfg, prompt, _image, _signal, context) => {
      calls++;
      const ledgers = await Promise.all([root, parent, output].map(async directory => JSON.parse(await fs.readFile(path.join(directory, "repair-ledger.json"), "utf8"))));
      expect(ledgers[0]).toEqual(ledgers[1]); expect(ledgers[1]).toEqual(ledgers[2]);
      expect(ledgers[0]).toMatchObject({ calls: 108 + calls, knownCostCny: budget.knownCostCny, deadline: budget.deadline });
      if (prompt.startsWith("你是独立的抢答复核器")) return '{"allowed":true,"reason":"none"}';
      return JSON.stringify({ focus: "verify", observation: "本轮孩子原话", evidenceIds: [context!.turnId], utterance: "先承接你刚才这一步。", method: "ordinary", handoff: false });
    };
    const summary = await followupRepairProbe(parent, output, host, transport, true);
    expect(summary).toMatchObject({ expected: 2, delivered: 2, calls: 112, followupCalls: 4, retainedPrefix: 4,
      scope: "failed_tail_with_retained_delivered_prefix",
      budgetOwnerDirectory: root, differentSourceVersions: true, originalCohortPassed: false });
    const actualRows = (await fs.readFile(path.join(output, "repair-results.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(actualRows.map(r => r.turnIndex)).toEqual([4, 5]);
    const actualInputs = await Promise.all(actualRows.map(async r => JSON.parse(await fs.readFile(path.join(output, `input-${r.id}.json`), "utf8"))));
    expect(actualInputs[0].input).toEqual(input); expect(actualInputs[0].inputHash).toBe(inputHash);
    expect(actualInputs[1].input.history.slice(0, 4)).toEqual(prefix);
    expect(actualInputs[1].input.history[4].utterance).toBe("先承接你刚才这一步。");
    for (const directory of [root, parent, output]) expect(JSON.parse(await fs.readFile(path.join(directory, "repair-ledger.json"), "utf8")))
      .toMatchObject({ calls: 112, knownCostCny: budget.knownCostCny, deadline: budget.deadline });
    for (const [file, text] of Object.entries(protectedFiles)) expect(await fs.readFile(path.join(parent, file), "utf8")).toBe(text);
  } finally { vi.unstubAllEnvs(); await fs.rm(temporary, { recursive: true, force: true }); }
});
