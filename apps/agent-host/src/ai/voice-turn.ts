import type { QwenEvent } from "./qwen-session.js";

export interface VoiceTurnIdentity { sessionId: string; turnId: string; canvasRevision: number }
export interface VoiceChannel {
  connect(): Promise<void>;
  appendPcm(pcm: Buffer): void;
  commit(): void;
  close(): void;
  onEvent(listener: (event: QwenEvent) => void): () => void;
}
export type VoiceTurnEvent = VoiceTurnIdentity & (
  | { type: "transcript"; itemId: string; text: string; quality: "unconfirmed" }
  | { type: "error"; code: "voiceTurnTimeout" | "voiceTurnFailed" }
);

/** 每次录音独占一个通道；不复用云端上下文，防止取消后的转写串入新回合。
 * 这里只产生待确认文本，不写证据、不输出模型音频。外层仍须核对当前画布版本。
 */
export class VoiceTurn {
  private state: "idle" | "connecting" | "recording" | "committed" | "closed" = "idle";
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly identity: VoiceTurnIdentity;
  constructor(identity: VoiceTurnIdentity, private readonly channel: VoiceChannel,
    private readonly emit: (event: VoiceTurnEvent) => void, private readonly maxDurationMs = 60_000) {
    if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0 || maxDurationMs > 60_000) throw new Error("voiceTurnInvalidDuration");
    this.identity = { ...identity };
  }
  async start(): Promise<void> {
    if (this.state !== "idle") throw new Error("voiceTurnAlreadyStarted");
    this.state = "connecting";
    this.unsubscribe = this.channel.onEvent(event => this.receive(event));
    this.timer = setTimeout(() => this.fail("voiceTurnTimeout"), this.maxDurationMs);
    try {
      await this.channel.connect();
      if (this.isClosed()) throw new Error("voiceTurnClosed");
      this.state = "recording";
    } catch {
      if (!this.isClosed()) this.fail("voiceTurnFailed");
      throw new Error("voiceTurnClosed");
    }
  }
  private isClosed(): boolean { return this.state === "closed"; }
  appendPcm(pcm: Buffer): void {
    if (this.state !== "recording") throw new Error("voiceTurnNotRecording");
    if (!pcm.length || pcm.length > 3200 || pcm.length % 2) throw new Error("voiceTurnInvalidPcm");
    // 即使客户端快速发送，累计音频也不超过 60 秒（16kHz / mono / PCM16）。
    if (this.bytes + pcm.length > 32_000 * 60) { this.fail("voiceTurnFailed"); throw new Error("voiceTurnAudioLimit"); }
    try { this.channel.appendPcm(pcm); this.bytes += pcm.length; }
    catch { this.fail("voiceTurnFailed"); throw new Error("voiceTurnFailed"); }
  }
  commit(): void {
    if (this.state !== "recording") throw new Error("voiceTurnNotRecording");
    if (!this.bytes) throw new Error("voiceTurnEmpty");
    this.state = "committed";
    try { this.channel.commit(); }
    catch { this.fail("voiceTurnFailed"); throw new Error("voiceTurnFailed"); }
  }
  private receive(event: QwenEvent): void {
    if (this.isClosed()) return;
    if (event.type === "error" || event.type === "closed") { this.fail("voiceTurnFailed"); return; }
    if (event.type !== "transcript" || this.state !== "committed") return;
    this.close();
    this.emit({ ...this.identity, ...event });
  }
  private fail(code: "voiceTurnTimeout" | "voiceTurnFailed"): void {
    if (this.isClosed()) return;
    this.close(); this.emit({ ...this.identity, type: "error", code });
  }
  close(): void {
    if (this.isClosed()) return;
    this.state = "closed";
    clearTimeout(this.timer); this.unsubscribe?.(); this.channel.close();
  }
}
