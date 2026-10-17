import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceRoutes } from "../src/ai/workspace-route.js";

test("观察照片后由孩子提出问题，无需OCR或模型，确认前不进入讲解", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "own-question-"));
  const store = new WorkspaceStore({ directory });
  const app = Fastify(); let recognized = false;
  registerWorkspaceRoutes(app, store, { recognize: async () => { recognized = true; throw Error("must not call"); } });
  try {
    const initial = (await app.inject({ method: "POST", url: "/workspace/sessions" })).json();
    const id = initial.sessionId;
    const photoId = await store.saveMedia(id, "photo", "problemPhoto", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZa8AAAAASUVORK5CYII=", "base64"));
    const body = { eventId: "my-question", expectedRevision: 0, photoId,
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" },
      text: "照片里的果汁按升卖，买半升要付多少？" };
    const send = (payload: object) => app.inject({ method: "POST", url: `/workspace/${id}/question`, payload });
    expect((await send({ ...body, photoId: "missing" })).statusCode).toBe(409);
    const response = await send(body);
    expect(response.statusCode, response.body).toBe(201);
    const record = response.json();
    expect(record.problem.statement).toEqual({ text: body.text, revision: 0, confirmed: false });
    expect(record.problem.photoId).toBe(photoId);
    expect(record.phase).toBe("confirming");
    expect(record.feedback).toEqual([]);
    expect(recognized).toBe(false);
    expect((await send(body)).json().problem.problemId).toBe(record.problem.problemId);
    expect((await send({ ...body, text: "换个问题" })).statusCode).toBe(409);
    expect((await send({ ...body, curriculum: { ...body.curriculum, grade: 6 } })).statusCode).toBe(400);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
