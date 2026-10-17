// 隔离故障注入宿主：不加载密钥、不调用模型、不读取家庭记录。
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/agent-host/package.json", import.meta.url));
const Fastify = require("fastify");
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../apps/agent-host/src/learning/workspace-store.ts";
import { WorkspaceScaffoldService, registerWorkspaceScaffold } from "../apps/agent-host/src/ai/workspace-scaffold-route.ts";

const directory = await mkdtemp(join(tmpdir(), "ai-dtl-revocation-"));
const store = new WorkspaceStore({ directory });
const hostId = "28d45059-5fe3-4799-91f2-19558018f47a";
const line = { kind: "line", whole: "1", unit: "升", partitions: 2, meaning: "一升果汁", sourceQuote: "一升" };
const basis = { problemId: "p", problemRevision: 0, submissionId: "s", responseId: "r" };
let offline = false, conflict = false, loseAck = false, posts = [];
const app = Fastify();
app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/workspace/")) return;
  if (offline) return reply.code(503).send({ reason: "syntheticOffline" });
});
app.addHook("preHandler", async (request, reply) => {
  if (!request.url.endsWith("/scaffold") || request.method !== "POST") return;
  posts.push(request.body);
  if (conflict) {
    conflict = false;
    await store.changeScaffold("session-a", "concurrent-select", 3, { type: "select", offerId: "offer-a", selectedParts: [0] });
    return reply.code(409).send({ reason: "staleRevision" });
  }
});
app.addHook("onSend", async (request, reply, payload) => {
  if (loseAck && request.method === "POST" && request.url.endsWith("/scaffold") && reply.statusCode === 200) {
    loseAck = false; reply.code(503); return JSON.stringify({ reason: "syntheticLostAcknowledgement" });
  }
  return payload;
});
const service = new WorkspaceScaffoldService(store, {
  understand: async () => { throw Error("modelMustNotRun"); }, generate: async () => { throw Error("modelMustNotRun"); },
});
registerWorkspaceScaffold(app, store, service);
app.get("/healthz", async () => ({ status: "ok", mode: "learning-tutor", hostId, discoveryVersion: 1 }));
app.post("/test-control", async (request) => {
  const body = request.body;
  if (body.reset) {
    const record = { schemaVersion: 2, sessionId: "session-a", eventId: "initial", revision: 0, phase: "exploring",
      problem: { problemId: "p", source: "curated", challengeId: "c", packVersion: "v1",
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
        statement: { text: "一升果汁6.8元，半升多少钱？", confirmed: true, revision: 0 } },
      childInkBase64: "aW5r", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
    await store.save(record, null);
    const previewId = await store.saveMedia("session-a", "preview", "preview", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWb8AAAAASUVORK5CYII=", "base64"));
    await store.save({ ...record, eventId: "evidence", revision: 1,
      submissions: [{ submissionId: "s", problemId: "p", problemRevision: 0, boardRevision: 0, previewId, explanation: "一升" }],
      feedback: [{ responseId: "r", turnId: "t", summary: "试试辅助线", contested: false }] }, 0);
    await store.changeScaffold("session-a", "offer", 0, { type: "offer", offerId: "offer-a", basis,
      understanding: { whole: "1", unit: "升", meaning: line.meaning, sourceQuote: line.sourceQuote } });
    await store.changeScaffold("session-a", "consent", 1, { type: "consent", offerId: "offer-a" });
    await store.changeScaffold("session-a", "generate", 2, { type: "generate", offerId: "offer-a", line });
  }
  offline = !!body.offline; conflict = !!body.conflict; loseAck = !!body.loseAck;
  return { ok: true, posts };
});
await app.listen({ host: "0.0.0.0", port: 8791 });
console.log(JSON.stringify({ directory, port: 8791, mode: "synthetic-fault-test" }));
