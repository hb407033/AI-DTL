import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PERSONA_PATTERNS, screenChildFacingText } from "../../src/growth/forbidden-labels.js";

// 设计规范 9.4：不得保存「粗心」「没天赋」「不擅长数学」「阅读理解差」等人格化、永久化判断。
// 内核词表只写人格化谓词与结构模式，一个领域名都不能有——否则会撞上内核纯净度检查。
const fields = (patch: Partial<Parameters<typeof screenChildFacingText>[0]> = {}) => ({
  childFacingText: "", evidenceSummaryText: "", targetObjectLabel: "", scopeLabel: "", ...patch,
});

describe("禁止标签筛查", () => {
  test("人格化谓词逐条命中内核词表", () => {
    for (const word of ["粗心", "马虎", "没天赋", "注意力不集中", "老走神", "习惯差"]) {
      expect(screenChildFacingText(fields({ childFacingText: `他有点${word}` }), []).length).toBeGreaterThan(0);
    }
  });

  test("「不擅长某某」按结构模式命中，词表里没有任何领域名", () => {
    expect(screenChildFacingText(fields({ childFacingText: "不擅长这类题" }), [])).not.toEqual([]);
    expect(screenChildFacingText(fields({ childFacingText: "他阅读理解差" }), [])).not.toEqual([]);
    expect(screenChildFacingText(fields({ childFacingText: "总是错" }), [])).not.toEqual([]);
    expect(screenChildFacingText(fields({ childFacingText: "从来不检查" }), [])).not.toEqual([]);
    for (const pattern of PERSONA_PATTERNS) expect(pattern).not.toMatch(/数学|文学|小数|math|literature|decimal/i);
  });

  test("四段孩子会看到的文字都被扫到，命中项指明是哪一段", () => {
    for (const field of ["childFacingText", "evidenceSummaryText", "targetObjectLabel", "scopeLabel"] as const) {
      const hits = screenChildFacingText(fields({ [field]: "有点粗心" }), []);
      expect(hits.map((h) => h.field)).toEqual([field]);
    }
  });

  test("插件词表只作补充：传空数组时内核词表照样生效，插件模式额外生效", () => {
    expect(screenChildFacingText(fields({ childFacingText: "粗心" }), [])).not.toEqual([]);
    expect(screenChildFacingText(fields({ childFacingText: "位值没概念" }), [])).toEqual([]);
    expect(screenChildFacingText(fields({ childFacingText: "位值没概念" }), ["位值没概念"])).not.toEqual([]);
  });

  test("干净的儿童版描述不被误伤", () => {
    const clean = fields({
      childFacingText: "换了数字的这种题里，说清楚这一步为什么成立这件事，你自己做出来了 2 次。",
      evidenceSummaryText: "我看到的是：一共 3 次这样的题，其中 2 次你一点提示都没用。",
      targetObjectLabel: "换了数字的这种题", scopeLabel: "这一族题目",
    });
    expect(screenChildFacingText(clean, [])).toEqual([]);
  });

  test("筛查的入参只有系统生成的四段，结构上就碰不到孩子自己写的内容", () => {
    // 孩子在画布上写「我今天有点粗心」不能让作品存不进档 1：词表只作用于系统结论
    expect(Object.keys(fields())).toEqual(["childFacingText", "evidenceSummaryText", "targetObjectLabel", "scopeLabel"]);
  });
});

describe("成长层内核纯净度", () => {
  test("growth 目录下每个源码文件（含中文注释）都不含学科字面量", () => {
    const dir = new URL("../../src/growth", import.meta.url).pathname;
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const full = join(d, n);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
    });
    const offenders = walk(dir).filter((f) => /\b(math|literature|decimal)\b|数学|文学|小数/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.split("/growth/")[1])).toEqual([]);
  });
});
