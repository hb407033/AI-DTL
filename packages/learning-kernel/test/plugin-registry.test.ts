// packages/learning-kernel/test/plugin-registry.test.ts
import { describe, expect, test } from "vitest";
import { PluginRegistry, type DisciplinePlugin } from "../src/plugin.js";
import { runPluginContract } from "../src/testing/plugin-contract.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

describe("插件注册表", () => {
  test("按 id 注册与取回；重复 id 拒绝", () => {
    const registry = new PluginRegistry();
    registry.register(fakePlugin);
    expect(registry.get("fake")).toBe(fakePlugin);
    expect(() => registry.register(fakePlugin)).toThrowError(/已注册/);
    expect(() => registry.get("nope")).toThrowError(/未注册/);
  });

  test("契约检查对合规的假插件全部通过", () => {
    const checks = runPluginContract(fakePlugin);
    expect(checks.filter((c) => !c.pass)).toEqual([]);
    expect(checks.map((c) => c.name)).toContain("discriminatingProbesSeparateHypotheses");
  });

  test("契约检查能抓住不分辨假设的探针", () => {
    const broken: DisciplinePlugin = {
      ...fakePlugin,
      discriminatingProbes: () => [{ id: "p", question: "会大还是会小？", outcomes: { a: [{ hypothesisId: "h1", direction: "supports" }], b: [{ hypothesisId: "h1", direction: "supports" }] }, samples: { a: ["大"], b: ["小"] } }],
    };
    expect(runPluginContract(broken).find((c) => c.name === "discriminatingProbesSeparateHypotheses")?.pass).toBe(false);
  });
});
