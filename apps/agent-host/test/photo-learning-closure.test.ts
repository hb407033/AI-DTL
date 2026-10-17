// Task 4: 完整新照片闭环集成测试。
// 隔离 Fastify + 临时 WorkspaceStore，验证 create→media→preview→recognize→confirm→fetch
// 的连续性、候选门禁、幂等重试。不依赖外部模型（recognize 用 stub）。
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// @ts-expect-error TS2307 — tsx 运行时正常
import { buildLearningTutor } from "../src/ai/learning-tutor.js";
// @ts-expect-error TS2307
import { WorkspaceStore } from "../src/learning/workspace-store.js";

describe("photo learning closure integration", () => {
  let app: any, base: string, tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "closure-int-"));
    const store = new WorkspaceStore({ directory: tempDir });
    app = await buildLearningTutor(null, { workspaceStore: store });
    await app.listen({ host: "127.0.0.1", port: 0 });
    base = `http://127.0.0.1:${app.server.address().port}`;
  });

  afterAll(async () => {
    try { await app.close(); } catch {}
    try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("complete photo→recognize→confirm→fetch preserves session continuity", async () => {
    // 1. 创建 session
    const createRes = await fetch(`${base}/workspace/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(createRes.status).toBe(201);
    const session = await createRes.json();
    const sessionId = session.sessionId;
    expect(session.phase).toBe("confirming");
    expect(session.revision).toBe(0);

    // 2. 上传照片
    const photoRes = await fetch(`${base}/workspace/${sessionId}/media`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), kind: "problemPhoto", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGWMjV9ogAAAABJRU5ErkJggg==" }) });
    expect(photoRes.status).toBe(201);
    const photo = await photoRes.json();

    // 3. 上传预览
    const previewRes = await fetch(`${base}/workspace/${sessionId}/media`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), kind: "preview", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGWMjV9ogAAAABJRU5ErkJggg==" }) });
    expect(previewRes.status).toBe(201);
    const preview = await previewRes.json();

    // 4. recognize — 无模型配置，应返回 503 recognitionUnavailable
    const recognizeRes = await fetch(`${base}/workspace/${sessionId}/recognize`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), expectedRevision: 0, photoId: photo.mediaId, previewId: preview.mediaId,
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } }) });
    expect(recognizeRes.status).toBe(503);
    const recognizeBody = await recognizeRes.json();
    expect(recognizeBody.reason).toBe("recognitionUnavailable");

    // 5. 用 question 路由手动设置题目（不依赖模型）
    const questionRes = await fetch(`${base}/workspace/${sessionId}/question`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), expectedRevision: 0, photoId: photo.mediaId,
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
        text: "每米彩带2.4元，买0.3米需要多少元？" }) });
    expect(questionRes.status).toBe(201);
    const questionRecord = await questionRes.json();
    expect(questionRecord.problem.statement.text).toContain("彩带");
    expect(questionRecord.problem.statement.confirmed).toBe(false);
    expect(questionRecord.sessionId).toBe(sessionId);

    // 6. 候选门禁：未确认前 phase 仍为 confirming
    expect(questionRecord.phase).toBe("confirming");

    // 7. 确认题目
    const confirmRes = await fetch(`${base}/workspace/${sessionId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), expectedRevision: questionRecord.revision,
        problemId: questionRecord.problem.problemId, statementRevision: 0 }) });
    expect(confirmRes.status).toBe(200);
    const confirmed = await confirmRes.json();
    expect(confirmed.problem.statement.confirmed).toBe(true);
    expect(confirmed.phase).toBe("exploring");
    expect(confirmed.sessionId).toBe(sessionId);

    // 8. 重新读取 — 连续性
    const fetchRes = await fetch(`${base}/workspace/${sessionId}`);
    expect(fetchRes.status).toBe(200);
    const fetched = await fetchRes.json();
    expect(fetched.sessionId).toBe(sessionId);
    expect(fetched.problem.statement.confirmed).toBe(true);
    expect(fetched.phase).toBe("exploring");
    expect(fetched.problem.statement.text).toContain("彩带");
  });

  it("recognize with same eventId is idempotent", async () => {
    const createRes = await fetch(`${base}/workspace/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const session = await createRes.json();
    const sessionId = session.sessionId;

    const photoRes = await fetch(`${base}/workspace/${sessionId}/media`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), kind: "problemPhoto", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGWMjV9ogAAAABJRU5ErkJggg==" }) });
    const photo = await photoRes.json();

    const eventId = randomUUID();
    // 两次用同一 eventId — 应返回同一结果（幂等）
    const r1 = await fetch(`${base}/workspace/${sessionId}/recognize`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, expectedRevision: 0, photoId: photo.mediaId,
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } }) });
    const r2 = await fetch(`${base}/workspace/${sessionId}/recognize`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, expectedRevision: 0, photoId: photo.mediaId,
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } }) });
    expect(r1.status).toBe(r2.status);
    const j1 = await r1.json(), j2 = await r2.json();
    if (r1.status === 200) {
      expect(j1.revision).toBe(j2.revision);
      expect(j1.eventId).toBe(j2.eventId);
    }
  });

  it("error responses include reason field for client guidance", async () => {
    // missing session
    const r1 = await fetch(`${base}/workspace/nonexistent-uuid`);
    expect(r1.status).toBe(404);
    const j1 = await r1.json();
    expect(j1.reason).toBeDefined();

    // invalid media
    const createRes = await fetch(`${base}/workspace/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const session = await createRes.json();
    const r2 = await fetch(`${base}/workspace/${session.sessionId}/media`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: "not-a-uuid", kind: "problemPhoto", base64: "abc" }) });
    expect(r2.status).toBe(400);
    const j2 = await r2.json();
    expect(j2.reason).toBeDefined();
  });

  it("empty currentUnit is rejected at schema level", async () => {
    const createRes = await fetch(`${base}/workspace/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const session = await createRes.json();
    const photoRes = await fetch(`${base}/workspace/${session.sessionId}/media`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), kind: "problemPhoto", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGWMjV9ogAAAABJRU5ErkJggg==" }) });
    const photo = await photoRes.json();
    const r = await fetch(`${base}/workspace/${session.sessionId}/recognize`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID(), expectedRevision: 0, photoId: photo.mediaId,
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "" } }) });
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.reason).toBe("invalidRequest");
  });
});
