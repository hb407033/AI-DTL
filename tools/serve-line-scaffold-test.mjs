// 隔离合成材料 + 真实千问生成；不读取或修改家庭 Workspace。
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { WorkspaceStore } from "../apps/agent-host/src/learning/workspace-store.ts";
import { registerWorkspaceRoutes } from "../apps/agent-host/src/ai/workspace-route.ts";
import { WorkspaceScaffoldService, registerWorkspaceScaffold } from "../apps/agent-host/src/ai/workspace-scaffold-route.ts";
import { QwenLineScaffoldProvider } from "../apps/agent-host/src/ai/qwen-line-scaffold.ts";
import { loadQwenConfig } from "../apps/agent-host/src/ai/config.ts";
import { registerWorkspaceVoice } from "../apps/agent-host/src/ai/workspace-voice-route.ts";
import { WorkspaceVoiceProvider } from "../apps/agent-host/src/ai/workspace-voice-provider.ts";
const require = createRequire(new URL("../apps/agent-host/package.json", import.meta.url));
const app = require("fastify")();
const directory = await mkdtemp(path.join(os.tmpdir(), "ai-dtl-line-ui-"));
const store = new WorkspaceStore({ directory });
const service = new WorkspaceScaffoldService(store, new QwenLineScaffoldProvider(loadQwenConfig()));
registerWorkspaceRoutes(app, store); registerWorkspaceScaffold(app, store, service);
await app.register(require("@fastify/websocket"));
registerWorkspaceVoice(app, store, () => {
  const provider = new WorkspaceVoiceProvider(loadQwenConfig());
  return {
    close: () => provider.close(),
    transcribe: async (pcm, signal) => {
      const text = await provider.transcribe(pcm, signal);
      console.log(JSON.stringify({ event: "synthetic-transcript", text, inputBytes: pcm.length }));
      return text;
    },
    respond: async (pcm, instructions, image, audio, signal) => {
      let audioBytes = 0;
      const text = await provider.respond(pcm, instructions, image, chunk => { audioBytes += chunk.length; audio(chunk); }, signal);
      console.log(JSON.stringify({ event: "synthetic-response", text, audioBytes, imageBytes: image?.length ?? 0 }));
      return text;
    },
  };
}, (record, submissionId, responseId, signal) => service.offerAfterHelp(record.sessionId, submissionId, responseId, signal));
app.get("/test-line-audio/:index", async (request, reply) => {
  if (!/^[0-3]$/.test(request.params.index)) return reply.code(404).send();
  return reply.type("application/octet-stream").send(await readFile(`/tmp/ai-dtl-line-loop-audio/${request.params.index}.pcm`));
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64");
for (const sessionId of ["line-ui-hide", "line-ui-correct", "line-ui-voice"]) {
  const initial = { schemaVersion: 2, sessionId, eventId: "initial", revision: 0, phase: "confirming", problem: null,
    childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
  await store.save(initial, null);
  const photoId = await store.saveMedia(sessionId, "photo-event", "problemPhoto", png);
  const previewId = await store.saveMedia(sessionId, "preview-event", "preview", png);
  const record = { ...initial, eventId: "evidence", revision: 1, phase: "exploring",
    problem: { problemId: "p", source: "camera", photoId,
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      statement: { text: "一升果汁6.8元，半升多少钱？", confirmed: true, revision: 0 } },
    submissions: [{ submissionId: "e", problemId: "p", problemRevision: 0, boardRevision: 0, previewId,
      explanation: "我画的这条线表示一升果汁。我想知道半升，帮我一下。" }],
    feedback: [{ responseId: "r", turnId: "t", summary: "要不要用线段表示你说的一升？", contested: false }] };
  if (sessionId === "line-ui-voice") { record.submissions = []; record.feedback = []; }
  const saved = await store.save(record, 0);
  if (!saved.ok) throw Error("fixtureSaveFailed");
  if (sessionId !== "line-ui-voice") {
    await service.offerAfterHelp(sessionId, "e", "r");
    if (!(await store.loadScaffold(sessionId)).items.length) throw Error("realProviderNoOffer");
  }
}
await app.listen({ host: "0.0.0.0", port: 8791 });
console.log(JSON.stringify({ ready: true, directory, provenance: "synthetic confirmed expression; real Qwen understanding and generation; native consent" }));
process.on("SIGTERM", async () => { await app.close(); process.exit(0); });
