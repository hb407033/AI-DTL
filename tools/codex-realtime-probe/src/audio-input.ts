import type { ThreadRealtimeAudioChunk } from "./realtime-contract.js";
export function readAudioFileArgument(args: string[]): string {
  const index = args.indexOf("--audio-file");
  if (index < 0) return "";
  const path = args[index + 1];
  if (!path?.trim() || path.startsWith("--")) throw new Error("--audio-file requires a path");
  return path;
}
/** 探针只接受明确的 24kHz mono PCM16 WAV，不猜格式、不隐式转码。 */
export function parseProbeWav(data: Buffer): Buffer {
  if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") throw new Error("expected PCM WAV");
  if (data.readUInt32LE(4) + 8 !== data.length) throw new Error("truncated WAV or trailing bytes");
  let formatSeen = false;
  let pcm: Buffer | undefined;
  for (let offset = 12; offset < data.length;) {
    if (offset + 8 > data.length) throw new Error("truncated chunk header");
    const kind = data.toString("ascii", offset, offset + 4), size = data.readUInt32LE(offset + 4);
    const begin = offset + 8, end = begin + size;
    if (end > data.length) throw new Error("truncated chunk");
    if (kind === "fmt ") {
      if (formatSeen || size < 16 || data.readUInt16LE(begin) !== 1 || data.readUInt16LE(begin + 14) !== 16) throw new Error("expected PCM16 format");
      if (data.readUInt16LE(begin + 2) !== 1) throw new Error("expected mono");
      if (data.readUInt32LE(begin + 4) !== 24000) throw new Error("expected 24000 Hz");
      if (data.readUInt32LE(begin + 8) !== 48000 || data.readUInt16LE(begin + 12) !== 2) throw new Error("invalid PCM alignment");
      formatSeen = true;
    } else if (kind === "data") {
      if (pcm || size === 0 || size % 2 !== 0) throw new Error("invalid PCM data");
      if (size > 24000 * 2 * 30) throw new Error("maximum input is 30 seconds");
      pcm = data.subarray(begin, end);
    }
    offset = end + (size % 2);
  }
  if (!formatSeen || !pcm) throw new Error("missing WAV format/data");
  return pcm;
}

export function audioChunks(pcm: Buffer, silenceMs = 1500): ThreadRealtimeAudioChunk[] {
  if (!Number.isInteger(silenceMs) || silenceMs < 0 || silenceMs > 10000) throw new Error("invalid silence duration");
  if (!pcm.length || pcm.length % 2 || pcm.length > 1440000) throw new Error("invalid PCM data");
  const input = Buffer.concat([pcm, Buffer.alloc(silenceMs * 48)]);
  const result: ThreadRealtimeAudioChunk[] = [];
  for (let offset = 0; offset < input.length; offset += 4800) {
    const chunk = input.subarray(offset, offset + 4800);
    result.push({ data: chunk.toString("base64"), sampleRate: 24000, numChannels: 1, samplesPerChannel: chunk.length / 2 });
  }
  return result;
}
