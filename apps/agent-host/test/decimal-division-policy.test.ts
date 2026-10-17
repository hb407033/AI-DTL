import { expect, test } from "vitest";
import { spokenMath, divisionProgress, preciseDivide, decimalDivision } from "../src/learning/decimal-division-policy.js";

test("把数学原话用于核对而不改原题；只背口诀不等于解释商不变", () => {
  expect(spokenMath("二十五乘零点五等于十二点五")).toBe("25×0.5=12.5");
  expect(divisionProgress("12.5÷0.5", ["两个数都乘十，商不变。"])?.resolved).not.toContain("invariance");
  expect(divisionProgress("12.5÷0.5", ["总量和每一组都扩大十倍，能分的组数没变，所以商不变。"])?.next).toBe("place_value");
});
test("真实纠正与乘法等式决定是否继续核对，不从教师文字或旧图推断完成", () => {
  const reason = "总量和每一组都扩大十倍，能分的组数没变，所以商不变。";
  expect(divisionProgress("12.5÷0.5", [reason, "我改成二十五了。"])?.next).toBe("verify");
  expect(divisionProgress("12.5÷0.5", [reason, "我检查商的数位，二表示两个十，五表示五个一，中间不该写零，我改成二十五了。"])?.resolved).toContain("place_value");
  expect(divisionProgress("12.5÷0.5", [reason, "二十五乘零点五，算回十二点五。"])?.next).toBe("return");
  expect(divisionProgress("12.5÷0.5", [reason, "二十五乘零点五等于十三。"])?.next).not.toBe("return");
  expect(divisionProgress("4.8÷0.6", [reason, "八乘零点六等于四点八。"])?.next).toBe("return");
  expect(divisionProgress("12.5÷0.5", [reason, "二十五乘零点五等于十二点五。", "等等，我又算出二百零五了。"])?.next).toBe("place_value");
  expect(divisionProgress("12.5÷0.5", [reason, "二十五乘零点五等于十二点五。",
    "我自己试四点八除零点六，变成四十八除以六，算出八。八乘零点六等于四点八。"])?.next).toBe("return");
  expect(divisionProgress("12.5÷0.5", [reason, "二十五乘零点五等于十二点五。",
    "我自己试四点八除零点六，算出九。"])?.next).toBe("transfer");
});
test("preciseDivide 消除浮点误差：1.1÷0.1=11 而非 11.000000000000002", () => {
  expect(preciseDivide(1.1, 0.1)).toBe(11);
  expect(preciseDivide(0.3, 0.1)).toBe(3);
  expect(preciseDivide(7.7, 0.7)).toBe(11);
  expect(preciseDivide(12.5, 0.5)).toBe(25);
  expect(preciseDivide(4.8, 0.6)).toBe(8);
  expect(preciseDivide(48, 6)).toBe(8);
  expect(preciseDivide(1.5, 0.4)).toBe(3.75);
  expect(preciseDivide(10, 4)).toBe(2.5);
});
test("decimalDivision 用精确除法，浮点会出错的用例得到正确商", () => {
  expect(decimalDivision("1.1÷0.1")?.answer).toBe(11);
  expect(decimalDivision("0.3÷0.1")?.answer).toBe(3);
  expect(decimalDivision("7.7÷0.7")?.answer).toBe(11);
  expect(decimalDivision("12.5÷0.5")?.answer).toBe(25);
  expect(decimalDivision("4.8÷0.6")?.answer).toBe(8);
});
test("divisionProgress 在浮点敏感场景下正确判断孩子报告的商", () => {
  const reason = "总量和每一组都扩大十倍，能分的组数没变，所以商不变。";
  // 1.1÷0.1=11；浮点会得到 11.000000000000002，导致孩子说 11 被误判为错
  expect(divisionProgress("1.1÷0.1", [reason, "我算出十一了。"])?.reported).toBe(11);
  expect(divisionProgress("1.1÷0.1", [reason, "我算出十一了。"])?.next).toBe("verify");
});

// 2026-10-16 模拟器真实练习卷：孩子讲竖式中间步骤被误判为另举新题“10÷5”，整轮两次 nextFocus_transfer 作废。
test("竖式中间步骤和“商写在十位上”不是新题，也不是商；“应该是25”是改正后的结果", () => {
  const statement = "③ 12.5 ÷ 0.5 =\n先估：商比被除数（大/小），商大约是";
  const state = divisionProgress(statement, ["我把两个数都乘十，变成一百二十五除以五，我列竖式算出来二百零四。",
    "哦，一百二十五先看十二，十二个十除以五，商应该写在十位上，不是百位。中间那个零是多余的，应该是二十五。"]);
  expect(state?.transfer).toBeUndefined();
  expect(state?.reported).toBe(25);
  expect(divisionProgress(statement, ["我想换一道新题，十除以五。"])?.transfer).toMatchObject({ a: 10, b: 5 });
});
