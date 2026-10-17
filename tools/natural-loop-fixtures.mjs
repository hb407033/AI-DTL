// 合成儿童情境的成人系统音色输入；不是孩子录音，不模拟教师输出。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const directory = "/tmp/ai-dtl-natural-loop-audio";
mkdirSync(directory, { recursive: true });
const texts = [
  "我想用这条线表示彩带。",
  "看看我的想法。",
  "这条线表示一米长的彩带。",
  "我算了一分米是二角四分，三分米是七角二分。",
  "看看我的想法。",
];
const manifest = texts.map((text, index) => {
  const aiff = path.join(directory, `${index}.aiff`), pcm = path.join(directory, `${index}.pcm`);
  execFileSync("say", ["-v", "Tingting (中文（中国大陆）)", "-r", "170", "-o", aiff, text]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "16000", "-ac", "1", "-f", "s16le", pcm]);
  const data = readFileSync(pcm);
  return { index, text, bytes: data.length, durationSeconds: data.length / 32000,
    sha256: createHash("sha256").update(data).digest("hex") };
});
writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
