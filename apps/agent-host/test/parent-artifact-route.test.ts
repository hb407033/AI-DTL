import { expect, test } from "vitest";
import { buildHostServers } from "../src/server.js";

test("作品原始证据仅家长授权通道可查看，未知作品404", async () => {
  const { childApp, parentApp, ledger } = await buildHostServers({ bridge: "parent", dataDir: null, parentToken: "test" });
  try {
    ledger!.sessionPort().ingestArtifactVersion({ learnerId: "child-1", artifactId: "art", artifactVersionId: "v1", sessionId: "s1", discipline: "math", versionNo: 1, writer: "host_snapshot", contentRef: "session:s1", contentHash: "hash", payload: {} });
    const headers = { "x-parent-token": "test" };
    expect((await parentApp.inject("/parent/artifacts/art")).statusCode).toBe(401);
    const result = await parentApp.inject({ url: "/parent/artifacts/art", headers });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ previewAvailable: false, events: [], versions: [{ content_ref: "session:s1" }] });
    expect((await parentApp.inject({ url: "/parent/artifacts/unknown", headers })).statusCode).toBe(404);
    for (const url of ["/parent/artifacts/art", "/parent/growth/pending"]) expect((await childApp.inject({ url, headers })).statusCode).toBe(404);
  } finally { await childApp.close(); }
});
