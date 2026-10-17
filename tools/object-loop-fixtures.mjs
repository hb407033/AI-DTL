// 合成成人系统音色，不是儿童录音；仅为观察照片的联合测试生成输入。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const directory = "/tmp/ai-dtl-object-loop-audio";
mkdirSync(directory, { recursive: true });
const texts = ["我想用这条线表示一升果汁。", "看看我的想法。", "这条线表示一升果汁，半升就是其中的一半。",
  "我把六元八角分成相等的两份，每份三元四角，加起来还是六元八角。", "看看我的想法。"];
const manifest = texts.map((text, index) => {
  const aiff = `${directory}/${index}.aiff`, pcm = `${directory}/${index}.pcm`;
  execFileSync("say", ["-v", "Tingting (中文（中国大陆）)", "-r", "170", "-o", aiff, text]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "16000", "-ac", "1", "-f", "s16le", pcm]);
  const data = readFileSync(pcm);
  return { index, text, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
});
writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
