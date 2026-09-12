import { describe, expect, test } from "vitest";
import { parseProbeWav, audioChunks, readAudioFileArgument } from "../src/audio-input.js";

function wav(samples = 4800, channels = 1, sampleRate = 24000) {
  const data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(channels, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * channels * 2, 28);
  data.writeUInt16LE(channels * 2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 44; i < data.length; i += 2) data.writeInt16LE(123, i);
  return data;
}

describe("固定成人/合成 WAV 输入，不访问真实模型", () => {
  test("明确指定音频却没有路径时拒绝，不静默回退文字", () => {
    expect(readAudioFileArgument([])).toBe("");
    expect(readAudioFileArgument(["--audio-file", "/tmp/adult.wav"])).toBe("/tmp/adult.wav");
    expect(() => readAudioFileArgument(["--audio-file"])).toThrow(/path/);
    expect(() => readAudioFileArgument(["--audio-file", "--dry-run"])).toThrow(/path/);
  });
  test("只提取 PCM，按 100ms 分块并追加静音供 VAD 结束", () => {
    const parsed = parseProbeWav(wav());
    const chunks = audioChunks(parsed, 300);
    expect(chunks).toHaveLength(5);
    expect(chunks.every(c => c.sampleRate === 24000 && c.numChannels === 1 && c.samplesPerChannel === 2400)).toBe(true);
    expect(Buffer.from(chunks[0]!.data, "base64").readInt16LE(0)).toBe(123);
    expect(Buffer.from(chunks[4]!.data, "base64").every(n => n === 0)).toBe(true);
  });
  test("拒绝错误格式、采样率、多声道、截断与过长输入", () => {
    expect(() => parseProbeWav(Buffer.from("not wave"))).toThrow();
    expect(() => parseProbeWav(wav(4800, 2))).toThrow(/mono/);
    expect(() => parseProbeWav(wav(4800, 1, 44100))).toThrow(/24000/);
    expect(() => parseProbeWav(wav().subarray(0, 60))).toThrow(/truncated/);
    expect(() => parseProbeWav(wav(24000 * 31))).toThrow(/30/);
  });
  test("空输入、半个 sample 与非法静音时长不得成为成功样本", () => {
    expect(() => parseProbeWav(wav(0))).toThrow();
    const invalid = wav(); invalid.writeUInt32LE(9599, 40);
    expect(() => parseProbeWav(invalid)).toThrow();
    expect(() => audioChunks(parseProbeWav(wav()), -1)).toThrow();
    expect(() => audioChunks(parseProbeWav(wav()), 10001)).toThrow();
  });
});
