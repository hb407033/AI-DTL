import { expect, test } from "vitest";
import { evaluateTier1Gate } from "../../src/growth/gate-rules.js";

const input = { artifactId: "a", versionNo: 1, contentRef: "local/a", contentHash: "hash", writer: "child_upload" as const, payload: { text: "我今天有点粗心" } };
test("原始作品无需同意，也不筛查孩子原话", () => {
  expect(evaluateTier1Gate(input)).toEqual({ ok: true, failures: [] });
});
test.each(["claim", "counts", "hypothesisKeys", "status"])("档 1 拒绝结论键 %s", (key) => {
  expect(evaluateTier1Gate({ ...input, payload: { nested: [{ [key]: "结论" }] } }).failures).toContain("t1.noCapabilityClaim");
});
test("同时报告结论和内容引用缺失", () => {
  expect(evaluateTier1Gate({ ...input, contentRef: "", payload: { claim: "结论" } }).failures).toEqual(["t1.noCapabilityClaim", "t1.hasContentRef"]);
});
