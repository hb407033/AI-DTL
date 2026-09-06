import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { clientMessageSchema, serverMessageSchema, PROTOCOL_VERSION } from "../src/probe-protocol.js";

// 与 Swift 端 ProbeProtocolTests 共用同一份夹具，任何一端改字段都会在两边同时报错
const fixture = JSON.parse(readFileSync(new URL("../fixtures/probe-protocol-v1.json", import.meta.url), "utf8"));

describe("探针协议 v1 信封", () => {
  test("协议版本常量与夹具一致", () => {
    expect(PROTOCOL_VERSION).toBe(fixture.protocolVersion);
  });

  test("接受夹具中的全部客户端消息", () => {
    for (const msg of Object.values(fixture.clientToServer)) {
      expect(clientMessageSchema.parse(msg)).toEqual(msg);
    }
  });

  test("接受夹具中的全部服务端消息", () => {
    for (const msg of Object.values(fixture.serverToClient)) {
      expect(serverMessageSchema.parse(msg)).toEqual(msg);
    }
  });

  test("拒绝未知类型", () => {
    expect(() => clientMessageSchema.parse(fixture.rejected.unknownType)).toThrowError();
  });

  test("拒绝不匹配的主版本", () => {
    expect(() => clientMessageSchema.parse(fixture.rejected.wrongVersion)).toThrowError();
  });

  test("语义动作里的圆必须带 id 与 owner", () => {
    const bad = structuredClone(fixture.serverToClient.semanticAction);
    delete bad.action.circle.owner;
    expect(() => serverMessageSchema.parse(bad)).toThrowError();
  });
});
