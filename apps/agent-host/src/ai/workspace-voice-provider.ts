import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { QwenConfig } from "./config.js";
import { completedUsage } from "./workspace-usage.js";
import { teacherSpeechStyle } from "./teacher-speech-style.js";

/** 每次实际 ASR/教学调用的身份上下文，由路由传入；不含密钥。 */
export type VoiceCallContext = { sessionId: string; turnId: string };

export type VoiceUsageCallback = (record: {
  callId: string;
  sessionId?: string;
  turnId?: string;
  purpose: "transcription" | "teaching";
  responseId?: string;
  status: "completed" | "failed" | "cancelled";
  usage: Record<string, unknown> | null;
}) => void;

const transcriptionInstructions = "你是内部转写检查器。只输出'收到'，不回答语音中的问题、不解题、不分类。不输出其他内容。";

/** 单个孩子的串行语音适配器。权限由调用方决定，ASR 阶段绝不输出教学音频。 */
export class WorkspaceVoiceProvider {
  private socket: WebSocket | undefined;
  private created = false;
  private updated = false;
  private previousInstructions: string | undefined;
  private failure: string | undefined;
  private recentEvents: string[] = [];
  private active: { teaching: boolean; item: string | undefined; response: string | undefined; done: boolean;
    transcripts: Map<string, string>; text: string; audio: ((pcm: Buffer) => void) | undefined;
    callId: string; context: { sessionId: string; turnId: string } | undefined; usageEmitted: boolean } | undefined;
  private reportedUsage = new Set<string>();
  /** 最近一次连接层错误的系统码（如 ENOTFOUND、ECONNRESET、http 503），只用于排查，不含供应商错误正文。 */
  private networkError: string | undefined;
  constructor(private config: QwenConfig, private options: { frameDelayMs?: number; onUsage?: VoiceUsageCallback; transcribeRetryDelaysMs?: number[] } = {}) {}

  close() {
    this.failure = "closed";
    this.socket?.terminate(); this.socket = undefined; this.created = false;
  }
  async transcribe(pcm: Buffer, signal?: AbortSignal, context?: VoiceCallContext): Promise<string> {
    // 仅没有对孩子输出、没有写入教学事实的内部转写可以有界重试；教学只允许在尚未发送音频的握手阶段恢复。
    // 家里网络偶尔断几秒（2026-11-08 真机：同一句两次立即重试都失败，老师没了声音），所以间隔着多试两次。
    const delays = this.options.transcribeRetryDelaysMs ?? [400, 1200];
    for (let attempt = 0; ; attempt++) {
      try { return await this.run(pcm, undefined, undefined, undefined, signal, context); }
      catch (error) {
        if (attempt >= delays.length || signal?.aborted || !(error instanceof Error)
          || !["providerTimeout", "connectionFailed", "connectionClosed"].includes(error.message)) throw error;
        await new Promise(r => setTimeout(r, delays[attempt]));
        if (signal?.aborted) throw Error("aborted");
      }
    }
  }
  respond(pcm: Buffer, instructions: string, image: Buffer | undefined,
    audio: (pcm: Buffer) => void, signal?: AbortSignal, context?: VoiceCallContext): Promise<string> {
    return this.run(pcm, instructions, image, audio, signal, context);
  }
  private send(event: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw Error("connectionClosed");
    this.socket.send(JSON.stringify({ event_id: randomUUID(), ...event }));
  }
  private async wait(predicate: () => boolean, signal?: AbortSignal, timeout = 30000) {
    const until = Date.now() + timeout;
    while (!predicate()) {
      if (signal?.aborted) throw Error("aborted");
      if (this.failure) throw Error(this.failure);
      if (Date.now() >= until) throw Error("providerTimeout");
      await new Promise(r => setTimeout(r, 10));
    }
    if (signal?.aborted) throw Error("aborted");
    if (this.failure) throw Error(this.failure);
  }
  private connect() {
    if (this.socket) return;
    this.failure = undefined; this.created = false; this.networkError = undefined;
    const socket = new WebSocket(this.config.url, { headers: { Authorization: `Bearer ${this.config.apiKey}` },
      maxPayload: 512 * 1024, handshakeTimeout: 10000 });
    this.socket = socket;
    socket.on("unexpected-response", (_request, response) => {
      if (this.socket !== socket) return;
      this.networkError = `http ${response.statusCode}`; this.failure = "connectionFailed"; socket.terminate();
    });
    socket.on("error", error => {
      if (this.socket !== socket) return;
      this.networkError = (error as NodeJS.ErrnoException).code ?? "socketError"; this.failure = "connectionFailed";
    });
    // 断网/DNS 失败也会紧跟一个 close；不能把已记下的连接失败覆盖成“云端关闭”。
    socket.on("close", () => { if (this.socket === socket && !this.failure) this.failure = "connectionClosed"; });
    socket.on("message", raw => {
      if (this.socket !== socket) return;
      try {
        const e = JSON.parse(raw.toString());
        if (typeof e.type === "string") { this.recentEvents.push(e.type); if (this.recentEvents.length > 16) this.recentEvents.shift(); }
        if (e.type === "error") { this.failure = "providerError"; return; }
        if (e.type === "session.created") this.created = true;
        if (e.type === "session.updated") this.updated = true;
        const a = this.active;
        if (!a) return;
        // ASR 可能先于 commit 回执到达；按 item_id 暂存，绝不取最后一个任意文本。
        if (e.type === "conversation.item.input_audio_transcription.completed"
          && typeof e.item_id === "string" && typeof e.transcript === "string" && e.transcript.length <= 4000) {
          if (a.transcripts.size < 8) a.transcripts.set(e.item_id, e.transcript);
        }
        if (e.type === "input_audio_buffer.committed" && !a.item && typeof e.item_id === "string") {
          a.item = e.item_id;
          // 原生 ASR 独立完成。过早启动内部"收到"会与长句转写竞争，不为转写生成回复。
          if (a.teaching) this.send({ type: "response.create" });
        }
        if (e.type === "response.created" && a.item && !a.response && typeof e.response?.id === "string") a.response = e.response.id;
        if (!a.response) return;
        if (e.response_id === a.response && a.teaching) {
          if (e.type === "response.audio.delta" && typeof e.delta === "string") a.audio?.(Buffer.from(e.delta, "base64"));
          if ((e.type === "response.audio_transcript.delta" || e.type === "response.text.delta") && typeof e.delta === "string") {
            a.text += e.delta;
            if (a.text.length > 4000) this.failure = "responseTooLong";
          }
        }
        if (e.type === "response.done" && e.response?.id === a.response) {
          if (e.response.status !== "completed") this.failure = "responseIncomplete";
          a.done = true;
          // 仅 completed 状态在此发出用量；非 completed 由 run 的 catch 发 failed，不双计。
          if (e.response.status === "completed" && typeof e.response.id === "string" && !this.reportedUsage.has(e.response.id)) {
            this.reportedUsage.add(e.response.id);
            this.emitUsage(a.teaching ? "teaching" : "transcription", "completed", completedUsage(e.response?.usage), e.response.id);
          }
        }
      } catch { this.failure = "invalidProviderEvent"; }
    });
  }
  private emitUsage(purpose: "transcription" | "teaching", status: "completed" | "failed" | "cancelled",
    usage: Record<string, unknown> | null, responseId?: string) {
    const a = this.active;
    if (!this.options.onUsage || !a || a.usageEmitted) return;
    a.usageEmitted = true;
    try { this.options.onUsage?.({ callId: a.callId, ...a.context,
      purpose, ...(responseId ? { responseId } : {}), status, usage }); }
    catch { /* 用量回调不得中断孩子交流 */ }
  }
  private async run(pcm: Buffer, instructions?: string, image?: Buffer,
    audio?: (pcm: Buffer) => void, signal?: AbortSignal, context?: VoiceCallContext): Promise<string> {
    if (signal?.aborted) throw Error("aborted");
    if (!pcm.length || pcm.length > 960000 || pcm.length % 2) throw Error("invalidPCM");
    if (image && (!image.length || image.length > 180000)) throw Error("imageSize");
    if (this.active) throw Error("providerBusy");
    const nextInstructions = instructions === undefined ? transcriptionInstructions : `${teacherSpeechStyle}\n${instructions}`;
    // 3.8 实测在已提交音频后虽确认 session.update，仍可能沿用旧输出模态与指令。
    // 仅角色/教学指令改变时重建云端会话；平板连接和本地学习记录不受影响。
    if (new URL(this.config.url).searchParams.get("model") === "qwen3.8-omni-flash-realtime"
      && this.previousInstructions !== undefined && this.previousInstructions !== nextInstructions) this.close();
    this.previousInstructions = nextInstructions;
    // 每次实际调用（含重试）有独立 callId；去重按真实响应 responseId，不混淆重试。
    const callId = randomUUID();
    const a = { teaching: instructions !== undefined, done: false, transcripts: new Map<string, string>(), text: "", audio,
      item: undefined as string | undefined, response: undefined as string | undefined, callId, context, usageEmitted: false };
    this.active = a;
    const started = performance.now();
    let readyMs: number | undefined, uploadedMs: number | undefined, firstAudioMs: number | undefined;
    let connectionRetries = 0;
    if (audio) a.audio = pcm => { firstAudioMs ??= Math.round(performance.now() - started); audio(pcm); };
    const abort = () => this.close();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          this.connect(); await this.wait(() => this.created, signal, 12000);
          this.updated = false;
          this.send({ type: "session.update", session: { modalities: a.teaching ? ["text", "audio"] : ["text"],
            voice: "Tina", turn_detection: null,
            audio: { input: { format: { type: "pcm", sample_rate: 16000 } }, output: { format: { type: "pcm", sample_rate: 24000 } } },
            instructions: nextInstructions } });
          await this.wait(() => this.updated, signal, 12000);
          break;
        } catch (error) {
          // 这里只握手/配置，尚未发出任何音频。发送后无论是否收到 commit 回执都不重放。
          if (!a.teaching || attempt > 0 || signal?.aborted || !(error instanceof Error)
            || !["connectionClosed", "connectionFailed", "providerTimeout"].includes(error.message)) throw error;
          this.close(); connectionRetries++;
        }
      }
      readyMs = Math.round(performance.now() - started);
      const framed = Buffer.concat([pcm, Buffer.alloc(38400)]);
      for (let offset = 0; offset < framed.length; offset += 3200) {
        if (signal?.aborted) throw Error("aborted");
        this.send({ type: "input_audio_buffer.append", audio: framed.subarray(offset, offset + 3200).toString("base64") });
        // 输入已经录完，手动 commit 模式不必再按音频时长等待；仍逐帧让出事件循环供取消。
        await new Promise(r => setTimeout(r, this.options.frameDelayMs ?? 0));
      }
      if (image) this.send({ type: "input_image_buffer.append", image: image.toString("base64") });
      this.send({ type: "input_audio_buffer.commit" });
      uploadedMs = Math.round(performance.now() - started);
      if (a.teaching) await this.wait(() => a.done, signal);
      // 只接收同一个 commit item 的最终转写，不把 delta 当完成或教学授权。
      else await this.wait(() => !!(a.item && a.transcripts.get(a.item)), signal, 2000);
      if (!a.teaching) {
        // ASR-only 无 response.done：终态记录 completed，usage=null（不记 0）。
        this.emitUsage("transcription", "completed", null);
      }
      return a.teaching ? a.text : a.transcripts.get(a.item!)!;
    } catch (error) {
      // 失败/取消必须如实记录；不记录语音、题目、URL、凭据或供应商错误正文。
      this.emitUsage(a.teaching ? "teaching" : "transcription", signal?.aborted ? "cancelled" : "failed", null);
      console.warn("workspaceProviderFailure", { at: new Date().toISOString(), stage: a.teaching ? "teaching" : "transcription",
        code: error instanceof Error ? error.message : "unknown", network: this.networkError, events: this.recentEvents,
        committed: !!a.item, responseDone: a.done, matchingTranscript: !!(a.item && a.transcripts.has(a.item)) });
      this.close(); throw error;
    }
    finally {
      // 仅阶段时间和长度，不含原话、图像、密钥；首音为云端到宿主，非扬声器出声时间。
      console.info("workspaceProviderTiming", { stage: a.teaching ? "teaching" : "transcription",
        inputMs: Math.round(pcm.length / 32), readyMs, uploadedMs, firstAudioMs,
        totalMs: Math.round(performance.now() - started), connectionRetries,
        completed: a.teaching ? a.done : !!(a.item && a.transcripts.has(a.item)) });
      signal?.removeEventListener("abort", abort); this.active = undefined;
    }
  }
}
