// 阶段 0 家庭局域网网关：明文 HTTP + ws://，只在家庭局域网使用，不配置 TLS、配对与令牌（用户裁决，见计划 §0）。
// 只做两件事：/healthz 让 iPad 与 curl 确认连通；/probe 按探针协议回 ack、nack 与语义动作。
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { PROTOCOL_VERSION, clientMessageSchema } from "@ai-scholar/gate-contracts";
import { createProbeSession, handleClientMessage } from "./probe-protocol.js";

const PORT = 8787;

export async function buildServer() {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(websocket);

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/probe", { websocket: true }, (socket, request) => {
    const session = createProbeSession();
    request.log.info({ ip: request.ip }, "probe 连接建立");
    socket.on("message", (raw: Buffer | string) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: "error", reason: "invalidJson" }));
        return;
      }
      const parsed = clientMessageSchema.safeParse(json);
      if (!parsed.success) {
        const id = typeof json === "object" && json !== null && "id" in json && typeof json.id === "string" ? json.id : undefined;
        socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: "error", reason: "unknownType", ...(id ? { id } : {}) }));
        return;
      }
      const { replies } = handleClientMessage(session, parsed.data, Date.now());
      for (const reply of replies) socket.send(JSON.stringify(reply));
    });
    socket.on("close", () => request.log.info({ lastConfirmedSeq: session.lastConfirmedSeq }, "probe 连接关闭"));
  });

  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const app = await buildServer();
  await app.listen({ host: "0.0.0.0", port: PORT });
}
