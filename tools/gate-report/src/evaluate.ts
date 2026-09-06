// 阶段 0 统一门禁报告：读三份本地结果（教学 / 原生设备 / Codex），分别判定，再按“任一 BLOCKED → BLOCKED，否则任一 FAIL → FAIL，三项全过 → PASS”给总状态。
// 缺任一输入直接退出失败，不生成绿色的部分报告。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { GATE_RULES, METRIC_NAMES, evaluateGate, metricSampleSchema, type MetricName } from "@ai-scholar/gate-contracts";

export type GateStatus = "PASS" | "FAIL" | "BLOCKED";

export const deviceResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  deviceModel: z.string(),
  systemVersion: z.string(),
  appBuild: z.string(),
  transport: z.literal("ws-local"),
  samples: z.array(metricSampleSchema),
  slowMotionSpotChecks: z.array(z.object({ note: z.string(), estimatedMs: z.number() })).optional(),
});

export const codexResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  status: z.enum(["PASS", "FAIL", "BLOCKED"]),
  blockedReason: z.string().optional(),
  codexVersion: z.string(),
  account: z.object({ type: z.string() }).passthrough().optional(),
  trials: z.array(z.object({ index: z.number(), ok: z.boolean(), appendToFirstAudioMs: z.number().optional() }).passthrough()),
  usageAttribution: z.enum(["codex", "unverified", "api", "unknown"]),
}).passthrough();

export const wizardResultSchema = z.object({
  schemaVersion: z.literal(1),
  sessions: z.array(z.object({
    runId: z.string().min(1),
    maxHintLevel: z.number().int().min(0).max(5),
    transferSucceededWithoutHint: z.boolean(),
    childWillingToContinue: z.boolean().nullable().optional(),
  }).passthrough()),
});

export interface MetricFinding {
  metric: MetricName;
  status: GateStatus;
  detail: string;
}

export interface GateResult {
  status: GateStatus;
  reasons: string[];
  failures: MetricFinding[];
  findings: MetricFinding[];
}

export function evaluateDevice(input: unknown): GateResult {
  const device = deviceResultSchema.parse(input);
  const findings: MetricFinding[] = METRIC_NAMES.map((metric) => {
    const samples = device.samples.filter((s) => s.metric === metric);
    const verdict = evaluateGate(samples, metric);
    const rule = GATE_RULES[metric];
    const limit = `阈值 ${rule.p95LimitMs} ms${rule.p50LimitMs ? `（P50 ≤ ${rule.p50LimitMs}）` : ""}`;
    switch (verdict.kind) {
      case "insufficient":
        return { metric, status: "BLOCKED", detail: `样本 ${verdict.have}/${verdict.need}，未测完；${limit}` };
      case "pass":
        return { metric, status: "PASS", detail: `n=${verdict.summary.count} P50 ${verdict.summary.p50Ms.toFixed(1)} P95 ${verdict.summary.p95Ms.toFixed(1)} 成功 ${verdict.summary.successCount}；${limit}` };
      case "fail":
        return { metric, status: "FAIL", detail: `n=${verdict.summary.count} P50 ${verdict.summary.p50Ms.toFixed(1)} P95 ${verdict.summary.p95Ms.toFixed(1)} 成功 ${verdict.summary.successCount}；${limit}；${verdict.reasons.join("，")}` };
    }
  });
  const failures = findings.filter((f) => f.status === "FAIL");
  const blocked = findings.filter((f) => f.status === "BLOCKED");
  const status: GateStatus = blocked.length > 0 ? "BLOCKED" : failures.length > 0 ? "FAIL" : "PASS";
  return { status, reasons: [...blocked, ...failures].map((f) => `${f.metric}: ${f.detail}`), failures, findings };
}

export function evaluateCodex(input: unknown): GateResult {
  const codex = codexResultSchema.parse(input);
  const reasons: string[] = [];
  if (codex.status === "BLOCKED") reasons.push(`探针 BLOCKED：${codex.blockedReason ?? "未说明"}`);
  if (codex.account?.type !== "chatgpt") reasons.push(`账户身份 ${codex.account?.type ?? "未知"}，必须是 chatgpt`);
  if (codex.usageAttribution !== "codex") reasons.push(`用量归属 ${codex.usageAttribution}，必须人工确认为 codex 订阅`);
  if (reasons.length > 0) return { status: "BLOCKED", reasons, failures: [], findings: [] };
  const ok = codex.trials.filter((t) => t.ok).length;
  const need = Math.ceil(codex.trials.length * 0.95);
  if (codex.trials.length === 0 || ok < need) {
    return { status: "FAIL", reasons: [`会话成功 ${ok}/${codex.trials.length}，需要 ≥ ${need}`], failures: [], findings: [] };
  }
  return { status: "PASS", reasons: [`会话成功 ${ok}/${codex.trials.length}`], failures: [], findings: [] };
}

export function evaluateWizard(input: unknown): GateResult {
  const wizard = wizardResultSchema.parse(input);
  const sessions = wizard.sessions;
  if (sessions.length < 3) return { status: "BLOCKED", reasons: [`只有 ${sessions.length} 次可比挑战，需要 3 次`], failures: [], findings: [] };
  if (sessions.some((s) => s.childWillingToContinue === false)) {
    return { status: "BLOCKED", reasons: ["孩子选择停止或家庭时间不足，不算孩子失败"], failures: [], findings: [] };
  }
  const levels = sessions.map((s) => s.maxHintLevel);
  const nonIncreasing = levels.every((level, i) => i === 0 || level <= levels[i - 1]!);
  const anyTransfer = sessions.some((s) => s.transferSucceededWithoutHint);
  const reasons: string[] = [];
  if (!nonIncreasing) reasons.push(`最高提示级别上升：${levels.join(" → ")}`);
  if (!anyTransfer) reasons.push("没有一次无提示迁移成功");
  return reasons.length > 0
    ? { status: "FAIL", reasons, failures: [], findings: [] }
    : { status: "PASS", reasons: [`提示级别 ${levels.join(" → ")}，无提示迁移已出现`], failures: [], findings: [] };
}

export interface FullReport {
  overall: GateStatus;
  wizard: GateResult;
  device: GateResult;
  codex: GateResult;
}

export function evaluateAll(inputs: { wizard: unknown; device: unknown; codex: unknown }): FullReport {
  const wizard = evaluateWizard(inputs.wizard);
  const device = evaluateDevice(inputs.device);
  const codex = evaluateCodex(inputs.codex);
  const statuses = [wizard.status, device.status, codex.status];
  const overall: GateStatus = statuses.includes("BLOCKED") ? "BLOCKED" : statuses.includes("FAIL") ? "FAIL" : "PASS";
  return { overall, wizard, device, codex };
}

export function renderMarkdown(report: FullReport, files: { wizard: string; device: string; codex: string }): string {
  const section = (title: string, result: GateResult, file: string) => {
    const lines = [`## ${title}：${result.status}`, "", `结果文件：\`${file}\``, ""];
    for (const reason of result.reasons) lines.push(`- ${reason}`);
    if (result.findings.length > 0) {
      lines.push("", "| 指标 | 判定 | 明细 |", "|---|---|---|");
      for (const f of result.findings) lines.push(`| ${f.metric} | ${f.status} | ${f.detail}（文件 ${file}） |`);
    }
    return lines.join("\n");
  };
  return [
    `# 阶段 0 门禁报告：${report.overall}`,
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "规则：任一门禁 BLOCKED → 总状态 BLOCKED；否则任一 FAIL → FAIL；三项全 PASS 才 PASS。",
    "",
    section("教学门禁（Wizard-of-Oz）", report.wizard, files.wizard),
    "",
    section("原生设备门禁", report.device, files.device),
    "",
    section("Codex 门禁", report.codex, files.codex),
    "",
  ].join("\n");
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const files = { wizard: argValue("--wizard"), device: argValue("--device"), codex: argValue("--codex") };
  const missing = Object.entries(files).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error(`缺少输入：${missing.join(", ")}。三项门禁结果缺一不可，不生成部分报告。用法：--wizard w.json --device d.json --codex c.json [--out report.md]`);
    process.exit(1);
  }
  const read = async (p: string) => JSON.parse(await readFile(p, "utf8")) as unknown;
  const report = evaluateAll({ wizard: await read(files.wizard!), device: await read(files.device!), codex: await read(files.codex!) });
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const out = argValue("--out") ?? join(repoRoot, "validation", "results", `gate-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderMarkdown(report, { wizard: files.wizard!, device: files.device!, codex: files.codex! }));
  console.log(`总状态：${report.overall}\n报告：${out}`);
  process.exit(report.overall === "PASS" ? 0 : 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
