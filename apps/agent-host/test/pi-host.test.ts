import { expect, test } from "vitest";
import WebSocket from "ws";
import { buildHostServers } from "../src/server.js";

test("Pi 桥接走现有 WebSocket 教学流程，不依赖千问 Key", async () => {
  const { childApp } = await buildHostServers({ bridge: "pi", dataDir: null, parentToken: "synthetic",
    pi: { config: { command: "pi", provider: "synthetic", model: "synthetic" }, runner: async () => JSON.stringify({ proposalId: "test", spokenResponse: "先看看乘数是大于1还是小于1？", learnerTask: "比较大小", hintLevel: 1, canvasActions: [], expectedEvidence: [] }) } });
  let socket: WebSocket | undefined;
  try {
    const base = await childApp.listen({ host: "127.0.0.1", port: 0 });
    expect((await childApp.inject("/healthz")).json()).toEqual({ status: "ok", bridge: "pi" });
    socket = new WebSocket(base.replace("http:", "ws:") + "/session?sessionId=pi-test");
    const messages: Array<{ message?: { type: string; text?: string } }> = [];
    socket.on("message", data => messages.push(JSON.parse(data.toString())));
    await new Promise<void>(resolve => socket!.once("open", resolve));
    await expect.poll(() => messages.length).toBeGreaterThanOrEqual(2);
    socket.send(JSON.stringify({ protocolVersion: 1, type: "event", id: "p1", sessionId: "pi-test", clientSeq: 1, sentAt: 1,
      event: { eventId: "p1", clientSessionId: "pi-test", deviceId: "test", clientSeq: 1, occurredAt: 1, quality: "confirmed", source: "child_button", semanticObjectIds: [], payload: { type: "HELP_REQUEST" } } }));
    await expect.poll(() => messages.some(x => x.message?.type === "speak" && x.message.text === "先看看乘数是大于1还是小于1？")).toBe(true);
  } finally { socket?.terminate(); await childApp.close(); }
});
