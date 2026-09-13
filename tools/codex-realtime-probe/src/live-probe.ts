// 真实 Codex realtime 探针：以 ChatGPT 登录身份，通过本机 codex app-server 连续开 N 个 realtime 会话，
// 用固定文字或显式确认的成人/合成 WAV，测首个输入 → 首个 outputAudio/delta（Mac 侧诊断，不是 iPad 端到端）。
// 准入：codex 版本与 schema 哈希须与契约一致；OPENAI_API_KEY 不得存在；account 必须是 chatgpt；否则 BLOCKED。
// 阶段 0 所有送入 Codex 的输入只用固定文本或家长/合成音，不用孩子的任何声音与文字。
import { execFile } from "node:child_process";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { summarizeMetrics, type MetricSample } from "@ai-scholar/gate-contracts";
import { AppServerClient } from "./app-server-client.js";
import { parseProbeWav, audioChunks, readAudioFileArgument } from "./audio-input.js";
import { runRealtimeTrial, type TrialInput } from "./realtime-trial.js";
import {
  CODEX_VERSION, V2_SCHEMA_SHA256, REALTIME_METHODS, REALTIME_NOTIFICATIONS,
  getAccountResponseSchema, getAccountRateLimitsResponseSchema, threadStartResponseSchema,
} from "./realtime-contract.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface Trial {
  index: number;
  ok: boolean;
  startToStartedMs?: number;
  appendToFirstAudioMs?: number;
  transcript?: string;
  error?: string;
}

interface ProbeResult {
  schemaVersion: 1;
  scope: "mac-text-first-audio" | "mac-audio-first-audio" | "handshake-only";
  runId: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  blockedReason?: string;
  codexVersion: string;
  v2SchemaSha256: string;
  realtimeConversationFeature: string;
  account?: { type: string; planType?: string; emailMasked?: string | null };
  rateLimitsBefore?: unknown;
  rateLimitsAfter?: unknown;
  voices?: unknown;
  trials: Trial[];
  codexFirstAudioSummary?: ReturnType<typeof summarizeMetrics>;
  usageAttribution: "unverified";
  realtimeNotifications: Array<{ method: string; params: unknown; atMs: number }>;
  notes: string[];
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  return `${(user ?? "").slice(0, 2)}***@${domain ?? ""}`;
}

async function main() {
  const trialsWanted = Number(arg("--trials", "20"));
  const dryRun = process.argv.includes("--dry-run");
  let audioFile = "";
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(repoRoot, "validation", "results", "codex");
  const result: ProbeResult = {
    schemaVersion: 1, runId, status: "BLOCKED", codexVersion: "", v2SchemaSha256: "", realtimeConversationFeature: "",
    scope: dryRun ? "handshake-only" : process.argv.includes("--audio-file") ? "mac-audio-first-audio" : "mac-text-first-audio",
    trials: [], usageAttribution: "unverified", realtimeNotifications: [], notes: [],
  };

  try { audioFile = readAudioFileArgument(process.argv); }
  catch (error) { await finish("BLOCKED", error instanceof Error ? error.message : String(error)); return; }
  if (!Number.isInteger(trialsWanted) || trialsWanted < 1 || trialsWanted > 20) {
    await finish("BLOCKED", "--trials 必须是 1–20 的整数"); return;
  }
  let input: TrialInput = { kind: "text", text: "请只说：你好，我们开始验证。" };
  if (audioFile && !dryRun) {
    if (!process.argv.includes("--confirm-adult-audio")) {
      await finish("BLOCKED", "音频仅限成人/合成固定测试内容，须提供 --confirm-adult-audio；禁止儿童录音"); return;
    }
    try {
      if ((await stat(audioFile)).size > 2_000_000) throw new Error("WAV file too large");
      const pcm = parseProbeWav(await readFile(audioFile));
      input = { kind: "audio", chunks: audioChunks(pcm) };
      result.notes.push(`固定 PCM 输入 ${pcm.length / 48} ms，尾部静音 1500 ms；延迟从首个输入块发送起计，不是说完到首音频或 iPad 指标`);
    } catch (error) { await finish("BLOCKED", `invalid audio input: ${error instanceof Error ? error.message : error}`); return; }
  }
  async function finish(status: ProbeResult["status"], blockedReason?: string) {
    result.status = status;
    if (blockedReason) result.blockedReason = blockedReason;
    await mkdir(outDir, { recursive: true });
    const file = join(outDir, `codex-${runId}.json`);
    await writeFile(file, JSON.stringify(result, null, 2) + "\n");
    console.log(`\n结果：${status}${blockedReason ? `（${blockedReason}）` : ""}\n文件：${file}`);
  };

  // 1. 准入：API key 不得存在
  if (process.env.OPENAI_API_KEY) {
    await finish("BLOCKED", "环境里存在 OPENAI_API_KEY，可能走 API 计费身份");
    return;
  }
  // 2. 准入：版本与 schema 哈希
  const { stdout: snapshotJson } = await execFileAsync("bash", [join(repoRoot, "scripts", "snapshot-codex-schema.sh")]);
  const snapshot = JSON.parse(snapshotJson.trim().split("\n").pop()!) as { codexVersion: string; v2SchemaSha256: string; realtimeConversationFeature: string };
  result.codexVersion = snapshot.codexVersion;
  result.v2SchemaSha256 = snapshot.v2SchemaSha256;
  result.realtimeConversationFeature = snapshot.realtimeConversationFeature;
  if (snapshot.codexVersion !== CODEX_VERSION || snapshot.v2SchemaSha256 !== V2_SCHEMA_SHA256) {
    await finish("BLOCKED", `Codex 版本/schema 与契约不符：本机 ${snapshot.codexVersion} ${snapshot.v2SchemaSha256.slice(0, 8)}…，契约 ${CODEX_VERSION} ${V2_SCHEMA_SHA256.slice(0, 8)}…`);
    return;
  }

  // 3. 握手与身份
  const client = await AppServerClient.spawn({ experimentalApi: true });
  const notifications: Array<{ method: string; params: unknown }> = [];
  const startedAt = performance.now();
  client.onNotification((method, params) => {
    if (!method.startsWith("thread/realtime/")) return;
    notifications.push({ method, params });
    // 音频块只记长度，不把 base64 写进结果文件
    const slim = method === REALTIME_NOTIFICATIONS.outputAudioDelta && typeof params === "object" && params && "audio" in params
      ? { ...(params as object), audio: { ...((params as { audio: { data?: string } }).audio), data: `<${((params as { audio: { data?: string } }).audio.data ?? "").length} chars>` } }
      : params;
    result.realtimeNotifications.push({ method, params: slim, atMs: Math.round(performance.now() - startedAt) });
  });
  try {
    const init = await client.initialize({ name: "ai_scholar_probe", title: "AI-DTL Probe", version: "0.1.0" });
    result.notes.push(`userAgent=${init.userAgent ?? "?"}`);

    const account = getAccountResponseSchema.parse(await client.request("account/read", {}));
    if (!account.account || account.account.type !== "chatgpt") {
      await finish("BLOCKED", `账户身份不是 chatgpt：${account.account?.type ?? "未登录"}`);
      return;
    }
    result.account = { type: "chatgpt", planType: account.account.planType, emailMasked: maskEmail(account.account.email) };
    result.rateLimitsBefore = getAccountRateLimitsResponseSchema.parse(await client.request("account/rateLimits/read", {})).rateLimits ?? null;

    result.voices = await client.request(REALTIME_METHODS.listVoices, {});
    if (dryRun) {
      await finish("BLOCKED", "仅握手检查完成，未启动实时音频，不能判语音门禁通过");
      return;
    }

    // 4. 连续会话
    for (let index = 1; index <= trialsWanted; index++) {
      // 每回合独立线程，上一回合晚到的 closed/audio 不能污染下一回合。
      const thread = threadStartResponseSchema.parse(await client.request("thread/start", { ephemeral: true }, { timeoutMs: 30_000 }));
      const threadId = thread.thread.id;
      const outcome = await runRealtimeTrial(client, threadId, input);
      const trial: Trial = { index, ...outcome };
      result.trials.push(trial);
      console.log(`会话 ${index}/${trialsWanted}: ${trial.ok ? "OK" : "FAIL"} 首音频 ${trial.appendToFirstAudioMs ?? "-"} ms ${trial.error ?? ""}`);
      // 相同鉴权错误不会因重复 20 次而改善，立即结束，不尝试其他身份。
      if (outcome.blocked) break;
    }

    result.rateLimitsAfter = getAccountRateLimitsResponseSchema.parse(await client.request("account/rateLimits/read", {})).rateLimits ?? null;
    const samples: MetricSample[] = result.trials.map((t) => ({ metric: "first_audio_ms", elapsedMs: t.appendToFirstAudioMs ?? 0, success: t.ok }));
    if (samples.length > 0) result.codexFirstAudioSummary = summarizeMetrics(samples);
    const okCount = result.trials.filter((t) => t.ok).length;
    result.notes.push(`realtime 通知种类：${[...new Set(notifications.map((n) => n.method))].join(", ")}`);
    // 鉴权/能力类错误是准入问题，不是性能失败：判 BLOCKED，让报告器不要把它当成"跑了但慢"
    const authBlocked = result.trials.find((t) => t.error && /API key auth|requires .*auth|not (available|enabled)/i.test(t.error));
    if (authBlocked) {
      await finish("BLOCKED", `Codex realtime 拒绝当前身份：${authBlocked.error}`);
      return;
    }
    await finish(okCount >= Math.ceil(trialsWanted * 0.95) ? "PASS" : "FAIL");
  } catch (error) {
    result.notes.push(...client.recentStderr.slice(-10).map((l) => `stderr: ${l}`));
    await finish("BLOCKED", error instanceof Error ? error.message : String(error));
  } finally {
    await client.close();
  }
}

await main();
