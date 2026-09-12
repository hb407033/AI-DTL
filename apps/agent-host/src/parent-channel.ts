import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

export const CHILD_LISTEN = { host: "0.0.0.0", port: 8788 } as const;
export const PARENT_LISTEN = { host: "127.0.0.1", port: 8789 } as const;

export function loadParentToken(directory = join(homedir(), ".ai-scholar")): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "parent-token");
  try { writeFileSync(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  chmodSync(path, 0o600);
  const token = readFileSync(path, "utf8").trim();
  if (!token) throw new Error("家长访问凭据文件为空");
  return token;
}

function isLoopback(ip: string): boolean {
  return ip === "::1" || /^(?:::ffff:)?127(?:\.(?:\d{1,3})){3}$/.test(ip);
}

export function createParentChannel(token: string) {
  if (!token.trim()) throw new Error("家长访问凭据不能为空");
  const app = Fastify({ logger: { level: "info", redact: ["req.headers.x-parent-token"] } });
  app.addHook("onRequest", async (request, reply) => {
    // 使用已匹配路由，避免 URL 编码或 query 改变鉴权判定。
    const pathname = request.routeOptions.url;
    if (pathname !== "/parent" && !pathname?.startsWith("/parent/")) return;
    if (!isLoopback(request.ip)) return reply.code(403).send({ error: "家长视图只能在学习主机本机打开" });
    // 页面仅提供静态壳，数据与操作接口均要求凭据。
    if ((request.method === "GET" || request.method === "HEAD") && pathname === "/parent") return;
    const supplied = request.headers["x-parent-token"];
    const expected = Buffer.from(token);
    const actual = Buffer.from(typeof supplied === "string" ? supplied : "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return reply.code(401).send({ error: "需要有效的家长访问凭据" });
    }
  });
  return app;
}
