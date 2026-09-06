import { describe, expect, test } from "vitest";
import { evaluateAll, evaluateCodex, evaluateDevice, evaluateWizard, renderMarkdown } from "../src/evaluate.js";

const goodDevice = () => ({
  schemaVersion: 1 as const,
  runId: "dev-1",
  deviceModel: "iPad Pro 13-inch (M5)",
  systemVersion: "26.5",
  appBuild: "1",
  transport: "ws-local" as const,
  samples: [
    ...Array(100).fill(0).map(() => ({ metric: "pen_render_ms" as const, elapsedMs: 20, success: true })),
    ...Array(20).fill(0).map(() => ({ metric: "local_interrupt_ms" as const, elapsedMs: 120, success: true })),
    ...Array(100).fill(0).map(() => ({ metric: "lan_ack_ms" as const, elapsedMs: 30, success: true })),
    ...Array(20).fill(0).map(() => ({ metric: "first_audio_ms" as const, elapsedMs: 1200, success: true })),
    ...Array(20).fill(0).map(() => ({ metric: "remote_canvas_ms" as const, elapsedMs: 80, success: true })),
    ...Array(5).fill(0).map(() => ({ metric: "reconnect_ms" as const, elapsedMs: 2500, success: true })),
  ],
});

const goodCodex = () => ({
  schemaVersion: 1 as const,
  runId: "codex-1",
  status: "PASS" as const,
  codexVersion: "0.153.4",
  account: { type: "chatgpt" },
  trials: Array(20).fill(0).map((_, i) => ({ index: i + 1, ok: i !== 3, appendToFirstAudioMs: 900 })),
  usageAttribution: "codex" as const,
});

const goodWizard = () => ({
  schemaVersion: 1 as const,
  sessions: [
    { runId: "w1", maxHintLevel: 3, transferSucceededWithoutHint: false, childWillingToContinue: true },
    { runId: "w2", maxHintLevel: 2, transferSucceededWithoutHint: true, childWillingToContinue: true },
    { runId: "w3", maxHintLevel: 2, transferSucceededWithoutHint: true, childWillingToContinue: true },
  ],
});

describe("三项门禁判定", () => {
  test("设备：六项全过为 PASS，任一失败为 FAIL 并列出失败指标", () => {
    expect(evaluateDevice(goodDevice()).status).toBe("PASS");
    const bad = goodDevice();
    bad.samples = bad.samples.map((s) => (s.metric === "pen_render_ms" ? { ...s, elapsedMs: 51 } : s));
    const verdict = evaluateDevice(bad);
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures.map((f) => f.metric)).toEqual(["pen_render_ms"]);
  });

  test("设备：样本不足为 BLOCKED（没测完不能算失败）", () => {
    const partial = goodDevice();
    partial.samples = partial.samples.filter((s) => s.metric !== "reconnect_ms");
    expect(evaluateDevice(partial).status).toBe("BLOCKED");
  });

  test("Codex：19/20 通过，18/20 失败", () => {
    expect(evaluateCodex(goodCodex()).status).toBe("PASS");
    const worse = goodCodex();
    worse.trials[5]!.ok = false;
    expect(evaluateCodex(worse).status).toBe("FAIL");
  });

  test("Codex：API key 身份 BLOCKED；用量归属未验证 BLOCKED；探针自身 BLOCKED 透传", () => {
    expect(evaluateCodex({ ...goodCodex(), account: { type: "apiKey" } }).status).toBe("BLOCKED");
    expect(evaluateCodex({ ...goodCodex(), usageAttribution: "unverified" }).status).toBe("BLOCKED");
    expect(evaluateCodex({ ...goodCodex(), status: "BLOCKED", blockedReason: "requires API key auth" }).status).toBe("BLOCKED");
  });

  test("教学：三次可比挑战、最高提示级别不升且至少一次无提示迁移为 PASS", () => {
    expect(evaluateWizard(goodWizard()).status).toBe("PASS");
  });

  test("教学：不足三次为 BLOCKED；提示级别上升为 FAIL", () => {
    const short = goodWizard(); short.sessions.pop();
    expect(evaluateWizard(short).status).toBe("BLOCKED");
    const rising = goodWizard(); rising.sessions[2]!.maxHintLevel = 4;
    expect(evaluateWizard(rising).status).toBe("FAIL");
  });

  test("教学：孩子选择停止不算失败，记 BLOCKED", () => {
    const stopped = goodWizard(); stopped.sessions[1]!.childWillingToContinue = false;
    expect(evaluateWizard(stopped).status).toBe("BLOCKED");
  });
});

describe("总状态", () => {
  test("任一 BLOCKED 则 BLOCKED；否则任一 FAIL 则 FAIL；三项全过才 PASS", () => {
    expect(evaluateAll({ wizard: goodWizard(), device: goodDevice(), codex: goodCodex() }).overall).toBe("PASS");
    expect(evaluateAll({ wizard: goodWizard(), device: goodDevice(), codex: { ...goodCodex(), usageAttribution: "unverified" } }).overall).toBe("BLOCKED");
    const badDevice = goodDevice();
    badDevice.samples = badDevice.samples.map((s) => (s.metric === "lan_ack_ms" ? { ...s, elapsedMs: 151 } : s));
    expect(evaluateAll({ wizard: goodWizard(), device: badDevice, codex: goodCodex() }).overall).toBe("FAIL");
  });

  test("Markdown 报告写明失败指标的样本数、P50/P95、阈值与结果文件", () => {
    const badDevice = goodDevice();
    badDevice.samples = badDevice.samples.map((s) => (s.metric === "lan_ack_ms" ? { ...s, elapsedMs: 151 } : s));
    const report = evaluateAll({ wizard: goodWizard(), device: badDevice, codex: goodCodex() });
    const md = renderMarkdown(report, { wizard: "w.json", device: "d.json", codex: "c.json" });
    expect(md).toContain("lan_ack_ms");
    expect(md).toContain("n=100");
    expect(md).toContain("P95 151.0");
    expect(md).toContain("阈值 150");
    expect(md).toContain("d.json");
  });
});

describe("Codex 门禁的诊断信息", () => {
  test("BLOCKED/FAIL 时把探针状态与会话错误原文列进原因，不吞掉", () => {
    const result = evaluateCodex({
      schemaVersion: 1, runId: "c", status: "FAIL", codexVersion: "0.153.4", account: { type: "chatgpt" }, usageAttribution: "unverified",
      trials: [{ index: 1, ok: false, error: "realtime error（start 阶段）: realtime conversation requires API key auth" }],
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.reasons.join("\n")).toContain("探针状态：FAIL");
    expect(result.reasons.join("\n")).toContain("requires API key auth");
  });
});
