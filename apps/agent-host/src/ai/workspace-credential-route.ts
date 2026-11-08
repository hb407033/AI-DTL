// 家长在局域网用 6 位口令领取一次实时模型地址。文件里只有口令和过期时间，没有密钥。
// 密钥由进程内的配置读取，成功后立即删文件。不写日志。明文 HTTP 与现有 8791 宿主相同，不另开端口。
// 这只适合家长信任的家庭局域网，还没有达到可以对外发布的安全标准。不要把它说成安全传输。
import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const handoutName = "key-handout.json";
const bodySchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
const handoutSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/), expiresAt: z.string() });

export interface RealtimeCredential { apiKey: string; url: string }

type FailureWindow = { count: number; resetAt: number };
const failures = new Map<string, FailureWindow>();
const failureLimit = 8;
const failureWindowMs = 10 * 60 * 1000;

let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function sameCode(left: string, right: string): boolean {
  const a = Buffer.alloc(6);
  const b = Buffer.alloc(6);
  a.write(left.slice(0, 6));
  b.write(right.slice(0, 6));
  return timingSafeEqual(a, b) && left === right;
}

function limited(ip: string, now: number): boolean {
  const window = failures.get(ip);
  if (!window || now >= window.resetAt) return false;
  return window.count >= failureLimit;
}

function noteFailure(ip: string, now: number) {
  const window = failures.get(ip);
  if (!window || now >= window.resetAt) failures.set(ip, { count: 1, resetAt: now + failureWindowMs });
  else window.count += 1;
}

export function registerRealtimeCredentialRoute(app: FastifyInstance, options: {
  directory: string;
  loadCredential: () => RealtimeCredential | null;
  now?: () => number;
}) {
  const file = path.join(options.directory, handoutName);
  const now = options.now ?? Date.now;
  app.post("/workspace/credentials/realtime", { logLevel: "silent" }, async (req, reply) => {
    const ip = req.ip || "unknown";
    if (limited(ip, now())) return reply.code(429).header("cache-control", "no-store").send({ reason: "rateLimited" });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      noteFailure(ip, now());
      return reply.code(400).header("cache-control", "no-store").send({ reason: "invalidCode" });
    }
    return exclusive(async () => {
      if (limited(ip, now())) return reply.code(429).header("cache-control", "no-store").send({ reason: "rateLimited" });
      let raw: string;
      try { raw = await readFile(file, "utf8"); }
      catch { return reply.code(403).header("cache-control", "no-store").send({ reason: "rejected" }); }
      const handout = handoutSchema.safeParse(JSON.parse(raw));
      const expired = !handout.success || Date.parse(handout.data.expiresAt) <= now();
      if (expired) {
        await rm(file, { force: true });
        return reply.code(403).header("cache-control", "no-store").send({ reason: "rejected" });
      }
      if (!sameCode(parsed.data.code, handout.data.code)) {
        noteFailure(ip, now());
        return reply.code(403).header("cache-control", "no-store").send({ reason: "rejected" });
      }
      const credential = options.loadCredential();
      if (!credential?.apiKey || !credential.url) {
        return reply.code(503).header("cache-control", "no-store").send({ reason: "unavailable" });
      }
      const claimed = path.join(options.directory, `.${handoutName}.claimed`);
      await rename(file, claimed);
      await rm(claimed, { force: true });
      return reply.code(200).header("cache-control", "no-store").send({ apiKey: credential.apiKey, url: credential.url });
    });
  });
}

/** 测试和脚本共用的写入。调用方负责不把口令打进日志。 */
export async function writeKeyHandout(directory: string, code: string, expiresAt: string) {
  if (!/^\d{6}$/.test(code)) throw Error("invalidCode");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, handoutName);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify({ code, expiresAt }), { mode: 0o600 });
  await rename(tmp, file);
}
