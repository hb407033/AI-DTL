// packages/learning-kernel/test/kernel-purity.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// 设计稿 14.5：通用内核源码出现学科标识符字面量即视为契约测试失败
// 区分大小写：`Math.max` 里的 Math 不是学科标识符
const FORBIDDEN = /\b(math|literature|decimal)\b|数学|文学|小数/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("内核纯净度", () => {
  test("packages/learning-kernel/src 不含学科字面量", () => {
    const offenders = walk(new URL("../src", import.meta.url).pathname)
      .filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")))
      .map((file) => file.split("/packages/")[1]);
    expect(offenders).toEqual([]);
  });
});
