import { expect, test } from "vitest";
import { buildHostServers } from "../src/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("独立儿童 HTTP 不启动会话，严格校验请求且家长成长接口受 token 保护", async () => {
  const { childApp, parentApp, host } = await buildHostServers({ bridge: "parent", dataDir: null, parentToken: "test" });
  try {
    expect((await childApp.inject("/child/understanding")).statusCode).toBe(200);
    expect((await childApp.inject("/child/first-use-notice")).json()).toMatchObject({ version: 1, acknowledged: false });
    expect((await childApp.inject({ method: "POST", url: "/child/first-use-notice/ack", payload: { version: 1 } })).statusCode).toBe(200);
    expect((await childApp.inject({ method: "POST", url: "/child/contest", payload: { target: { kind: "session", id: "finished" } } })).statusCode).toBe(200);
    for (const url of ["/child/contest", "/child/deletion-preview", "/child/deletion-requests", "/child/first-use-notice/ack"]) {
      expect((await childApp.inject({ method: "POST", url, payload: { unexpected: true } })).statusCode).toBe(400);
    }
    expect(host.sessionIds()).toEqual([]);
    expect((await parentApp.inject("/parent/growth/pending")).statusCode).toBe(401);
    expect((await parentApp.inject({ url: "/parent/growth/pending", headers: { "x-parent-token": "test" } })).statusCode).toBe(200);
    expect((await parentApp.inject({ method: "POST", url: "/parent/growth/candidates/no/review", headers: { "x-parent-token": "test" }, payload: { decision: "approved", childFacingText: "rewrite" } })).statusCode).toBe(400);
    for (const action of ["narrow-scope", "downgrade", "retract"]) {
      expect((await parentApp.inject({ method: "POST", url: `/parent/growth/records/no/${action}`, headers: { "x-parent-token": "test" }, payload: { childFacingText: "rewrite" } })).statusCode).toBe(400);
    }
    for (const url of ["/parent/growth/records", "/parent/growth/trends", "/parent/growth/alerts", "/parent/growth/agent-view", "/parent/export"]) {
      expect((await parentApp.inject({ url, headers: { "x-parent-token": "test" } })).statusCode).toBe(200);
      expect((await childApp.inject({ url, headers: { "x-parent-token": "test" } })).statusCode).toBe(404);
    }
  } finally { await childApp.close(); }
});

test("删除影响预览先展示，申请处理通知可读；直接删除必须持有原预览时间", async () => {
  const { childApp, parentApp, ledger } = await buildHostServers({ bridge: "parent", dataDir: null, parentToken: "test" });
  const headers = { "x-parent-token": "test" };
  try {
    const subject = { subjectKind: "artifact", subjectId: "local-art" };
    ledger!.sessionPort().ingestArtifactVersion({ learnerId: "child-1", artifactId: "local-art", artifactVersionId: "local-art-v1", sessionId: "local-session", discipline: "math", versionNo: 1, writer: "host_snapshot", contentRef: "session:local-session", contentHash: "h", payload: {} });
    const preview = await childApp.inject({ method: "POST", url: "/child/deletion-preview", payload: subject });
    expect(preview.statusCode).toBe(200); expect(preview.json()).toMatchObject({ text: expect.any(String), preview: { removeArtifactVersionIds: 1 } });
    const requested = await childApp.inject({ method: "POST", url: "/child/deletion-requests", payload: subject });
    const requestId = requested.json().requestId;
    expect((await parentApp.inject({ method: "POST", url: `/parent/deletion-requests/${requestId}/resolve`, headers, payload: { decision: "rejected" } })).statusCode).toBe(200);
    const notifications = (await childApp.inject("/child/notifications")).json();
    expect(notifications).toHaveLength(1); expect(notifications[0].read).toBe(false);
    expect((await childApp.inject({ method: "POST", url: `/child/notifications/${notifications[0].notificationId}/read` })).statusCode).toBe(200);
    expect((await childApp.inject("/child/notifications")).json()[0].read).toBe(true);
    expect((await parentApp.inject({ method: "POST", url: "/parent/deletion", headers, payload: { ...subject, previewComputedAt: 0 } })).statusCode).toBe(409);
    const parentPreview = (await parentApp.inject({ url: "/parent/deletion-preview?subjectKind=artifact&subjectId=local-art", headers })).json();
    expect((await parentApp.inject({ method: "POST", url: "/parent/deletion", headers, payload: { ...subject, previewComputedAt: parentPreview.previewComputedAt } })).statusCode).toBe(200);
    expect((await childApp.inject("/child/understanding")).json().myArtifacts).toEqual([]);
  } finally { await childApp.close(); }
});

test("完成会话后和持久库恢复后，查看、异议、删除请求不产生新教学会话", async () => {
  const directory = mkdtempSync(join(tmpdir(), "child-ledger-http-"));
  let servers = await buildHostServers({ bridge: "scripted", dataDir: directory, parentToken: "test" });
  try {
    await servers.host.open("finished");
    let seq = 0;
    for (const payload of [
      { type: "UTTERANCE", text: "结果应该比 2.4 小" },
      { type: "UTTERANCE", text: "0.3 就是十分之三" },
      { type: "ANSWER", text: "0.72" },
      { type: "EXPLAIN", text: "因为 0.3 是十分之三，乘完只剩十分之三那么多，所以比 2.4 小" },
      { type: "ANSWER", text: "1.4" },
    ]) {
      seq++;
      await servers.host.handleFrame("finished", JSON.stringify({ protocolVersion: 1, type: "event", id: `e-${seq}`, clientSeq: seq, sessionId: "finished", sentAt: Date.now(), event: { eventId: `e-${seq}`, clientSessionId: "finished", deviceId: "ipad", clientSeq: seq, occurredAt: Date.now(), quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload } }), Date.now());
      await servers.host.idle("finished");
    }
    expect(servers.host.parentView("finished").state).toBe("COMPLETED");
    servers.ledger!.sessionPort().ingestArtifactVersion({ learnerId: "child-1", artifactId: "art-http", artifactVersionId: "art-http-v1", sessionId: "finished", discipline: "math", versionNo: 1, writer: "child_upload", contentRef: "local-art-http", contentHash: "hash", payload: {} });
    const check = async () => {
      const before = servers.host.sessionIds();
      expect((await servers.childApp.inject("/child/understanding")).statusCode).toBe(200);
      expect((await servers.childApp.inject({ method: "POST", url: "/child/contest", payload: { target: { kind: "session", id: "finished" } } })).statusCode).toBe(200);
      const request = await servers.childApp.inject({ method: "POST", url: "/child/deletion-requests", payload: { subjectKind: "artifact", subjectId: "art-http" } });
      expect(request.statusCode).toBe(200);
      expect((await servers.childApp.inject({ method: "POST", url: `/child/deletion-requests/${request.json().requestId}/withdraw` })).statusCode).toBe(200);
      expect(servers.host.sessionIds()).toEqual(before);
    };
    await check();
    await servers.childApp.close();
    servers = await buildHostServers({ bridge: "scripted", dataDir: directory, parentToken: "test" });
    expect(servers.host.sessionIds()).toEqual([]);
    await check();
  } finally { await servers.childApp.close(); rmSync(directory, { recursive: true, force: true }); }
});
