// 合成成人音色，仅供隔离测试；授权短句与实质表达分开，检验跨轮证据。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const directory = "/tmp/ai-dtl-line-loop-audio";
mkdirSync(directory, { recursive: true });
const texts = ["我画的这条线表示一升果汁，半升应该是其中的一半。", "帮我一下。",
  "提示藏起来了。我自己把一升分成相等的两份，半升就是一份。六元八角也分成相等的两份，每份三元四角。", "看看我的想法。"];
const manifest = texts.map((text, index) => {
  const aiff = `${directory}/${index}.aiff`, pcm = `${directory}/${index}.pcm`;
  execFileSync("say", ["-v", "Tingting (中文（中国大陆）)", "-r", "180", "-o", aiff, text]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "16000", "-ac", "1", "-f", "s16le", pcm]);
  const data = readFileSync(pcm);
  return { index, text, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
});
writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
