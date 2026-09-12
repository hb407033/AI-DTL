// apps/agent-host/src/server.ts
// Mac mini 宿主：家庭局域网明文 HTTP + ws://（用户裁决，见设计稿 11.4）。
// 儿童通道监听局域网 8788，家长通道仅监听回环 8789。每秒 tick 驱动窗口与超时。
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { z } from "zod";
import { InMemorySessionStore, ScriptedReplayBridge, SqliteSessionStore, GrowthLedgerService, FIRST_USE_NOTICE, type ReplayScript, type SessionStore } from "@ai-scholar/learning-kernel";
import { openLearningDatabase, type LearningDatabase } from "@ai-scholar/learning-kernel/database";
import { mathPlugin } from "@ai-scholar/plugin-math";
import { canvasActionSchema } from "@ai-scholar/session-contracts";
import { createSessionHost } from "./session-gateway.js";
import { CHILD_LISTEN, PARENT_LISTEN, createParentChannel, loadParentToken } from "./parent-channel.js";
import { registerGrowthRoutes } from "./growth-routes.js";
import { startRetentionJob } from "./retention-job.js";
export { CHILD_LISTEN, PARENT_LISTEN } from "./parent-channel.js";

export interface HostServerOptions {
  bridge: "parent" | "scripted";
  script?: ReplayScript | undefined;
  /** null = 内存库（测试）；undefined = 默认 ~/.ai-scholar */
  dataDir?: string | null | undefined;
  tickIntervalMs?: number | undefined;
  parentToken?: string | undefined;
  clock?: (() => number) | undefined;
  retentionIntervalMs?: number | undefined;
}

const parentInputSchema = z.object({
  spokenResponse: z.string(),
  learnerTask: z.string().min(1),
  hintLevel: z.number().int().min(0).max(5),
  canvasActions: z.array(canvasActionSchema).optional(),
});

/** 会话库与成长库同库同连接：删除一件作品要跨两侧原子完成，跨连接没有事务 */
function openStore(dataDir: string | null | undefined): { store: SessionStore; db: LearningDatabase | null } {
  if (dataDir === null) {
    const db = openLearningDatabase(":memory:");
    return { store: new SqliteSessionStore(db), db };
  }
  const dir = dataDir ?? process.env.AI_SCHOLAR_DATA_DIR ?? join(homedir(), ".ai-scholar");
  mkdirSync(dir, { recursive: true });
  const db = openLearningDatabase(join(dir, "agent-host.sqlite"));
  return { store: new SqliteSessionStore(db), db };
}

export async function buildHostServers(options: HostServerOptions) {
  const app = Fastify({ logger: { level: "info" } });
  const parentApp = createParentChannel(options.parentToken ?? loadParentToken());
  await app.register(websocket);
  const { store, db } = openStore(options.dataDir);
  const clock = options.clock ?? (() => Date.now());
  const ledger = db ? GrowthLedgerService.open({ db, clock }) : null;
  if (ledger) registerGrowthRoutes(app, parentApp, ledger);
  const stopRetention = ledger ? startRetentionJob({ sweepRetention: now => ledger.sweepRetention(now), clock, ...(options.retentionIntervalMs === undefined ? {} : { intervalMs: options.retentionIntervalMs }), onError: error => app.log.error({ err: error }, "成长记录保留期巡检失败") }) : () => {};
  const host = createSessionHost({
    plugin: mathPlugin, store, clock,
    learnerId: "child-1", ledger: ledger?.sessionPort(), assent: ledger?.assentPort(),
    makeBridge: (sessionId) => (options.bridge === "parent" ? host.parentBridge(sessionId) : new ScriptedReplayBridge(options.script ?? { scriptVersion: 1, turns: [] })),
  });
  const detachDeletion = ledger?.onDeletion(ids => host.invalidate(ids));
  const consoleHtml = readFileSync(new URL("./parent-console.html", import.meta.url), "utf8");

  app.get("/healthz", async () => ({ status: "ok", bridge: options.bridge }));
  app.get("/child/first-use", async () => ({ text: FIRST_USE_NOTICE, acknowledged: ledger?.childPort().firstUseAcknowledged("child-1") ?? false }));
  app.post("/child/first-use/acknowledge", async (_request, reply) => {
    if (!ledger) return reply.code(503).send({ error: "growthLedgerUnavailable" });
    ledger.childPort().acknowledgeFirstUse("child-1");
    return { acknowledged: true };
  });

  app.get("/session", { websocket: true }, async (socket, request) => {
    const sessionId = (request.query as { sessionId?: string }).sessionId ?? `session-${Date.now()}`;
    const send = (frames: unknown[]) => { for (const f of frames) socket.send(JSON.stringify(f)); };
    const unsubscribe = host.subscribe(sessionId, send);
    send(await host.open(sessionId));
    socket.on("message", async (raw: Buffer | string) => send(await host.handleFrame(sessionId, raw.toString(), Date.now())));
    socket.on("close", () => { unsubscribe(); host.onSocketClosed(sessionId); request.log.info({ sessionId }, "儿童端断开，教学暂停"); });
  });

  parentApp.get("/parent", async (_request, reply) => reply.type("text/html; charset=utf-8").send(consoleHtml));
  parentApp.get("/parent/sessions", async () => ({ sessions: host.sessionIds() }));
  parentApp.get("/parent/sessions/:id", async (request, reply) => {
    try { return host.parentView((request.params as { id: string }).id); } catch (error) { return reply.code(404).send({ error: String(error) }); }
  });
  parentApp.post("/parent/sessions/:id/proposal", async (request, reply) => {
    const parsed = parentInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      host.submitParentProposal((request.params as { id: string }).id, parsed.data);
      return { ok: true };
    } catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  parentApp.post("/parent/sessions/:id/tick", async (request) => { await host.tick((request.params as { id: string }).id, Date.now()); return { ok: true }; });

  const interval = setInterval(() => { for (const id of host.sessionIds()) void host.tick(id, Date.now()); }, options.tickIntervalMs ?? 1_000);
  app.addHook("onClose", async () => {
    clearInterval(interval);
    stopRetention();
    detachDeletion?.();
    host.dispose();
    try { await parentApp.close(); } finally { ledger?.close(); }
  });
  return { childApp: app, parentApp, host, ledger };
}

export async function buildHostServer(options: HostServerOptions) {
  return (await buildHostServers(options)).childApp;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const bridge = process.argv.includes("--scripted") ? "scripted" : "parent";
  const scriptIndex = process.argv.indexOf("--script");
  const script = scriptIndex >= 0 ? (JSON.parse(readFileSync(process.argv[scriptIndex + 1] ?? "", "utf8")) as ReplayScript) : undefined;
  const { childApp, parentApp } = await buildHostServers({ bridge, script });
  try {
    await parentApp.listen(PARENT_LISTEN);
    await childApp.listen(CHILD_LISTEN);
  } catch (error) { await childApp.close(); throw error; }
  childApp.log.info(`儿童端连 ws://<本机名>:${CHILD_LISTEN.port}/session，家长视图 http://127.0.0.1:${PARENT_LISTEN.port}/parent`);
}
