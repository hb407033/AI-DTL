// apps/agent-host/src/server.ts
// Mac mini 宿主：家庭局域网明文 HTTP + ws://（用户裁决，见设计稿 11.4）。
// /session 是儿童端通道；/parent/* 是家长控制台（只在 Mac 上看，不给孩子看）。每秒对所有会话 tick 一次驱动窗口与超时。
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { z } from "zod";
import { InMemorySessionStore, ScriptedReplayBridge, SqliteSessionStore, openLearningDatabase, type LearningDatabase, type ReplayScript, type SessionStore } from "@ai-scholar/learning-kernel";
import { mathPlugin } from "@ai-scholar/plugin-math";
import { canvasActionSchema } from "@ai-scholar/session-contracts";
import { createSessionHost } from "./session-gateway.js";

const PORT = 8788;

/** IPv4、IPv6 与 IPv4-mapped IPv6 三种回环写法 */
function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.");
}

export interface HostServerOptions {
  bridge: "parent" | "scripted";
  script?: ReplayScript | undefined;
  /** null = 内存库（测试）；undefined = 默认 ~/.ai-scholar */
  dataDir?: string | null | undefined;
  tickIntervalMs?: number | undefined;
}

const parentInputSchema = z.object({
  spokenResponse: z.string(),
  learnerTask: z.string().min(1),
  hintLevel: z.number().int().min(0).max(5),
  canvasActions: z.array(canvasActionSchema).optional(),
});

/** 会话库与成长库同库同连接：删除一件作品要跨两侧原子完成，跨连接没有事务 */
function openStore(dataDir: string | null | undefined): { store: SessionStore; db: LearningDatabase | null } {
  if (dataDir === null) return { store: new InMemorySessionStore(), db: null };
  const dir = dataDir ?? process.env.AI_SCHOLAR_DATA_DIR ?? join(homedir(), ".ai-scholar");
  mkdirSync(dir, { recursive: true });
  const db = openLearningDatabase(join(dir, "agent-host.sqlite"));
  return { store: new SqliteSessionStore(db), db };
}

export async function buildHostServer(options: HostServerOptions) {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(websocket);
  const { store, db } = openStore(options.dataDir);
  const host = createSessionHost({
    plugin: mathPlugin, store, clock: () => Date.now(),
    makeBridge: (sessionId) => (options.bridge === "parent" ? host.parentBridge(sessionId) : new ScriptedReplayBridge(options.script ?? { scriptVersion: 1, turns: [] })),
  });
  const consoleHtml = readFileSync(new URL("./parent-console.html", import.meta.url), "utf8");

  app.get("/healthz", async () => ({ status: "ok", bridge: options.bridge }));

  // 家长视图只在学习主机本机可达：iPad 与 Mac 同在家庭局域网，孩子端不得看到能力分析与技术状态（设计稿 8.1、11.2）。
  // 儿童端通道 /healthz 与 /session 不受影响，仍对局域网开放。
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/parent")) return;
    if (isLoopback(request.ip)) return;
    request.log.warn({ ip: request.ip, url: request.url }, "拒绝来自局域网其他设备的家长端请求");
    return reply.code(403).send({ error: "家长视图只能在学习主机本机打开" });
  });

  app.get("/session", { websocket: true }, async (socket, request) => {
    const sessionId = (request.query as { sessionId?: string }).sessionId ?? `session-${Date.now()}`;
    const send = (frames: unknown[]) => { for (const f of frames) socket.send(JSON.stringify(f)); };
    const unsubscribe = host.subscribe(sessionId, send);
    send(await host.open(sessionId));
    socket.on("message", async (raw: Buffer | string) => send(await host.handleFrame(sessionId, raw.toString(), Date.now())));
    socket.on("close", () => { unsubscribe(); host.onSocketClosed(sessionId); request.log.info({ sessionId }, "儿童端断开，教学暂停"); });
  });

  app.get("/parent", async (_request, reply) => reply.type("text/html; charset=utf-8").send(consoleHtml));
  app.get("/parent/sessions", async () => ({ sessions: host.sessionIds() }));
  app.get("/parent/sessions/:id", async (request, reply) => {
    try { return host.parentView((request.params as { id: string }).id); } catch (error) { return reply.code(404).send({ error: String(error) }); }
  });
  app.post("/parent/sessions/:id/proposal", async (request, reply) => {
    const parsed = parentInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      host.submitParentProposal((request.params as { id: string }).id, parsed.data);
      return { ok: true };
    } catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  app.post("/parent/sessions/:id/tick", async (request) => { await host.tick((request.params as { id: string }).id, Date.now()); return { ok: true }; });

  const interval = setInterval(() => { for (const id of host.sessionIds()) void host.tick(id, Date.now()); }, options.tickIntervalMs ?? 1_000);
  app.addHook("onClose", async () => { clearInterval(interval); db?.close(); });
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const bridge = process.argv.includes("--scripted") ? "scripted" : "parent";
  const scriptIndex = process.argv.indexOf("--script");
  const script = scriptIndex >= 0 ? (JSON.parse(readFileSync(process.argv[scriptIndex + 1] ?? "", "utf8")) as ReplayScript) : undefined;
  const app = await buildHostServer({ bridge, script });
  await app.listen({ host: "0.0.0.0", port: PORT });
  // 家长视图限本机：用 localhost 打开，换成 .local 主机名或局域网 IP 会被 403 挡掉
  app.log.info(`儿童端连 ws://<本机名>:${PORT}/session，家长视图只能在本机打开 http://localhost:${PORT}/parent`);
}
