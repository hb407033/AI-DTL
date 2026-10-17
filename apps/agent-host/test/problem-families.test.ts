import { expect, test } from "vitest";
import { parseProblem, solveProblem, decimalDivision, decimalMultiplication, treePlanting, parallelogramArea, oneStepEquation } from "../src/learning/families/index.js";

test("小数除法：解析和求解，用精确除法", () => {
  const p = decimalDivision.parse("12.5÷0.5");
  expect(p?.params).toEqual({ a: 12.5, b: 0.5 });
  expect(solveProblem(p!).answer).toBe(25);
  // 浮点敏感用例
  const p2 = decimalDivision.parse("1.1÷0.1");
  expect(solveProblem(p2!).answer).toBe(11);
  // 非小数除法不匹配
  expect(decimalDivision.parse("12÷5")).toBeUndefined();
});

test("小数乘法：解析和求解，用精确乘法", () => {
  const p = decimalMultiplication.parse("0.3×2.4");
  expect(p?.params).toEqual({ a: 0.3, b: 2.4 });
  expect(solveProblem(p!).answer).toBe(0.72);
  // 浮点敏感：0.1×0.2=0.02 而非 0.020000000000000004
  const p2 = decimalMultiplication.parse("0.1×0.2");
  expect(solveProblem(p2!).answer).toBe(0.02);
});

test("植树问题：两端都种加1，一端不种不加", () => {
  const p = treePlanting.parse("60米路每5米一棵，两端都种");
  expect(p?.params).toEqual({ length: 60, gap: 5, bothEnds: 1 });
  expect(solveProblem(p!).answer).toBe(13);
  const p2 = treePlanting.parse("60米路每5米一棵，一端栽一端不栽");
  expect(p2?.params.bothEnds).toBe(0);
  expect(solveProblem(p2!).answer).toBe(12);
});

test("平行四边形面积：底乘高", () => {
  const p = parallelogramArea.parse("底为8，高为3");
  expect(p?.params).toEqual({ base: 8, height: 3 });
  expect(solveProblem(p!).answer).toBe(24);
  const p2 = parallelogramArea.parse("底8高3");
  expect(solveProblem(p2!).answer).toBe(24);
});

test("一步方程：加减乘除四种", () => {
  expect(solveProblem(oneStepEquation.parse("x+7=21")!).answer).toBe(14);
  expect(solveProblem(oneStepEquation.parse("x-5=10")!).answer).toBe(15);
  expect(solveProblem(oneStepEquation.parse("3x=15")!).answer).toBe(5);
  expect(solveProblem(oneStepEquation.parse("x÷4=6")!).answer).toBe(24);
});

test("parseProblem 按顺序匹配，解析不了返回 undefined", () => {
  expect(parseProblem("12.5÷0.5")?.family).toBe("decimal-division");
  expect(parseProblem("0G0.3×2.4")?.family).toBe("decimal-multiplication");
  expect(parseProblem("60米路每5米一棵，两端都种")?.family).toBe("tree-planting");
  expect(parseProblem("底9")?.family ?? parseProblem("平行四边形底为8，高为3")?.family).toBe("parallelogram-area");
  expect(parseProblem("x+7=21")?.family).toBe("one-step-equation");
  expect(parseProblem("今天天气真好")).toBeUndefined();
});

test.each([
  ["每千克苹果3.6元买0.4千克", "decimal-multiplication", 1.44],
  ["5.4米彩带每段0.6米剪几段", "decimal-division", 9],
  ["60米小路一侧每隔5米栽一棵两端都栽", "tree-planting", 13],
  ["平行四边形底8高3斜边5面积", "parallelogram-area", 24],
  ["一本书x元买3本付50找8每本几元", "one-step-equation", 14],
])("真实题干 %s 可解析且有确定答案", (statement, family, answer) => {
  const parsed = parseProblem(statement);
  expect(parsed?.family).toBe(family);
  expect(solveProblem(parsed!).answer).toBe(answer);
});

test("多步方程保留系数与找零关系，不能截取成 x+8=50", () => {
  const parsed = parseProblem("3x+8=50");
  expect(parsed?.params).toEqual({ type: 5, a: 3, offset: 8, b: 50 });
  expect(solveProblem(parsed!).answer).toBe(14);
  expect(solveProblem(parsed!).steps.map(step => step.result)).toEqual([42, 14]);
  expect(solveProblem(parseProblem("2x-0.1=0.5")!).answer).toBe(0.3);
});

test("固定真实故事书题面保留买书与找零关系", () => {
  const statement = "一本故事书x元，买3本，付50元，找回8元。每本故事书多少元？";
  const parsed = parseProblem(statement);
  expect(parsed).toEqual({ family: "one-step-equation", statement, params: { type: 5, a: 3, offset: 8, b: 50 } });
  expect(solveProblem(parsed!)).toMatchObject({ answer: 14, precision: "exact" });
});

test("固定真实彩带题面识别米与彩带之间的的字", () => {
  const statement = "一根长5.4米的彩带，每段0.6米，可以剪成几段？";
  const parsed = parseProblem(statement);
  expect(parsed).toEqual({ family: "decimal-division", statement, params: { a: 5.4, b: 0.6 } });
  expect(solveProblem(parsed!)).toMatchObject({ answer: 9, precision: "exact" });
});

test.each([
  "一本故事书x元，买几本，付50元，找回8元。每本故事书多少元？",
  "一本故事书x元，买3本，付50元，没有说找回多少元。每本故事书多少元？",
  "一本故事书x元，买3本和一本练习本，付50元，找回8元。每本故事书多少元？",
  "一本故事书x元，买3本，另送一本，付50元，找回8元。每本故事书多少元？",
  "一本故事书x元，买3本，打折后付50元，找回8元。每本故事书多少元？",
  "一本故事书x元，买3本，优惠后付50元，找回8元。每本故事书多少元？",
  "一本故事书x元，买3本，付50元，找回8元，其中2元是运费。每本故事书多少元？",
  "一本数学书x元，买3本，付50元，找回8元。每本数学书多少元？",
  "一根长5.4米的彩带，每段长度未定，可以剪成几段？",
  "一根长5.4米的彩带，每段0.6米，可以剪成几段，还剩多少米？",
  "一根长5.4米的彩带，每段0.6米，另有1米彩带，可以剪成几段？",
  "一根长5.5米的彩带，每段0.6米，可以剪成几段？",
])("常见词形扩展仍拒绝缺条件或额外关系：%s", statement => {
  expect(parseProblem(statement)).toBeUndefined();
});

test.each([
  "三角形底8高3求面积", "底为8，高为3", "梯形底8高3求面积",
  "60米小路每隔5米栽一棵", "60米小路两侧每隔5米栽一棵两端都栽",
  "60米环形小路每隔5米栽一棵两端都栽", "61米小路每隔5米栽一棵两端都栽",
  "平行四边形底8斜边5求面积", "平行四边形底-8高3求面积",
  "每千克苹果3.6元买0.4千克和0.5千克", "5.4米彩带每段0.6米剪几段还剩多少米",
  "0x=5", "x÷0=4", "3x+8=50+2", "2x+3x=20", "0.3×2.4+1", "-0.3×2.4",
  "-60米小路每隔5米栽一棵两端都栽", "-5.4米彩带每段0.6米剪几段",
  "1e-3×2.4", "平行四边形底8高3求周长", "平行四边形底8厘米高3米求面积",
  "60米小路每隔5米栽一棵两端都栽，另外10米也栽树",
])("缺条件、矛盾或超出支持范围时不注入答案：%s", statement => {
  expect(parseProblem(statement)).toBeUndefined();
});

test("有限十进制的加减和科学记数参数不产生明显误差", () => {
  expect(solveProblem(oneStepEquation.parse("x+0.1=0.3")!).answer).toBe(0.2);
  expect(solveProblem(oneStepEquation.parse("x-0.1=0.2")!).answer).toBe(0.3);
  expect(solveProblem({ family: "decimal-multiplication", statement: "", params: { a: 1e-7, b: 0.3 } }).answer).toBe(3e-8);
  expect(solveProblem({ family: "decimal-division", statement: "", params: { a: 1e-7, b: 0.1 } }).answer).toBe(0.000001);
  expect(solveProblem({ family: "decimal-division", statement: "", params: { a: 1, b: 1024 } }).answer).toBe(0.0009765625);
});

test("非终止小数显式标记近似，有限小数标记精确", () => {
  const repeating = solveProblem({ family: "decimal-division", statement: "", params: { a: 1, b: 0.3 } });
  expect(repeating.answer).toBeCloseTo(10 / 3, 12);
  expect(repeating).toMatchObject({ precision: "approximate" });
  expect(solveProblem(parseProblem("0.1×0.2")!)).toMatchObject({ precision: "exact" });
});

test.each([
  ["decimal-division", { a: 1, b: 0 }],
  ["decimal-division", { a: 1 }],
  ["decimal-multiplication", { a: NaN, b: 2 }],
  ["decimal-multiplication", { a: Infinity, b: 2 }],
  ["decimal-multiplication", { a: 1e308, b: 1e308 }],
  ["decimal-multiplication", { a: "3", b: 2 }],
  ["tree-planting", { length: 61, gap: 5, bothEnds: 1 }],
  ["tree-planting", { length: 60, gap: 5, bothEnds: 2 }],
  ["parallelogram-area", { base: -8, height: 3 }],
  ["one-step-equation", { type: 9, a: 2, b: 4 }],
  ["one-step-equation", { type: 3, a: 0, b: 4 }],
  ["one-step-equation", { type: 5, a: 3, b: 50 }],
])("结构化参数非法时显式报错：%s %j", (family, params) => {
  expect(() => solveProblem({ family, statement: "", params: params as Record<string, number> })).toThrow("invalidProblemParameters");
});
