import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.AI_DTL_PROBE_DIRECTORY;
if (!root || !path.isAbsolute(root)) throw Error("absoluteProbeDirectoryRequired");
mkdirSync(root, { recursive: true });
execFileSync("swift", [fileURLToPath(new URL("./make-division-images.swift", import.meta.url)), root]);
const expressions = [
  "我把十二点五和零点五都乘十，变成一百二十五除以五，但我算成二百零五，不确定对不对。",
  "总量和每一组都扩大十倍，能分的组数没变，所以商不变。不是只有一个数扩大。",
  "我检查商的数位，二表示两个十，后面五表示五个一，中间不该写零，我自己改成二十五了。",
  "我用二十五乘零点五，算回十二点五，正好回到被除数，所以检验也对。",
  "我自己试四点八除零点六，两个数都乘十，变成四十八除以六，算出八，八乘零点六等于四点八，检验也对。",
];
expressions.forEach((text, index) => {
  const aiff = path.join(root, `${index}.aiff`), pcm = path.join(root, `${index}.pcm`);
  // -n 避免覆盖先前证据；复跑请创建一个新的隔离目录。
  execFileSync("say", ["-v", "Tingting", "-r", "185", "-o", aiff, text]);
  execFileSync("ffmpeg", ["-v", "error", "-n", "-i", aiff, "-ar", "16000", "-ac", "1", "-f", "s16le", pcm]);
});
console.log(`Synthetic fixtures ready: ${root}`);
