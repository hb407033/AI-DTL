import { expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { registerWorkspaceRoutes } from "../src/ai/workspace-route.js";

test("作品列表分页可回望，跳过墓碑与损坏文件，不返回笔迹原文", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-portfolio-"));
  const store = new WorkspaceStore({ directory });
  const app = Fastify(); registerWorkspaceRoutes(app, store);
  try {
    for (const id of ["a", "b", "c"]) {
      await store.save({ schemaVersion: 2, sessionId: id, eventId: "initial", revision: 0,
        problem: null, phase: "confirming", childInkBase64: "", board: { revision: 0, rectangles: [] },
        submissions: [], feedback: [], openQuestions: [] }, null);
      await store.appendInquiry(id, { entryId: "question", kind: "question", author: "child", text: `我的问题 ${id}`, evidenceIds: [] }, 0);
    }
    await store.delete("b");
    await writeFile(path.join(directory, "damaged.json"), "not-json");
    const first = await app.inject({ method: "GET", url: "/workspace/sessions?limit=1" });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toEqual([{ sessionId: "a", title: "我的问题 a", revision: 0, inquiryCount: 1 }]);
    expect(first.json().nextCursor).toBe("a");
    const second = (await app.inject({ method: "GET", url: "/workspace/sessions?limit=1&after=a" })).json();
    expect(second.items.map((x: { sessionId: string }) => x.sessionId)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
    expect(second.unavailableCount).toBe(1);
    expect((await app.inject({ method: "GET", url: "/workspace/sessions?limit=10000" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/workspace/sessions?after=../bad" })).statusCode).toBe(400);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
