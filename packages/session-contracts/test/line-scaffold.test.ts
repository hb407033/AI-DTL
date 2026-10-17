import { describe, expect, it } from "vitest";
import { lineScaffoldSchema, partitionQuantity } from "../src/line-scaffold.js";

const valid = { kind: "line", whole: "1", unit: "升", partitions: 2,
  meaning: "这条线表示一升果汁", sourceQuote: "我用这条线表示一升果汁。" };

describe("线段提示数量契约", () => {
  it("保留明确整体、单位和来源，不携带最终答案或任意绘图代码", () => {
    expect(lineScaffoldSchema.parse(valid)).toEqual(valid);
    expect(lineScaffoldSchema.safeParse({ ...valid, answer: "3.4" }).success).toBe(false);
  });
  it.each([
    { whole: "0" }, { whole: "-1" }, { whole: "NaN" }, { whole: "1e3" },
    { whole: "01" }, { whole: "0.0000001" }, { unit: "" }, { sourceQuote: "" },
    { partitions: 0 }, { partitions: 1.5 }, { partitions: 21 },
  ])("拒绝不可验证数量 %j", patch => {
    expect(lineScaffoldSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
  it("等分量用约分比例，不以浮点误差改变数学关系", () => {
    expect(partitionQuantity("0.3", 3)).toEqual({ numerator: 1, denominator: 10 });
    expect(partitionQuantity("1", 3)).toEqual({ numerator: 1, denominator: 3 });
    expect(partitionQuantity("6.8", 2)).toEqual({ numerator: 17, denominator: 5 });
    expect(() => partitionQuantity("1", 0)).toThrow();
  });
});
