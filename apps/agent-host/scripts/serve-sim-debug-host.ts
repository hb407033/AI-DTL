/** 模拟器调试宿主：真实路由、真实模型、隔离作品目录与端口；另起孩子音频夹具服务，由调试者按老师实际回复逐轮放入音频。 */
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { buildLearningTutor } from "../src/ai/learning-tutor.js";
import { loadQwenConfig } from "../src/ai/config.js";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { LearningSessionStore } from "../src/learning/learning-session-store.js";

const [directory, portText = "8797", audioPortText = "8798", bind = "127.0.0.1"] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory) || !directory.includes("acceptance")) throw Error("isolatedAcceptanceDirectoryRequired");
const audio = path.join(directory, "child-audio");
await fs.mkdir(audio, { recursive: true });
const workspaceStore = new WorkspaceStore({ directory: path.join(directory, "workspaces") });
const app = await buildLearningTutor(loadQwenConfig(), { store: new LearningSessionStore({ directory: path.join(directory, "sessions") }),
  workspaceStore, hostId: "00000000-0000-4000-8000-00000000d0bb" });
// 真机 UI 测试（FiveTopicPhotoLearningUITests）从同一端口的 /harness/audio/<case>/<index> 取孩子音频。
app.get("/harness/audio/:name/:index", async (request, reply) => {
  const { name, index } = request.params as { name: string; index: string };
  if (!/^[\w-]+$/.test(name) || !/^\d+$/.test(index)) return reply.code(400).send();
  try { await fs.access(path.join(audio, `${name}-end`)); return reply.code(204).send(); } catch { /* 未结束 */ }
  try { return reply.type("application/octet-stream").send(await fs.readFile(path.join(audio, `${name}-${index}.pcm`))); }
  catch { return reply.code(404).send(); }
});
// 真机题图：<验收目录>/child-audio/<name>-photo.jpg
app.get("/harness/photo/:name", async (request, reply) => {
  const { name } = request.params as { name: string };
  if (!/^[\w-]+$/.test(name)) return reply.code(400).send();
  try { return reply.type("image/jpeg").send(await fs.readFile(path.join(audio, `${name}-photo.jpg`))); }
  catch { return reply.code(404).send(); }
});
await app.listen({ host: bind, port: Number(portText) });
// GET /<case>/<index>：存在 <case>-<index>.pcm 返回 200；存在 <case>-end 返回 204；否则 404，App 会继续等待。
http.createServer(async (req, res) => {
  const [, name, index] = (req.url ?? "").split("?")[0]!.split("/");
  if (!name || !/^[\w-]+$/.test(name) || !index || !/^\d+$/.test(index)) { res.writeHead(400).end(); return; }
  try { await fs.access(path.join(audio, `${name}-end`)); res.writeHead(204).end(); return; } catch { /* 未结束 */ }
  try { const pcm = await fs.readFile(path.join(audio, `${name}-${index}.pcm`)); res.writeHead(200).end(pcm); }
  catch { res.writeHead(404).end(); }
}).listen(Number(audioPortText), bind);
console.log(JSON.stringify({ host: `127.0.0.1:${portText}`, audio: `http://127.0.0.1:${audioPortText}`, directory }));
