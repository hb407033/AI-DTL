import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  FRACTION_SCHEMA_VERSION,
  fractionBoardSchema,
  fractionEnvelopeSchema,
  fractionRectangleSchema,
  fractionSubmissionSchema,
} from "../src/index.js";

// 分数学习闭环共享夹具：Swift Codable 与宿主 TS 都必须原样解析合法样例、拒绝非法样例
const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/fraction-learning-v1.json", import.meta.url), "utf8"),
) as {
  envelopes: unknown[];
  rectangles: unknown[];
  boardStates: unknown[];
  submissions: unknown[];
  invalid: Record<string, unknown>;
};

describe("分数学习契约夹具", () => {
  test("合法 envelope 覆盖全部 7 种命令且都能解析", () => {
    const types = new Set(fixture.envelopes.map((e) => fractionEnvelopeSchema.parse(e).type));
    expect([...types].sort()).toEqual([
      "contest", "finishSession", "pause", "requestHelp", "resume", "startTransfer", "submit",
    ]);
  });

  test("交接清单中的契约示例原样解析", () => {
    const example = {
      schemaVersion: 1, sessionId: "fixture-session", eventId: "event-1",
      submissionId: "submission-1", revision: 3, type: "submit",
      payload: { challengeId: "fraction-compare-01", boardRevision: 3 },
    };
    const parsed = fractionEnvelopeSchema.parse(example);
    expect(parsed.schemaVersion).toBe(FRACTION_SCHEMA_VERSION);
    expect(parsed.type).toBe("submit");
  });

  test("合法矩形与画板状态都能解析", () => {
    for (const r of fixture.rectangles) expect(fractionRectangleSchema.parse(r).id).toBeTruthy();
    for (const b of fixture.boardStates) expect(fractionBoardSchema.parse(b).revision).toBeGreaterThanOrEqual(0);
  });

  test("迁移有提示的提交记录解析且 hintUsed 为 true", () => {
    const parsed = fixture.submissions.map((s) => fractionSubmissionSchema.parse(s));
    expect(parsed.some((s) => s.challengeId === "fraction-transfer-01" && s.hintUsed)).toBe(true);
  });

  test("拒绝越界格子、重复格子、超 60 格、零行与非法角色", () => {
    for (const key of ["cellOutOfRange", "duplicateCell", "tooManyCells", "zeroRows", "illegalOwner"]) {
      expect(() => fractionRectangleSchema.parse(fixture.invalid[key]), key).toThrowError();
    }
  });

  test("拒绝每层超过 4 个矩形与重复矩形 id", () => {
    expect(() => fractionBoardSchema.parse(fixture.invalid.tooManyChildRectangles)).toThrowError();
    expect(() => fractionBoardSchema.parse(fixture.invalid.duplicateRectangleIds)).toThrowError();
  });

  test("拒绝未知命令与错误 schemaVersion", () => {
    expect(() => fractionEnvelopeSchema.parse(fixture.invalid.unknownCommand)).toThrowError();
    expect(() => fractionEnvelopeSchema.parse(fixture.invalid.wrongSchemaVersion)).toThrowError();
  });
});
