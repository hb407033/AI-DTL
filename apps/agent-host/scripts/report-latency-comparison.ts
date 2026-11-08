// 读取两份回合记录，打印中位数和比例。没有真机记录时不要把输出当成达标结论。
import { readFile } from "node:fs/promises";

type Row = { latencyMs?: number; path?: string; kind?: string; gateReason?: string; utterance?: string; tokens?: number };

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

const [realtimePath, legacyPath] = process.argv.slice(2);
if (!realtimePath || !legacyPath) {
  console.log(JSON.stringify({ ok: false, reason: "needTwoJsonlPaths" }));
  process.exitCode = 1;
} else {
  const read = async (file: string) => (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as Row);
  const realtime = await read(realtimePath);
  const legacy = await read(legacyPath);
  const realtimeLatency = realtime.flatMap(row => typeof row.latencyMs === "number" ? [row.latencyMs] : []);
  const legacyLatency = legacy.flatMap(row => typeof row.latencyMs === "number" ? [row.latencyMs] : []);
  const slow = realtime.filter(row => row.path === "slow").length;
  const realtimeTokens = realtime.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
  const legacyTokens = legacy.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
  console.log(JSON.stringify({
    measured: realtime.length > 0 && legacy.length > 0,
    realtimeMedianMs: median(realtimeLatency),
    legacyMedianMs: median(legacyLatency),
    slowPathShare: realtime.length ? slow / realtime.length : null,
    realtimeTokens, legacyTokens,
    note: "假服务和模拟器不能用来证明这四项真机门槛。",
  }));
}
