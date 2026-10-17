/** 隔离的 UI 接线验收宿主：真实路由＋12秒迟到假决策，绝不调用模型或家庭数据。 */
import fs from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceRoutes } from "../src/ai/workspace-route.js";
import { registerWorkspaceVoice } from "../src/ai/workspace-voice-route.js";

const [directory, portText = "18791"] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory) || !directory.includes("acceptance")) throw Error("isolatedAcceptanceDirectoryRequired");
await fs.mkdir(directory, { recursive: true });
const store = new WorkspaceStore({ directory: path.join(directory, "workspaces") });
const fixture = { schemaVersion: 2 as const, sessionId: "fixture-confirmed-s", eventId: "fixture-seed", revision: 0,
  problem: { source: "curated", problemId: "fixture-p", challengeId: "fixture-c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
    statement: { text: "每米彩带2.4元，买0.3米需要多少元？", revision: 0, confirmed: true } },
  phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
const seeded = await store.save(fixture, null);
if (!seeded.ok) throw Error(`fixtureSeedFailed:${seeded.reason}`);
const confirmed = await store.save({ ...fixture, revision: 1, eventId: "fixture-confirmed-e" }, 0);
if (!confirmed.ok) throw Error(`fixtureConfirmationFailed:${confirmed.reason}`);
const app = Fastify({ bodyLimit: 8 * 1024 * 1024 }); await app.register(websocket);
registerWorkspaceRoutes(app, store);
registerWorkspaceVoice(app, store, () => ({ close() {}, transcribe: async () => "我想先自己想想。",
  respond: async () => { throw Error("cancelledDecisionMustNeverReachSpeech"); } }), undefined,
  { decide: async input => {
    console.log(JSON.stringify({ type: "thinking-fixture-start", time: Date.now(), turn: input.turnId }));
    // 故意忽略abort，检验真实路由能否挡住取消后的迟到结果。
    await new Promise(resolve => setTimeout(resolve, 12000));
    console.log(JSON.stringify({ type: "thinking-fixture-late-result", time: Date.now(), turn: input.turnId }));
    return { problemId: input.record.problem!.problemId, problemRevision: 0, turnId: input.turnId,
      responseId: input.responseId, child: "", focus: "clarify", observation: "尚未表达", evidenceIds: [input.turnId],
      utterance: "你想先从哪里试试？", method: "ordinary", handoff: false, resolved: [] };
  } }, true);
const address = await app.listen({ host: "0.0.0.0", port: Number(portText) });
console.log(JSON.stringify({ address, simulatedDecision: true, modelCalls: 0 }));
