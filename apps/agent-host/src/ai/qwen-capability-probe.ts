// Qwen Omni 能力门禁探针（2026-09-17 批准设计的「协议能力前置验证」）：
// 用合成成人文本验证三件事并保存协议证据（不含密钥）：
//  1) 工具调用：session.update 注册白名单图形工具后，模型是否发出结构化 function_call 事件；
//  2) 结果回传：function_call_output 回传后模型能否继续回答；
//  3) 取消：response.cancel 是否真正终止生成（response.done 状态与取消后音频增量）。
// 结论只回答「当前型号与接口是否支持可靠工具动作」，不支持时如实报告，不换模型、不伪造。
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { loadQwenConfig } from "./config.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const HINT_TOOL = {
  type: "function",
  name: "show_fraction_hint",
  description: "在孩子的白板上展示一个只读分数提示矩形。rows/columns 为正整数且乘积不超过 60，shadedCells 为从 0 开始的行优先格子索引。",
  parameters: {
    type: "object",
    properties: {
      wholeGroupId: { type: "string" },
      rows: { type: "integer", minimum: 1 },
      columns: { type: "integer", minimum: 1 },
      shadedCells: { type: "array", items: { type: "integer", minimum: 0 } },
    },
    required: ["wholeGroupId", "rows", "columns", "shadedCells"],
    additionalProperties: false,
  },
};

interface StepResult {
  ok: boolean;
  detail: string;
  events: string[];
}

function validateToolArguments(raw: string): { ok: boolean; detail: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, detail: "arguments 不是合法 JSON" }; }
  const p = parsed as Record<string, unknown>;
  const rows = p.rows, columns = p.columns, cells = p.shadedCells;
  if (typeof p.wholeGroupId !== "string" || !p.wholeGroupId) return { ok: false, detail: "缺 wholeGroupId" };
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || (rows as number) < 1 || (columns as number) < 1) {
    return { ok: false, detail: "rows/columns 非正整数" };
  }
  if ((rows as number) * (columns as number) > 60) return { ok: false, detail: "乘积超过 60" };
  if (!Array.isArray(cells) || cells.some((c) => !Number.isInteger(c) || (c as number) < 0 || (c as number) >= (rows as number) * (columns as number))) {
    return { ok: false, detail: "shadedCells 越界或非整数" };
  }
  if (new Set(cells).size !== cells.length) return { ok: false, detail: "shadedCells 重复" };
  return { ok: true, detail: `合法：${rows}x${columns} 涂 ${cells.length} 格` };
}

async function main() {
  const config = loadQwenConfig();
  const socket = new WebSocket(config.url, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    maxPayload: 512 * 1024, handshakeTimeout: 10_000,
  });

  const steps: Record<string, StepResult> = {};
  const notes: string[] = [];
  let phase = "connect";
  let ready = false;
  let failed: string | null = null;
  let callId: string | null = null;
  let callName: string | null = null;
  let callArgs = "";
  let cancelDeltaCountBefore = 0;
  let cancelDeltaCountAfter = 0;
  let cancelDoneStatus: string | null = null;
  let roundTripDone = false;
  let roundTripCompleted = false;
  let toolStepDoneStatus: string | null = null;

  const send = (event: Record<string, unknown>) => {
    socket.send(JSON.stringify({ event_id: randomUUID(), ...event }));
  };

  const stepEvents: string[] = [];
  const note = (type: string) => { if (stepEvents[stepEvents.length - 1] !== type) stepEvents.push(type); };

  const waitFor = (predicate: () => boolean, ms: number, label: string) =>
    new Promise<boolean>((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (predicate()) { clearInterval(timer); resolve(true); }
        else if (Date.now() - start > ms || failed) { clearInterval(timer); resolve(false); }
      }, 50);
      setTimeout(() => { /* 保险 */ }, 0);
      void label;
    });

  socket.on("error", () => { failed = "socketError"; });
  socket.on("close", () => { if (!failed && phase !== "done") failed = "socketClosed"; });
  socket.on("message", (raw) => {
    let e: Record<string, unknown>;
    try { e = JSON.parse(raw.toString()); } catch { failed = "badJson"; return; }
    const type = String(e.type ?? "");
    if (type === "error") { failed = `providerError:${JSON.stringify(e.error ?? e).slice(0, 300)}`; return; }
    if (phase === "connect") {
      if (type === "session.created") {
        send({ type: "session.update", session: {
          modalities: ["text", "audio"], voice: "Tina", turn_detection: null,
          audio: { input: { format: { type: "pcm", sample_rate: 16000 } }, output: { format: { type: "pcm", sample_rate: 24000 } } },
          instructions: "这是协议能力验证。按用户指令精确调用工具；不要诊断、不要闲聊。",
          tools: [HINT_TOOL],
          tool_choice: "auto",
        } });
      } else if (type === "session.updated") { ready = true; }
      return;
    }
    note(type);
    if (phase === "toolCall") {
      if (type === "response.function_call_arguments.delta" && typeof e.delta === "string") callArgs += e.delta;
      if (type === "response.function_call_arguments.done") {
        callId = typeof e.call_id === "string" ? e.call_id : null;
        callName = typeof e.name === "string" ? e.name : null;
        if (typeof e.arguments === "string" && e.arguments) callArgs = e.arguments;
      }
      if (type === "response.done") toolStepDoneStatus = String((e.response as Record<string, unknown>)?.status ?? "unknown");
    } else if (phase === "roundTrip") {
      if (type === "response.done") {
        roundTripDone = true;
        roundTripCompleted = String((e.response as Record<string, unknown>)?.status ?? "") === "completed";
      }
    } else if (phase === "cancelWait") {
      if (type === "response.audio.delta") {
        cancelDeltaCountBefore += 1;
        send({ type: "response.cancel" });
        phase = "cancelled";
      }
    } else if (phase === "cancelled") {
      if (type === "response.audio.delta") cancelDeltaCountAfter += 1;
      if (type === "response.done") cancelDoneStatus = String((e.response as Record<string, unknown>)?.status ?? "unknown");
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", () => reject(new Error("connectFailed")));
    setTimeout(() => reject(new Error("connectTimeout")), 12_000);
  }).catch((err) => { failed = String(err); });

  if (await waitFor(() => ready, 15_000, "session.updated")) {
    // 步骤 1：工具调用
    phase = "toolCall";
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [
      { type: "input_text", text: "请只调用 show_fraction_hint 工具，不要说话。参数：wholeGroupId 为 probe-whole，rows 为 3，columns 为 4，shadedCells 为 0 到 8。" },
    ] } });
    send({ type: "response.create" });
    const gotCall = await waitFor(() => !!callId || !!toolStepDoneStatus, 60_000, "function_call");
    const validation = callArgs ? validateToolArguments(callArgs) : { ok: false, detail: "未收到 arguments" };
    steps.toolCall = {
      ok: gotCall && callName === "show_fraction_hint" && validation.ok,
      detail: `gotCall=${gotCall} name=${callName ?? "null"} doneStatus=${toolStepDoneStatus ?? "null"}；${validation.detail}`,
      events: [...stepEvents],
    };
    stepEvents.length = 0;

    // 步骤 2：结果回传（仅当步骤 1 拿到 call_id）
    if (callId) {
      phase = "roundTrip";
      send({ type: "conversation.item.create", item: {
        type: "function_call_output", call_id: callId,
        output: JSON.stringify({ applied: true, rectangleId: "agent-hint-1" }),
      } });
      send({ type: "response.create" });
      await waitFor(() => roundTripDone, 60_000, "roundTrip");
      steps.toolResultRoundTrip = {
        ok: roundTripDone && roundTripCompleted,
        detail: `done=${roundTripDone} completed=${roundTripCompleted}`,
        events: [...stepEvents],
      };
      stepEvents.length = 0;
    } else {
      steps.toolResultRoundTrip = { ok: false, detail: "步骤 1 未拿到 call_id，跳过", events: [] };
    }

    // 步骤 3：取消协议
    phase = "cancelWait";
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [
      { type: "input_text", text: "请用很长的话详细讲解分数的意义，至少持续三十秒。" },
    ] } });
    send({ type: "response.create" });
    await waitFor(() => cancelDoneStatus !== null, 60_000, "cancel");
    await new Promise((r) => setTimeout(r, 2000));
    steps.cancel = {
      ok: cancelDeltaCountBefore > 0 && cancelDoneStatus === "cancelled",
      detail: `首音频后发出 cancel；取消前音频增量 ${cancelDeltaCountBefore}，取消后迟到增量 ${cancelDeltaCountAfter}，done.status=${cancelDoneStatus ?? "null"}`,
      events: [...stepEvents],
    };
    stepEvents.length = 0;
  } else if (!failed) {
    failed = "sessionUpdatedTimeout";
  }

  phase = "done";
  socket.terminate();

  const allOk = !failed && Object.values(steps).every((s) => s.ok);
  if (failed) notes.push(`失败点：${failed}`);
  const evidence = {
    schemaVersion: 1,
    probe: "qwen-omni-tool-capability",
    model: "qwen3.5-omni-flash-realtime",
    at: new Date().toISOString(),
    status: allOk ? "PASS" : "FAIL",
    failedAt: failed,
    steps,
    notes,
    usageAttribution: "unverified",
  };
  const outDir = join(repoRoot, "validation", "results", "qwen");
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, `2026-09-17-tool-capability.json`);
  await writeFile(out, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, failedAt: failed, out }, null, 2));
  for (const [name, step] of Object.entries(steps)) console.log(`- ${name}: ${step.ok ? "OK" : "FAIL"} — ${step.detail}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => { console.error("探针异常：", err instanceof Error ? err.message : err); process.exit(2); });
