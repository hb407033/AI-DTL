import { afterEach, beforeEach, expect, test } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerWorkspaceRoutes } from "../src/ai/workspace-route.js";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
let directory: string, app: FastifyInstance;
let recognizeCount = 0;
let recognitionResult = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "ai-dtl-api-"));
  recognizeCount = 0;
  recognitionResult = "每米彩带 2.4 元，买 0.3 米需要多少元？";
  app = Fastify(); registerWorkspaceRoutes(app, new WorkspaceStore({ directory }), {
    recognize: async () => { recognizeCount++; return recognitionResult; },
  });
  await app.ready();
});
afterEach(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

async function recognitionFixture() {
  const initial = (await app.inject({ method: "POST", url: "/workspace/sessions" })).json();
  const url = `/workspace/${initial.sessionId}`;
  const photoId = (await app.inject({ method: "POST", url: `${url}/media`, payload: { eventId: "photo", kind: "problemPhoto",
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN0AAAAASUVORK5CYII=" } })).json().mediaId;
  return { initial, url, payload: { eventId: "recognition", expectedRevision: 0, photoId,
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } } };
}

test.each(["请重新拍照，只拍一道题。", "我识别到这是一张包含多道数学题的图片。请先挑出想检查的题，再重新拍照。"])("识别说明不能生成题干：%s", async notice => {
  const { url, payload } = await recognitionFixture(); recognitionResult = notice;
  const response = await app.inject({ method: "POST", url: `${url}/recognize`, payload });
  expect(response.json()).toMatchObject({ status: "unreadable", candidates: [] });
  expect((await app.inject({ method: "GET", url })).json()).toMatchObject({ revision: 0, problem: null });
});

test("多题不替孩子选题；选择第二题后还需修改核对，旧版本确认失败", async () => {
  const { url, payload } = await recognitionFixture();
  recognitionResult = JSON.stringify({ status: "multiple", candidates: ["1. 2.4×0.3=?", "2. 3.6÷0.4=?"], message: "选择一道题" });
  const response = await app.inject({ method: "POST", url: `${url}/recognize`, payload });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ status: "multiple", candidates: ["1. 2.4×0.3=?", "2. 3.6÷0.4=?"] });
  expect((await app.inject({ method: "GET", url })).json().problem).toBeNull();
  const chosen = (await app.inject({ method: "POST", url: `${url}/question`, payload: { ...payload, text: "2. 3.6÷0.4=?" } })).json();
  expect(chosen.problem.statement).toMatchObject({ text: "2. 3.6÷0.4=?", confirmed: false });
  const edited = (await app.inject({ method: "POST", url: `${url}/statement`, payload: { eventId: "edit", expectedRevision: 1,
    problemId: chosen.problem.problemId, statementRevision: 0, text: "3.6÷0.6=?" } })).json();
  expect((await app.inject({ method: "POST", url: `${url}/confirm`, payload: { eventId: "old", expectedRevision: 2,
    problemId: chosen.problem.problemId, statementRevision: 0 } })).statusCode).toBe(409);
  const confirmed = await app.inject({ method: "POST", url: `${url}/confirm`, payload: { eventId: "confirm", expectedRevision: 2,
    problemId: chosen.problem.problemId, statementRevision: edited.problem.statement.revision } });
  expect(confirmed.json().problem.statement).toMatchObject({ text: "3.6÷0.6=?", confirmed: true });
  expect(recognizeCount).toBe(1);
});

test("结构化结果不能把说明夹在候选里，也不能静默吞掉坏候选而自动选题", async () => {
  const { url, payload } = await recognitionFixture();
  recognitionResult = JSON.stringify({ status: "multiple", candidates: ["2.4×0.3=?", "请重新拍照"], message: "" });
  expect((await app.inject({ method: "POST", url: `${url}/recognize`, payload })).statusCode).toBe(502);
  expect((await app.inject({ method: "GET", url })).json().problem).toBeNull();
});

test("旧错误说明禁止确认，已确认的错误说明可以保留原稿重新核对", async () => {
  const { initial, url, payload } = await recognitionFixture();
  const store = new WorkspaceStore({ directory });
  const problem = { source: "camera" as const, problemId: "legacy", photoId: payload.photoId, curriculum: payload.curriculum,
    statement: { text: "请重新拍照，只拍一道题。", revision: 0, confirmed: true } };
  await store.save({ ...initial, eventId: "legacy-save", revision: 1, problem, phase: "exploring", childInkBase64: "aW5r" }, 0);
  expect((await app.inject({ method: "POST", url: `${url}/confirm`, payload: { eventId: "bad-confirm", expectedRevision: 1,
    problemId: "legacy", statementRevision: 0 } })).statusCode).toBe(422);
  const repair = await app.inject({ method: "POST", url: `${url}/statement`, payload: { eventId: "repair", expectedRevision: 1,
    problemId: "legacy", statementRevision: 0, text: "30÷4=?" } });
  expect(repair.statusCode).toBe(200);
  expect(repair.json()).toMatchObject({ phase: "confirming", childInkBase64: "aW5r", problem: {
    photoId: payload.photoId, statement: { text: "30÷4=?", revision: 1, confirmed: false } } });
});
test("创建、保存和恢复完整原稿，冲突不假装成功", async () => {
  const create = await app.inject({ method: "POST", url: "/workspace/sessions" });
  expect(create.statusCode).toBe(201);
  const initial = create.json(); const url = `/workspace/${initial.sessionId}`;
  const record = { ...initial, eventId: "save-1", revision: 1, childInkBase64: "aW5r" };
  expect((await app.inject({ method: "PUT", url, payload: { expectedRevision: 0, record } })).json()).toMatchObject({ ok: true, savedRevision: 1 });
  expect((await app.inject({ method: "GET", url })).json()).toEqual(record);
  expect((await app.inject({ method: "PUT", url, payload: { expectedRevision: 0, record: { ...record, eventId: "conflict" } } })).statusCode).toBe(409);
  expect((await app.inject({ method: "PUT", url, payload: { expectedRevision: 0, record } })).statusCode).toBe(200);
});
test("删除有墓碑、坏媒体拒绝，不涉及云端", async () => {
  const initial = (await app.inject({ method: "POST", url: "/workspace/sessions" })).json();
  const url = `/workspace/${initial.sessionId}`;
  expect((await app.inject({ method: "POST", url: `${url}/media`, payload: { eventId: "m-1", kind: "preview", base64: "bm9wZQ==" } })).statusCode).toBe(400);
  expect((await app.inject({ method: "DELETE", url })).json()).toEqual({ ok: true });
  expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
  expect((await app.inject({ method: "PUT", url, payload: { expectedRevision: null, record: initial } })).statusCode).toBe(409);
});
test("识别先成为候选题意，确认绑定版本；重放不重复调用模型", async () => {
  const initial = (await app.inject({ method: "POST", url: "/workspace/sessions" })).json();
  const url = `/workspace/${initial.sessionId}`;
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN0AAAAASUVORK5CYII=";
  const media = (await app.inject({ method: "POST", url: `${url}/media`, payload: { eventId: "photo-e", kind: "problemPhoto", base64 } })).json();
  const payload = { eventId: "recognize-e", expectedRevision: 0, photoId: media.mediaId,
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } };
  const result = await app.inject({ method: "POST", url: `${url}/recognize`, payload });
  expect(result.statusCode).toBe(200);
  const candidate = result.json();
  expect(candidate.problem.statement.confirmed).toBe(false);
  expect((await app.inject({ method: "POST", url: `${url}/recognize`, payload })).json()).toEqual(candidate);
  expect(recognizeCount).toBe(1);
  expect((await app.inject({ method: "PUT", url, payload: { expectedRevision: 1, record: { ...candidate,
    revision: 2, eventId: "bypass", phase: "exploring", problem: { ...candidate.problem,
      statement: { ...candidate.problem.statement, confirmed: true } } } } })).statusCode).toBe(409);
  const confirm = { eventId: "confirm-e", expectedRevision: 1, problemId: candidate.problem.problemId, statementRevision: 99 };
  expect((await app.inject({ method: "POST", url: `${url}/confirm`, payload: confirm })).statusCode).toBe(409);
  const confirmed = await app.inject({ method: "POST", url: `${url}/confirm`, payload: { ...confirm, statementRevision: 0 } });
  expect(confirmed.json().problem.statement.confirmed).toBe(true);
  expect(confirmed.json().phase).toBe("exploring");
});

test("原照独立保留，模型用预览；修改候选递增版本且旧确认失效", async () => {
  const initial = (await app.inject({ method: "POST", url: "/workspace/sessions" })).json();
  const url = `/workspace/${initial.sessionId}`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN0AAAAASUVORK5CYII=", "base64");
  const original = Buffer.concat([png, Buffer.alloc(200000)]);
  const upload = async (eventId: string, kind: string, data: Buffer) => (await app.inject({ method: "POST", url: `${url}/media`, payload: { eventId, kind, base64: data.toString("base64") } })).json().mediaId;
  const photoId = await upload("original", "problemPhoto", original), previewId = await upload("preview", "preview", png);
  const candidate = await app.inject({ method: "POST", url: `${url}/recognize`, payload: { eventId: "recognize", expectedRevision: 0, photoId, previewId, curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } } });
  expect(candidate.statusCode).toBe(200);
  expect((await app.inject({ method: "GET", url: `${url}/media/${photoId}` })).rawPayload).toEqual(original);
  const problemId = candidate.json().problem.problemId;
  const edit = { eventId: "edit", expectedRevision: 1, problemId, statementRevision: 0, text: "每米彩带2.4元，买0.4米多少钱？" };
  const revised = await app.inject({ method: "POST", url: `${url}/statement`, payload: edit });
  expect(revised.statusCode).toBe(200);
  expect(revised.json().problem.statement).toEqual({ text: edit.text, revision: 1, confirmed: false });
  expect((await app.inject({ method: "POST", url: `${url}/statement`, payload: edit })).json()).toEqual(revised.json());
  expect((await app.inject({ method: "POST", url: `${url}/statement`, payload: { ...edit, text: "不同内容" } })).statusCode).toBe(409);
  expect((await app.inject({ method: "POST", url: `${url}/confirm`, payload: { eventId: "old", expectedRevision: 2, problemId, statementRevision: 0 } })).statusCode).toBe(409);
  expect(recognizeCount).toBe(1);
  expect((await app.inject({ method: "POST", url: `${url}/statement`, payload: { ...edit, eventId: "blank", text: "   " } })).statusCode).toBe(400);
  const confirmed = await app.inject({ method: "POST", url: `${url}/confirm`, payload: { eventId: "new-confirm", expectedRevision: 2, problemId, statementRevision: 1 } });
  expect(confirmed.statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: `${url}/statement`, payload: { ...edit, eventId: "after-confirm", expectedRevision: 3, statementRevision: 1 } })).statusCode).toBe(409);
});
