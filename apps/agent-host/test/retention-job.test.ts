import { expect, test, vi } from "vitest";
import { startRetentionJob } from "../src/retention-job.js";

test("保留期巡检使用注入时钟，关闭后不再触发", () => {
  vi.useFakeTimers();
  try {
    const calls: number[] = [];
    let now = 10;
    const stop = startRetentionJob({ sweepRetention: at => { calls.push(at); }, clock: () => now, intervalMs: 100 });
    expect(calls).toEqual([10]);
    now = 20; vi.advanceTimersByTime(100); expect(calls).toEqual([10, 20]);
    stop(); vi.advanceTimersByTime(100); expect(calls).toEqual([10, 20]);
  } finally { vi.useRealTimers(); }
});

test("巡检失败上报后仍会运行下一次巡检", () => {
  vi.useFakeTimers();
  try {
    let attempts = 0;
    const errors: unknown[] = [];
    const stop = startRetentionJob({ sweepRetention: () => { if (++attempts === 1) throw new Error("busy"); }, clock: () => 10, intervalMs: 100, onError: error => errors.push(error) });
    expect(errors).toHaveLength(1);
    vi.advanceTimersByTime(100); expect(attempts).toBe(2);
    stop();
  } finally { vi.useRealTimers(); }
});
