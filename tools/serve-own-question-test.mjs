// 无模型、无家庭资料：给模拟器验证孩子自行提问的真实 HTTP 链路。
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { WorkspaceStore } from "../apps/agent-host/src/learning/workspace-store.ts";
import { registerWorkspaceRoutes } from "../apps/agent-host/src/ai/workspace-route.ts";
import { registerWorkspaceVoice } from "../apps/agent-host/src/ai/workspace-voice-route.ts";
import { WorkspaceVoiceProvider } from "../apps/agent-host/src/ai/workspace-voice-provider.ts";
import { loadQwenConfig } from "../apps/agent-host/src/ai/config.ts";
const require = createRequire(new URL("../apps/agent-host/package.json", import.meta.url));
const Fastify = require("fastify");
const directory = await mkdtemp(path.join(os.tmpdir(), "ai-dtl-own-question-ui-"));
const app = Fastify();
const store = new WorkspaceStore({ directory });
registerWorkspaceRoutes(app, store);
const voice = process.argv.includes("--with-voice");
if (voice) {
  await app.register(require("@fastify/websocket"));
  const config = loadQwenConfig();
  registerWorkspaceVoice(app, store, () => {
    const provider = new WorkspaceVoiceProvider(config);
    return {
      close: () => provider.close(),
      transcribe: async (pcm, signal) => {
        const text = await provider.transcribe(pcm, signal);
        console.log(JSON.stringify({ event: "synthetic-transcript", inputBytes: pcm.length, text }));
        return text;
      },
      respond: async (pcm, instructions, image, audio, signal) => {
        const start = Date.now(); let audioBytes = 0;
        const text = await provider.respond(pcm, instructions, image, chunk => { audioBytes += chunk.length; audio(chunk); }, signal);
        console.log(JSON.stringify({ event: "synthetic-model-response", text, audioBytes, elapsedMs: Date.now() - start,
          imageBytes: image?.length ?? 0, imageSha256: image ? createHash("sha256").update(image).digest("hex") : null }));
        return text;
      },
    };
  });
  app.get("/test-audio/:index", async (request, reply) => {
    const index = request.params.index;
    if (!/^[0-4]$/.test(index)) return reply.code(404).send();
    return reply.type("application/octet-stream").send(await readFile(`/tmp/ai-dtl-object-loop-audio/${index}.pcm`));
  });
}
const host = process.argv.includes("--device") ? "0.0.0.0" : "::1";
await app.listen({ host, port: 8791 });
console.log(JSON.stringify({ host, port: 8791, directory, model: voice ? "configured-qwen" : "none" }));
process.on("SIGTERM", async () => { await app.close(); process.exit(0); });
