import { expect, test, vi } from "vitest";
import type { QwenEvent } from "../src/ai/qwen-session.js";
import { VoiceTurn } from "../src/ai/voice-turn.js";

function fixture(maxDurationMs = 60_000) {
  let listener: (event: QwenEvent) => void = () => {};
  const channel = { connect: async () => {}, appendPcm: vi.fn(), commit: vi.fn(), close: vi.fn(),
    onEvent: (fn: typeof listener) => { listener = fn; return () => {}; } };
  const events: unknown[] = [];
  const turn = new VoiceTurn({ sessionId: "s1", turnId: "t1", canvasRevision: 7 }, channel, e => events.push(e), maxDurationMs);
  return { turn, channel, events, emit: (e: QwenEvent) => listener(e) };
}
test("转写绑定录音回合与画布版本，只发待确认文本；不播放模型音频", async () => {
  const f = fixture(); await f.turn.start();
  f.turn.appendPcm(Buffer.alloc(3200)); f.turn.commit();
  f.emit({ type: "unapprovedAudio", responseId: "r", base64: "AAA=" });
  f.emit({ type: "transcript", itemId: "i", text: "我的想法", quality: "unconfirmed" });
  expect(f.events).toEqual([{ type: "transcript", sessionId: "s1", turnId: "t1", canvasRevision: 7, itemId: "i", text: "我的想法", quality: "unconfirmed" }]);
  expect(f.channel.close).toHaveBeenCalledOnce();
  expect(() => f.turn.commit()).toThrow("voiceTurnNotRecording");
});
test("取消后迟到转写与错误均被丢弃，关闭幂等", async () => {
  const f = fixture(); await f.turn.start(); f.turn.close(); f.turn.close();
  f.emit({ type: "transcript", itemId: "old", text: "旧答案", quality: "unconfirmed" });
  f.emit({ type: "error", code: "qwenProtocolError" });
  expect(f.events).toEqual([]); expect(f.channel.close).toHaveBeenCalledOnce();
});
test("空录音不可提交，提交后不可追加，不接收提前转写", async () => {
  const f = fixture(); await f.turn.start();
  expect(() => f.turn.commit()).toThrow("voiceTurnEmpty");
  f.emit({ type: "transcript", itemId: "early", text: "提前", quality: "unconfirmed" });
  f.turn.appendPcm(Buffer.alloc(3200)); f.turn.commit();
  expect(() => f.turn.appendPcm(Buffer.alloc(2))).toThrow("voiceTurnNotRecording");
  expect(f.events).toEqual([]); f.turn.close();
});
test("等待转写也受时限约束，超时关闭云端连接", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(100); await f.turn.start(); f.turn.appendPcm(Buffer.alloc(3200)); f.turn.commit();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.events).toEqual([{ type: "error", sessionId: "s1", turnId: "t1", canvasRevision: 7, code: "voiceTurnTimeout" }]);
    expect(f.channel.close).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
test("连接过程中退出，连接稍后成功也不能恢复录音", async () => {
  const f = fixture(); let resolve!: () => void;
  f.channel.connect = () => new Promise<void>(r => { resolve = r; });
  const pending = f.turn.start(); f.turn.close(); resolve();
  await expect(pending).rejects.toThrow("voiceTurnClosed");
  expect(() => f.turn.appendPcm(Buffer.alloc(2))).toThrow("voiceTurnNotRecording");
});
test("限制累计 PCM，避免高速输入绕过时长限制", async () => {
  const f = fixture(); await f.turn.start();
  expect(() => f.turn.appendPcm(Buffer.alloc(3201))).toThrow("voiceTurnInvalidPcm");
  for (let i = 0; i < 600; i++) f.turn.appendPcm(Buffer.alloc(3200));
  expect(() => f.turn.appendPcm(Buffer.alloc(2))).toThrow("voiceTurnAudioLimit");
  expect(f.channel.close).toHaveBeenCalledOnce();
});
