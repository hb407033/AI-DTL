import { describe, expect, test } from "vitest";
import { GATE_RULES, evaluateGate } from "../src/gate-rules.js";

// 与 Swift 端 GateThresholdsTests 同一张表（计划 §0）；改表两边一起改
describe("门禁规则表", () => {
  test("六项指标与计划 §0 一致", () => {
    expect(GATE_RULES.pen_render_ms).toEqual({ p95LimitMs: 50, minSamples: 100 });
    expect(GATE_RULES.local_interrupt_ms).toEqual({ p95LimitMs: 200, minSamples: 20 });
    expect(GATE_RULES.lan_ack_ms).toEqual({ p95LimitMs: 150, minSamples: 100 });
    expect(GATE_RULES.first_audio_ms).toEqual({ p95LimitMs: 3000, minSamples: 20, p50LimitMs: 1500 });
    expect(GATE_RULES.remote_canvas_ms).toEqual({ p95LimitMs: 300, minSamples: 20 });
    expect(GATE_RULES.reconnect_ms).toEqual({ p95LimitMs: 5000, minSamples: 5 });
  });

  const samples = (metric: keyof typeof GATE_RULES, values: number[]) => values.map((v) => ({ metric, elapsedMs: v, success: true }));

  test("Pencil P95 51ms 失败、50ms 通过", () => {
    expect(evaluateGate(samples("pen_render_ms", Array(100).fill(51))).kind).toBe("fail");
    expect(evaluateGate(samples("pen_render_ms", Array(100).fill(50))).kind).toBe("pass");
  });

  test("本地打断 201ms 失败，LAN 151ms 失败", () => {
    expect(evaluateGate(samples("local_interrupt_ms", Array(20).fill(201))).kind).toBe("fail");
    expect(evaluateGate(samples("lan_ack_ms", Array(100).fill(151))).kind).toBe("fail");
  });

  test("首音频 P95 3001ms 失败；P50 超 1500 即便 P95 达标也失败", () => {
    expect(evaluateGate(samples("first_audio_ms", Array(20).fill(3001))).kind).toBe("fail");
    expect(evaluateGate(samples("first_audio_ms", [...Array(11).fill(1600), ...Array(9).fill(100)])).kind).toBe("fail");
  });

  test("样本不足返回 insufficient 并说明缺口", () => {
    expect(evaluateGate(samples("reconnect_ms", [1000, 1000]))).toEqual({ kind: "insufficient", have: 2, need: 5 });
  });

  test("失败样本（success=false）不算通过：全部超时的 100 次确认判失败", () => {
    const failed = Array(100).fill(0).map(() => ({ metric: "lan_ack_ms" as const, elapsedMs: 5000, success: false }));
    expect(evaluateGate(failed).kind).toBe("fail");
  });
});
