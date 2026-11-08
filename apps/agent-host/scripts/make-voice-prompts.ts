/**
 * 用老师同一个实时语音，预先合成 iPad 本机要说的固定短句（应答、没听清等），打包进 App。
 * 这样本机提示和老师声音一致，不联网、不用系统 TTS（2026-11-08 真机：系统 TTS 声音不同且有破音）。
 * 用法：node --env-file=.env.ai.local --import tsx apps/agent-host/scripts/make-voice-prompts.ts
 * 输出：apps/ipad/ScholarPad/ScholarPad/Session/Prompts/<名字>.pcm（24kHz、16 位、单声道小端）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadQwenConfig } from "../src/ai/config.js";
import { WorkspaceVoiceProvider } from "../src/ai/workspace-voice-provider.js";
import { matchesTeachingQuestion } from "../src/ai/workspace-teaching-context.js";

// 与 iPad 端 TutorPrompts.swift 的表保持一致。
export const PROMPTS: Record<string, string> = {
  "ack-1": "嗯，我想想。",
  "ack-2": "好，我看看。",
  "ack-3": "嗯，让我想一下。",
  "ack-4": "好，我来看一看。",
  "unheard": "刚才没听清，你再说一遍好吗？",
  "unsure": "老师刚才没想好，你再说一遍好吗？",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = path.join(root, "apps/ipad/ScholarPad/ScholarPad/Session/Prompts");
await fs.mkdir(out, { recursive: true });
const provider = new WorkspaceVoiceProvider(loadQwenConfig());
try {
  for (const [name, text] of Object.entries(PROMPTS)) {
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      const chunks: Buffer[] = [];
      const spoken = await provider.respond(Buffer.alloc(6400), `这是纯语音播报，不是答题。不解释、不续写、不说吸气声。只逐字读这句话：${text}`,
        undefined, pcm => chunks.push(pcm));
      const pcm = Buffer.concat(chunks);
      if (!pcm.length || !matchesTeachingQuestion(spoken, text)) { console.warn("mismatch", { name, spoken }); continue; }
      await fs.writeFile(path.join(out, `${name}.pcm`), pcm);
      console.log(name, text, `${(pcm.length / 48000).toFixed(2)}s`);
      saved = true;
    }
    if (!saved) throw Error(`promptFailed:${name}`);
  }
} finally { provider.close(); }
