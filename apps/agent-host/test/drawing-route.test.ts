import { expect, test } from "vitest";
import { buildHostServers } from "../src/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AppKit 编码的完整 1×1 RGBA PNG，非仅伪造签名。
const preview = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAADa6r/EAAAAC0lEQVQIHWNgAAIAAAUAAY27m/MAAAAASUVORK5CYII=";

test("原笔迹上传幂等、恢复、家长预览和删除禁止复活", async () => {
  const { childApp, parentApp, ledger, host } = await buildHostServers({ bridge: "parent", dataDir: null, parentToken: "test" });
  try {
    await host.open("drawing-test");
    const payload = { revision: "rev-1", drawing: Buffer.from("opaque-pencilkit").toString("base64"), preview };
    const url = "/child/sessions/drawing-test/drawing";
    const put = () => childApp.inject({ method: "PUT", url, payload });
    const saved = await put();
    expect(saved.statusCode).toBe(200);
    expect((await put()).json()).toEqual(saved.json());
    expect((await childApp.inject({ method: "PUT", url, payload: { ...payload, drawing: Buffer.from("other").toString("base64") } })).statusCode).toBe(409);
    expect((await childApp.inject(url)).json()).toMatchObject(payload);
    const next = { ...payload, revision: "rev-2", drawing: Buffer.from("newer-pencilkit").toString("base64") };
    expect((await childApp.inject({ method: "PUT", url, payload: next })).statusCode).toBe(200);
    await put();
    expect((await childApp.inject(url)).json()).toMatchObject(next);
    expect((await childApp.inject({ method: "PUT", url: "/child/sessions/unknown/drawing", payload })).statusCode).toBe(404);
    ledger!.sessionPort().ingestArtifactVersion({ learnerId: "other-child", artifactId: "other", artifactVersionId: "other-v1", sessionId: "other-session", discipline: "math", versionNo: 1, writer: "host_snapshot", contentRef: "session:other-session", contentHash: "hash", payload: {} });
    expect((await childApp.inject({ method: "PUT", url: "/child/sessions/other-session/drawing", payload })).statusCode).toBe(404);
    expect((await childApp.inject({ method: "PUT", url, payload: { ...payload, revision: "bad", preview: "bad" } })).statusCode).toBe(400);
    const truncated = Buffer.from(preview, "base64").subarray(0, 24).toString("base64");
    expect((await childApp.inject({ method: "PUT", url, payload: { ...payload, revision: "bad-header", preview: truncated } })).statusCode).toBe(400);
    const corrupt = Buffer.from(preview, "base64"); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    expect((await childApp.inject({ method: "PUT", url, payload: { ...payload, revision: "bad-crc", preview: corrupt.toString("base64") } })).statusCode).toBe(400);
    const artifactId = saved.json().artifactId;
    const previewUrl = `/parent/artifacts/${artifactId}/drawing-preview`;
    expect((await parentApp.inject(previewUrl)).statusCode).toBe(401);
    expect((await parentApp.inject({ url: previewUrl, headers: { "x-parent-token": "test" } })).headers["content-type"]).toBe("image/png");
    const parent = ledger!.parentPort(), subject = { kind: "artifact" as const, id: artifactId };
    parent.executeDeletion("child-1", subject, parent.deletionPreview("child-1", subject).preview);
    expect((await childApp.inject(url)).statusCode).toBe(410);
    expect((await put()).statusCode).toBe(410);
    expect((await parentApp.inject({ url: previewUrl, headers: { "x-parent-token": "test" } })).statusCode).toBe(404);
  } finally { await childApp.close(); }
});

test("临时文件SQLite重启后真实回环HTTP恢复逐字节一致", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scholar-drawing-"));
  let servers = await buildHostServers({ bridge: "parent", dataDir: directory, parentToken: "test" });
  try {
    await servers.host.open("restart-drawing");
    const base = await servers.childApp.listen({ host: "127.0.0.1", port: 0 });
    const payload = { revision: "persistent", drawing: Buffer.from("original-binary\u0000").toString("base64"), preview };
    const saved = await fetch(`${base}/child/sessions/restart-drawing/drawing`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    expect(saved.status).toBe(200);
    await servers.childApp.close();
    servers = await buildHostServers({ bridge: "parent", dataDir: directory, parentToken: "test" });
    const restarted = await servers.childApp.listen({ host: "127.0.0.1", port: 0 });
    const restored = await fetch(`${restarted}/child/sessions/restart-drawing/drawing`);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject(payload);
  } finally { await servers.childApp.close(); rmSync(directory, { recursive: true, force: true }); }
});
