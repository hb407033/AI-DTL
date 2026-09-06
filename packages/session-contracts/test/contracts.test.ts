import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  childOutboundSchema, clientFrameSchema, evidenceEventSchema, serverFrameSchema, teachingProposalSchema,
} from "../src/index.js";

// 夹具是儿童端（将来 Swift）与宿主共用的协议样例；两端都必须能原样解析
const fixture = JSON.parse(readFileSync(new URL("../fixtures/session-protocol-v1.json", import.meta.url), "utf8")) as {
  events: unknown[]; proposals: unknown[]; outbound: unknown[]; clientFrames: unknown[]; serverFrames: unknown[];
};

describe("会话契约夹具", () => {
  test("夹具覆盖全部 15 种事件类型且都能解析", () => {
    const types = new Set(fixture.events.map((e) => evidenceEventSchema.parse(e).payload.type));
    expect([...types].sort()).toEqual([
      "ANSWER", "CONFIRM_TRANSCRIPT", "CONTEST", "DONE", "DRAG", "ERASE", "EXPLAIN", "HELP_REQUEST",
      "MEMORY_ASSENT", "PAUSE_REQUEST", "RESUME_REQUEST", "SELECT", "SOFT_LANDING_CHOICE", "STROKE", "UTTERANCE",
    ]);
  });
  test("教学提案、儿童端出站消息、两向帧都能解析", () => {
    for (const p of fixture.proposals) expect(teachingProposalSchema.parse(p).proposalId).toBeTruthy();
    for (const m of fixture.outbound) expect(childOutboundSchema.parse(m).type).toBeTruthy();
    for (const f of fixture.clientFrames) expect(clientFrameSchema.parse(f).type).toBe("event");
    for (const f of fixture.serverFrames) expect(serverFrameSchema.parse(f).protocolVersion).toBe(1);
  });
  test("拒绝越界提示级别与非 agent 所有权的画布对象", () => {
    expect(() => teachingProposalSchema.parse({ proposalId: "p", spokenResponse: "", learnerTask: "t", hintLevel: 6 })).toThrowError();
    expect(() => teachingProposalSchema.parse({
      proposalId: "p", spokenResponse: "", learnerTask: "t", hintLevel: 1,
      canvasActions: [{ kind: "upsertObject", object: { id: "o", owner: "child", kind: "label" } }],
    })).toThrowError();
  });
  test("事件的 clientSeq 必须是正整数", () => {
    const bad = { ...(fixture.events[0] as object), clientSeq: 0 };
    expect(() => evidenceEventSchema.parse(bad)).toThrowError();
  });
});
