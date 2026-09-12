import { inflateSync } from "node:zlib";

/** 接受 native 输出的非交错 8-bit PNG；完整检查块结构、校验和、解压尺寸和逐行过滤字节。 */
export function validatePreviewPNG(bytes: Buffer): void {
  const invalid = () => { throw new Error("invalidDrawingPayload"); };
  if (bytes.length < 45 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") invalid();
  let width = 0, height = 0, channels = 0, ended = false;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const type = bytes.toString("ascii", offset + 4, offset + 8), chunk = bytes.subarray(offset + 8, end - 4);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, end - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) invalid();
    if (offset === 8 && type !== "IHDR") invalid();
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) invalid();
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[chunk[9]!] ?? 0;
      if (!width || !height || width > 2048 || height > 2048 || !channels || chunk[8] !== 8 || chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0) invalid();
    } else if (type === "IDAT") compressed.push(chunk);
    else if (type === "IEND") { if (length || end !== bytes.length) invalid(); ended = true; }
    offset = end;
  }
  if (!ended || !compressed.length) invalid();
  const stride = width * channels + 1, expected = stride * height;
  let pixels: Buffer;
  try { pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); }
  catch { return invalid(); }
  if (pixels.length !== expected) invalid();
  for (let offset = 0; offset < pixels.length; offset += stride) if (pixels[offset]! > 4) invalid();
}
