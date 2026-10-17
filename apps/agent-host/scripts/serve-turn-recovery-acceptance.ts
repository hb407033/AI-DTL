/** 真机协议验收：真实作品/语音路由，只有ASR、决策、音频替换为隔离夹具；无模型费用。 */
import fs from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceRoutes } from "../src/ai/workspace-route.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";

const [directory, portText = "18792"] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory) || !directory.includes("acceptance")) throw Error("isolatedAcceptanceDirectoryRequired");
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const store = new WorkspaceStore({ directory: path.join(directory, "workspaces") });
const fixture = { schemaVersion: 2 as const, sessionId: "fixture-confirmed-s", eventId: "fixture-seed", revision: 0,
  problem: { source: "curated", problemId: "fixture-p", challengeId: "fixture-c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
    statement: { text: "每米彩带2.4元，买0.3米需要多少元？", revision: 0, confirmed: true } },
  phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
if (!(await store.save(fixture, null)).ok || !(await store.save({ ...fixture, revision: 1, eventId: "fixture-confirmed-e" }, 0)).ok) throw Error("fixtureSeedFailed");
const app = Fastify({ bodyLimit: 8 * 1024 * 1024 }); await app.register(websocket);
registerWorkspaceRoutes(app, store);
app.get("/fixture/audio/:index", async (_request, reply) => reply.type("application/octet-stream").send(Buffer.alloc(6400)));
let calls = 0, connections = 0, childReplies = 0, resumptions = 0;
app.addHook("onRequest", async request => { if (request.url === "/tutor/workspace") console.log(JSON.stringify({ type: "fixture-connection", number: ++connections })); });
registerWorkspaceVoice(app, store, () => ({ close() {}, transcribe: async () => "看看我的想法，我先估计会比2.4元少。",
  respond: async (_pcm, instructions, _image, audio) => { audio(Buffer.alloc(2400)); return instructions.split("只逐字读这句话：")[1]!.trim(); } }), undefined,
  { decide: async input => {
    console.log(JSON.stringify({ type: "fixture-decision", number: ++calls, history: input.history.length }));
    if (calls === 1) throw Error("decisionNeedsReview");
    const returning = !!input.child && ++childReplies > 1;
    const utterance = input.child
      ? ["你估计会少一些，准备怎么核对？", "接下来按你的想法试试看。", "这次先独立试试，保留自己的想法。", "继续自己的尝试就好。"][childReplies - 1]!
      : ["接着刚才的估计，你还想讨论什么？", "你刚才的想法还在，想从哪里接着聊？"][resumptions++]!;
    return { problemId: input.record.problem!.problemId, problemRevision: 0, turnId: input.turnId,
      responseId: input.responseId, child: input.child, focus: returning ? "return" : "clarify", observation: "本轮具体数量关系", evidenceIds: [input.turnId],
      utterance, method: "ordinary", handoff: returning, resolved: [] };
  } }, true);
console.log(JSON.stringify({ address: await app.listen({ host: "0.0.0.0", port: Number(portText) }), simulatedDecision: true, modelCalls: 0 }));
