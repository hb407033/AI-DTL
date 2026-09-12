import type { ThreadRealtimeAudioChunk } from "./realtime-contract.js";
import { REALTIME_METHODS as M, REALTIME_NOTIFICATIONS as N, realtimeStartedSchema, outputAudioDeltaSchema, realtimeErrorSchema } from "./realtime-contract.js";
export interface TrialClient {
  request(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
  onNotification(listener: (method: string, params: unknown) => void): () => void;
}
export type TrialInput = { kind: "text"; text: string } | { kind: "audio"; chunks: ThreadRealtimeAudioChunk[] };
export interface TrialResult { ok: boolean; blocked: boolean; startToStartedMs?: number; appendToFirstAudioMs?: number; error?: string }
export async function runRealtimeTrial(client: TrialClient, threadId: string, input: TrialInput,
  options: { timeoutMs?: number; overallTimeoutMs?: number; pause?: (ms: number) => Promise<void> } = {}): Promise<TrialResult> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const deadline = performance.now() + (options.overallTimeoutMs ?? 90000);
  const remaining = () => {
    const ms = deadline - performance.now();
    if (ms <= 0) throw new Error("realtime trial deadline exceeded");
    return Math.min(timeoutMs, ms);
  };
  const pause = options.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const result: TrialResult = { ok: false, blocked: false };
  let started = false, inputStarted = false, stopping = false, firstAudioAt: number | undefined, fatal: Error | undefined;
  const checks = new Set<() => void>();
  const unsubscribe = client.onNotification((method, params) => {
    if (!params || typeof params !== "object" || !("threadId" in params) || params.threadId !== threadId) return;
    try {
      if (method === N.started) { realtimeStartedSchema.parse(params); started = true; }
      if (method === N.error) fatal = new Error(realtimeErrorSchema.parse(params).message);
      if (method === N.closed && !stopping) fatal = new Error("realtime closed before trial completed");
      if (method === N.outputAudioDelta && inputStarted) {
        const audio = outputAudioDeltaSchema.parse(params).audio;
        const bytes = Buffer.from(audio.data, "base64");
        if (!Number.isInteger(audio.sampleRate) || audio.sampleRate <= 0 || !Number.isInteger(audio.numChannels) || audio.numChannels <= 0 ||
          !bytes.length || bytes.length > 1_000_000 || bytes.toString("base64") !== audio.data || bytes.length % (2 * audio.numChannels) !== 0 ||
          (audio.samplesPerChannel != null && audio.samplesPerChannel !== bytes.length / (2 * audio.numChannels))) throw new Error("invalid PCM audio");
        firstAudioAt ??= performance.now();
      }
    } catch { fatal = new Error("invalid realtime notification"); }
    for (const check of checks) check();
  });
  // 先订阅再请求；通知可以早于 RPC ack，且只归属于本线程。本回合结束即清理。
  const waitUntil = (predicate: () => boolean, label: string) => new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); checks.delete(check); error ? reject(error) : resolve(); };
    const check = () => { if (fatal) finish(fatal); else if (predicate()) finish(); };
    const timer = setTimeout(() => finish(new Error(`${label} timeout/deadline`)), remaining());
    checks.add(check); check();
  });
  const assertHealthy = () => { if (fatal) throw fatal; remaining(); };
  try {
    const t0 = performance.now();
    await client.request(M.start, { threadId, outputModality: "audio", transport: { type: "websocket" } }, { timeoutMs: remaining() });
    await waitUntil(() => started, "started");
    result.startToStartedMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    inputStarted = true;
    if (input.kind === "text") {
      await client.request(M.appendText, { threadId, text: input.text }, { timeoutMs: remaining() });
    } else {
      if (!input.chunks.length) throw new Error("empty audio input");
      for (const audio of input.chunks) {
        assertHealthy();
        await client.request(M.appendAudio, { threadId, audio }, { timeoutMs: remaining() });
        await pause(1000 * (audio.samplesPerChannel ?? 0) / audio.sampleRate);
      }
    }
    await waitUntil(() => firstAudioAt !== undefined, "first audio");
    result.appendToFirstAudioMs = Math.round(firstAudioAt! - t1);
    result.ok = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.blocked = /API key auth|requires .*auth|not (available|enabled)/i.test(result.error);
  } finally {
    stopping = true;
    try { await client.request(M.stop, { threadId }, { timeoutMs: Math.min(timeoutMs, 5000) }); if (result.ok) assertHealthy(); }
    catch (error) { result.ok = false; result.error = `${result.error ?? ""} | stop: ${error instanceof Error ? error.message : error}`; }
    finally { unsubscribe(); }
  }
  return result;
}
