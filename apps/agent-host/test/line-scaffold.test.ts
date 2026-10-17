import { describe, expect, it } from "vitest";
import { offerLineScaffold, consentToLineScaffold, generateLineScaffold, selectLineParts,
  hideLineScaffold, invalidateLineScaffold } from "../src/learning/line-scaffold.js";

const basis = { problemId: "p1", problemRevision: 0, submissionId: "s1", responseId: "r1" };
const line = { kind: "line" as const, whole: "1", unit: "升", partitions: 2,
  meaning: "一条线表示一升果汁", sourceQuote: "我用一条线表示一升果汁" };
const make = () => offerLineScaffold("offer-1", basis, line);
const agree = () => consentToLineScaffold(make(), "offer-1", basis);
const generated = () => generateLineScaffold(agree(), basis, line, [line.sourceQuote]);

describe("线段教学同意与失效边界", () => {
  it("没有孩子同意不生成；不同邀请或已修改题意不能借用同意", () => {
    expect(() => generateLineScaffold(make(), basis, line, [line.sourceQuote])).toThrow("consentRequired");
    expect(() => consentToLineScaffold(make(), "other", basis)).toThrow("staleOffer");
    expect(() => consentToLineScaffold(make(), "offer-1", { ...basis, problemRevision: 1 })).toThrow("staleBasis");
  });
  it("模型必须引用真实表达，且不能改变孩子同意的表示含义", () => {
    expect(() => generateLineScaffold(agree(), basis, line, ["另一句话"])).toThrow("missingSource");
    expect(() => generateLineScaffold(agree(), basis, { ...line, meaning: "一条线表示十升" }, [line.sourceQuote])).toThrow("meaningChanged");
    expect(generated().status).toBe("visible");
  });
  it("保留说明文字也不能偷换孩子同意的数量或单位", () => {
    expect(() => generateLineScaffold(agree(), basis, { ...line, whole: "10" }, [line.sourceQuote])).toThrow("quantityChanged");
    expect(() => generateLineScaffold(agree(), basis, { ...line, unit: "米" }, [line.sourceQuote])).toThrow("quantityChanged");
  });
  it("点选只改变提示探索状态，越界/重复编号不接受", () => {
    const before = generated();
    const after = selectLineParts(before, basis, [1]);
    expect(after.selectedParts).toEqual([1]);
    expect(before.selectedParts).toEqual([]);
    expect(() => selectLineParts(before, basis, [2])).toThrow("invalidSelection");
    expect(() => selectLineParts(before, basis, [0, 0])).toThrow("invalidSelection");
  });
  it("隐藏仍保留提示使用事实，但不允许隐藏时继续操作提示", () => {
    const hidden = hideLineScaffold(selectLineParts(generated(), basis, [0]));
    expect(hidden.status).toBe("hidden");
    expect(hidden.selectedParts).toEqual([0]);
    expect(hidden.line).toEqual(line);
    expect(() => selectLineParts(hidden, basis, [1])).toThrow("notVisible");
  });
  it("纠正撤销同意，阻止晚到生成/选择，原对象不被原地改写", () => {
    const pending = agree();
    const invalid = invalidateLineScaffold(pending);
    expect(invalid.status).toBe("invalidated");
    expect(pending.status).toBe("consented");
    expect(() => generateLineScaffold(invalid, basis, line, [line.sourceQuote])).toThrow("consentRequired");
    expect(() => consentToLineScaffold(invalid, "offer-1", basis)).toThrow("staleOffer");
    expect(() => selectLineParts(generated(), { ...basis, responseId: "r2" }, [0])).toThrow("staleBasis");
  });
});
