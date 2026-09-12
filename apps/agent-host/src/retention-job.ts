/** 时钟由宿主注入；关闭宿主时释放定时器。失败交给宿主日志，不终止后续巡检。 */
export function startRetentionJob(options: { sweepRetention(now: number): void; clock: () => number; intervalMs?: number; onError?: (error: unknown) => void }) {
  const run = () => { try { options.sweepRetention(options.clock()); } catch (error) { options.onError?.(error); } };
  run();
  const timer = setInterval(run, options.intervalMs ?? 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
