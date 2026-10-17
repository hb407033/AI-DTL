// Task 1: 复现新照片到学习会话的完整断点。
// 隔离 Fastify + 临时 WorkspaceStore，用公共合成图走真实 HTTP create→media→preview→recognize→confirm→fetch。
// 注入回执丢失，观察重试是否重复创建 session。记录每步 status/耗时/连续性，不打印凭据或家庭内容。
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error TS2307 — tsx 运行时正常
import { loadQwenConfig } from "../apps/agent-host/src/ai/config.js";
// @ts-expect-error TS2307
import { buildLearningTutor } from "../apps/agent-host/src/ai/learning-tutor.js";
// @ts-expect-error TS2307
import { WorkspaceStore } from "../apps/agent-host/src/learning/workspace-store.js";

const PHOTO_PATH = "docs/handoffs/evidence/2026-09-21-natural-loop/6cb4a11f-55b5-4cdc-9980-69ff19bc303e.jpg";
const RESULT_DIR = path.join(process.env.HOME ?? "", "Library/Application Support/ai-dtl/acceptance/photo-learning-closure");

function step(name, fn) {
  return async () => {
    const t0 = Date.now();
    try {
      const result = await fn();
      return { name, status: "ok", ms: Date.now() - t0, ...result };
    } catch (error) {
      return { name, status: "fail", ms: Date.now() - t0, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

async function main() {
  const repoRoot = process.argv[2] ?? process.cwd();
  const photo = await readFile(path.join(repoRoot, PHOTO_PATH));
  const tempDir = await mkdtemp(path.join(tmpdir(), "closure-probe-"));
  const store = new WorkspaceStore({ directory: tempDir });
  let config = null;
  try { config = loadQwenConfig(); } catch { console.log("[probe] 千问未配置，recognize 将返回 503"); }

  const app = await buildLearningTutor(config, { workspaceStore: store });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`[probe] 隔离主机 ${base}, store=${tempDir}`);

  const results = [];

  // ── 正常模式：照片 → 候选 → 确认 → 重新读取 ──
  const created = await step("create", async () => {
    const r = await fetch(`${base}/workspace/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    if (r.status !== 201) throw Error(`create ${r.status}: ${JSON.stringify(j)}`);
    return { sessionId: j.sessionId, revision: j.revision };
  })();
  results.push(created);
  if (created.status !== "ok") { await cleanup(app, tempDir); return report(results); }
  const { sessionId } = created;
  const root = `/workspace/${sessionId}`;

  const photoRes = await step("uploadPhoto", async () => {
    const r = await fetch(`${base}${root}/media`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), kind: "problemPhoto", base64: photo.toString("base64") }) });
    const j = await r.json();
    if (r.status !== 201) throw Error(`media ${r.status}: ${JSON.stringify(j)}`);
    return { mediaId: j.mediaId };
  })();
  results.push(photoRes);

  const previewRes = await step("uploadPreview", async () => {
    const r = await fetch(`${base}${root}/media`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), kind: "preview", base64: photo.toString("base64") }) });
    const j = await r.json();
    if (r.status !== 201) throw Error(`preview ${r.status}: ${JSON.stringify(j)}`);
    return { mediaId: j.mediaId };
  })();
  results.push(previewRes);

  const recognizeRes = await step("recognize", async () => {
    const r = await fetch(`${base}${root}/recognize`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), expectedRevision: 0, photoId: photoRes.mediaId, previewId: previewRes.mediaId,
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } }) });
    const j = await r.json();
    return { statusCode: r.status, confirmed: j.problem?.statement?.confirmed, text: j.problem?.statement?.text, revision: j.revision, reason: j.reason };
  })();
  results.push(recognizeRes);

  // 候选门禁
  if (recognizeRes.status === "ok" && recognizeRes.statusCode === 200) {
    if (recognizeRes.confirmed) results.push({ name: "candidateGate", status: "fail", error: "候选已 confirmed，跳过核对" });
    else results.push({ name: "candidateGate", status: "ok", ms: 0, text: recognizeRes.text });

    const confirmRes = await step("confirm", async () => {
      const r = await fetch(`${base}${root}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: randomUUID(), expectedRevision: recognizeRes.revision, problemId: recognizeRes.text ? undefined : undefined,
          statementRevision: 0 }) });
      const j = await r.json();
      return { statusCode: r.status, confirmed: j.problem?.statement?.confirmed, sessionId: j.sessionId, revision: j.revision, reason: j.reason };
    })();
    // Need problemId from recognize response — re-fetch
    const fetched = await fetch(`${base}${root}`);
    const fetchedJson = await fetched.json();
    const problemId = fetchedJson.problem?.problemId;
    const confirmRes2 = await step("confirmWithProblemId", async () => {
      const r = await fetch(`${base}${root}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: randomUUID(), expectedRevision: fetchedJson.revision, problemId, statementRevision: 0 }) });
      const j = await r.json();
      return { statusCode: r.status, confirmed: j.problem?.statement?.confirmed, sessionId: j.sessionId, revision: j.revision, reason: j.reason };
    })();
    results.push(confirmRes2);

    // 连续性检查
    if (confirmRes2.status === "ok" && confirmRes2.statusCode === 200) {
      const continuity = confirmRes2.sessionId === sessionId
        ? { name: "sessionContinuity", status: "ok", ms: 0, sessionId }
        : { name: "sessionContinuity", status: "fail", ms: 0, error: `confirm 返回不同 sessionId: ${confirmRes2.sessionId}` };
      results.push(continuity);

      const refetch = await step("refetch", async () => {
        const r = await fetch(`${base}${root}`);
        const j = await r.json();
        return { statusCode: r.status, sessionId: j.sessionId, confirmed: j.problem?.statement?.confirmed, phase: j.phase };
      })();
      results.push(refetch);
    }
  }

  // ── 故障注入 1：recognize 回执丢失后重试 ──
  // 客户端 uploadPhoto 每次创建新 session；模拟回执丢失后重试是否复用同一 session
  const retryProbe = await step("retryAfterLoss", async () => {
    // 模拟：用同一 eventId 再次 recognize（服务端幂等）
    const eventId = randomUUID();
    const r1 = await fetch(`${base}${root}/recognize`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, expectedRevision: 0, photoId: photoRes.mediaId, previewId: previewRes.mediaId,
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } }) });
    // 第二次用同一 eventId — 服务端应幂等返回同一记录
    const r2 = await fetch(`${base}${root}/recognize`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, expectedRevision: 0, photoId: photoRes.mediaId, previewId: previewRes.mediaId,
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } }) });
    const j1 = await r1.json(), j2 = await r2.json();
    return { firstStatus: r1.status, secondStatus: r2.status, sameRevision: j1.revision === j2.revision, sameEventId: j1.eventId === j2.eventId };
  })();
  results.push(retryProbe);

  // ── 故障注入 2：客户端重试创建新 session（复现当前 uploadPhoto 行为）──
  const newSessionProbe = await step("newSessionOnRetry", async () => {
    const r1 = await fetch(`${base}/workspace/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const r2 = await fetch(`${base}/workspace/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j1 = await r1.json(), j2 = await r2.json();
    return { session1: j1.sessionId, session2: j2.sessionId, different: j1.sessionId !== j2.sessionId };
  })();
  results.push(newSessionProbe);

  // ── 故障注入 3：缺单元时 recognize 反馈 ──
  // recognize 路由需要 curriculum.currentUnit；空字符串会被 zod 拒绝
  const missingUnitProbe = await step("missingUnit", async () => {
    const r = await fetch(`${base}${root}/recognize`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), expectedRevision: 0, photoId: photoRes.mediaId, previewId: previewRes.mediaId,
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "" } }) });
    const j = await r.json();
    return { statusCode: r.status, reason: j.reason };
  })();
  results.push(missingUnitProbe);

  // ── 故障注入 4：错误体是否包含 reason ──
  const errorBodyProbe = await step("errorBodyInspection", async () => {
    const r = await fetch(`${base}/workspace/nonexistent-session`, { method: "GET" });
    const j = await r.json();
    return { statusCode: r.status, hasReason: "reason" in j, reason: j.reason };
  })();
  results.push(errorBodyProbe);

  await cleanup(app, tempDir);
  report(results);
}

async function cleanup(app, tempDir) {
  try { await app.close(); } catch {}
  try { await rm(tempDir, { recursive: true, force: true }); } catch {}
}

function report(results) {
  console.log("\n═══ 探针结果 ═══");
  for (const r of results) {
    const tag = r.status === "ok" ? "✓" : "✗";
    const extra = Object.entries(r).filter(([k]) => !["name", "status", "ms", "error"].includes(k))
      .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : v}`).join(" ");
    console.log(`${tag} ${r.name} (${r.ms}ms) ${r.status === "fail" ? "ERROR: " + r.error : extra}`);
  }
  // 写结果到 acceptance 目录
  mkdir(RESULT_DIR, { recursive: true }).then(() => {
    const { writeFile } = require("node:fs/promises");
    return writeFile(path.join(RESULT_DIR, `probe-${Date.now()}.json`), JSON.stringify(results, null, 2));
  }).catch(() => {});
  const failures = results.filter(r => r.status === "fail");
  console.log(`\n${results.length} 项, ${results.length - failures.length} 通过, ${failures.length} 失败`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(e => { console.error("[probe] 致命错误:", e.message); process.exit(2); });
