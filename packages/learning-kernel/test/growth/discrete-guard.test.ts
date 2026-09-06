import { describe, expect, test } from "vitest";
import { assertDiscreteOnly, findDiscreteViolations } from "../../src/growth/discrete-guard.js";

// 设计规范 9.1：第一版不保存模型随口生成的浮点置信度，只保存可解释的离散事实。
// 判定按「值」而不是猜键名——早先按 confidence|probability|score 之类子串扫，会把 probeId、probeFamilyId 全部误伤。
describe("离散守卫", () => {
  test("字符串字段不进浮点判定，计数字段照常通过", () => {
    expect(findDiscreteViolations({ probeFamilyId: "x", supportingChallenges: 2 })).toEqual([]);
  });

  test("0 到 1 之间的小数就是置信度的形状，一律拒", () => {
    expect(findDiscreteViolations({ confidence: 0.8 })).toEqual([{ path: "$.confidence", code: "ratioLike" }]);
  });

  test("probeId 不被误伤", () => {
    expect(findDiscreteViolations({ probeId: "p1" })).toEqual([]);
  });

  test("字段名声明为比率时整数也拒；scoreBand 是字符串照常通过", () => {
    expect(findDiscreteViolations({ scoreBand: "base" })).toEqual([]);
    expect(findDiscreteViolations({ qualityRatio: 3 })).toEqual([{ path: "$.qualityRatio", code: "declaredRatio" }]);
    expect(findDiscreteViolations({ successRate: 2 })[0]?.code).toBe("declaredRatio");
  });

  test("嵌套数组里的小数被找出来并给出完整路径", () => {
    expect(findDiscreteViolations({ a: [{ x: 1 }, { x: 0.33 }] })).toEqual([{ path: "$.a[1].x", code: "ratioLike" }]);
  });

  test("计数字段必须是非负整数", () => {
    expect(findDiscreteViolations({ supportingChallenges: -1 })).toEqual([{ path: "$.supportingChallenges", code: "negativeCount" }]);
    expect(findDiscreteViolations({ probesIssued: 1.5 })[0]?.code).toBe("nonInteger");
  });

  test("大于 1 的非整数也拒——它同样不是可解释的离散事实", () => {
    expect(findDiscreteViolations({ weight: 2.5 })).toEqual([{ path: "$.weight", code: "nonInteger" }]);
  });

  test("assertDiscreteOnly 抛错时带上全部违规路径", () => {
    expect(() => assertDiscreteOnly({ confidence: 0.8, nested: { rate2: 0.1 } })).toThrowError(/\$\.confidence/);
    expect(() => assertDiscreteOnly({ supportingChallenges: 3 })).not.toThrow();
  });

  test("布尔与 null 不进数值分支", () => {
    expect(findDiscreteViolations({ ok: true, missing: null, count: 0 })).toEqual([]);
  });
});
