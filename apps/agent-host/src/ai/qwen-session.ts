import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { QwenConfig } from "./config.js";

export type QwenEvent =
  | { type: "transcript"; itemId: string; text: string; quality: "unconfirmed" }
  | { type: "unapprovedAudio"; responseId: string; base64: string }
  | { type: "error"; code: "qwenConnectionFailed" | "qwenProtocolError" }
  | { type: "closed" };

/** 协议客户端，不是儿童语音路由。音频不得绕过宿主播放门禁。 */
export class QwenSession {
  private socket: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private listeners = new Set<(event: QwenEvent) => void>();
  private cancelConnect: (() => void) | undefined;
  constructor(private readonly config: QwenConfig, private readonly connectTimeoutMs = 10_000) {}
  onEvent(listener: (event: QwenEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: QwenEvent): void { for (const listener of this.listeners) listener(event); }
  connect(): Promise<void> {
    if (this.socket || this.closed) return Promise.reject(new Error("qwenAlreadyStarted"));
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.config.url, { headers: { Authorization: `Bearer ${this.config.apiKey}` },
        maxPayload: 512 * 1024, handshakeTimeout: this.connectTimeoutMs, followRedirects: false });
      this.socket = socket;
      let settled = false, configured = false;
      const fail = (code: string) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error(code)); }
        this.close();
      };
      const timer = setTimeout(() => fail("qwenConnectTimeout"), this.connectTimeoutMs);
      this.cancelConnect = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error("qwenClosed")); } };
      socket.on("error", () => {
        if (this.closed) return;
        this.emit({ type: "error", code: "qwenConnectionFailed" }); fail("qwenConnectionFailed");
      });
      socket.on("close", () => {
        if (!this.closed) { this.emit({ type: "closed" }); fail("qwenClosed"); }
      });
      socket.on("message", data => {
        if (this.closed) return;
        try {
          const event = JSON.parse(data.toString());
          if (event.type === "error") throw new Error("providerError");
          if (event.type === "session.created" && !configured) {
            configured = true;
            socket.send(JSON.stringify({ event_id: randomUUID(), type: "session.update", session: {
              modalities: ["text", "audio"], voice: "Tina", turn_detection: null,
              audio: { input: { format: { type: "pcm", sample_rate: 16000 } }, output: { format: { type: "pcm", sample_rate: 24000 } } },
              instructions: "这是学习系统的协议接入验证通道。不要主动讲解、推断孩子能力或创建长期记录。",
            } }));
          } else if (event.type === "session.updated" && configured && !settled) {
            settled = true; clearTimeout(timer); this.ready = true; this.cancelConnect = undefined; resolve();
          } else if (this.ready && event.type === "conversation.item.input_audio_transcription.completed") {
            if (typeof event.item_id !== "string" || typeof event.transcript !== "string" || event.transcript.length > 16_000) throw new Error("invalidTranscript");
            this.emit({ type: "transcript", itemId: event.item_id, text: event.transcript, quality: "unconfirmed" });
          } else if (this.ready && event.type === "response.audio.delta") {
            if (typeof event.response_id !== "string" || typeof event.delta !== "string" || event.delta.length > 350_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.delta)) throw new Error("invalidAudio");
            this.emit({ type: "unapprovedAudio", responseId: event.response_id, base64: event.delta });
          }
        } catch {
          this.emit({ type: "error", code: "qwenProtocolError" }); fail("qwenProtocolError");
        }
      });
    });
  }
  private send(event: Record<string, unknown>): void {
    if (!this.ready || this.closed || this.socket?.readyState !== WebSocket.OPEN) throw new Error("qwenNotReady");
    if (this.socket.bufferedAmount > 256 * 1024) { this.close(); throw new Error("qwenBackpressure"); }
    this.socket.send(JSON.stringify({ event_id: randomUUID(), ...event }));
  }
  /** 16bit、单声道、16kHz PCM；每帧最多 100ms。 */
  appendPcm(pcm: Buffer): void {
    if (!this.ready || this.closed) throw new Error("qwenNotReady");
    if (pcm.length === 0 || pcm.length > 3200 || pcm.length % 2 !== 0) throw new Error("qwenInvalidPcm");
    this.send({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
  }
  commit(): void { this.send({ type: "input_audio_buffer.commit" }); }
  cancel(): void { this.send({ type: "response.cancel" }); this.send({ type: "input_audio_buffer.clear" }); }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.ready = false; this.cancelConnect?.(); this.cancelConnect = undefined;
    this.socket?.terminate(); this.listeners.clear();
  }
}
