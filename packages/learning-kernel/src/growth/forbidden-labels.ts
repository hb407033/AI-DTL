// 禁止标签筛查（设计规范 9.4）：不得保存人格化、永久化的判断。
// 词表只写人格化谓词与结构模式，不含任何领域名——一是内核纯净度检查会拦下领域名，
// 二是「不擅长某某」这种说法本来就该按结构拦，而不是靠穷举领域。领域专有的贬义说法由插件补充。
//
// 筛查对象只有系统生成、并且孩子会看到的四段文字。孩子自己写的内容（作品标题、他的原话）不在此列：
// 孩子在画布上写「我今天有点粗心」不能因此存不进作品库。

export const PERSONA_PATTERNS: readonly string[] = [
  "粗心", "马虎", "毛躁", "没天赋", "天生就", "笨", "蠢", "懒", "不用心", "不专心",
  "注意力不集中", "老走神", "态度不好", "习惯差",
  // 结构模式：不擅长 + 任意事物
  "不擅长[\\p{Script=Han}A-Za-z0-9]{1,8}",
  // 结构模式：某某（能力）差 / 弱 / 不行 / 不好
  "[\\p{Script=Han}]{2,8}(能力)?(差|弱|不行|不好)",
  "一直(都)?(不会|做不好)", "总是(错|不会)", "从来(都)?(不|没)", "永远(不|学不)",
];

export interface LabelHit {
  /** 命中在哪一段文字上 */
  field: "childFacingText" | "evidenceSummaryText" | "targetObjectLabel" | "scopeLabel";
  pattern: string;
}

export interface ChildFacingFields {
  childFacingText: string;
  evidenceSummaryText: string;
  targetObjectLabel: string;
  scopeLabel: string;
}

/** 把模式串编译成正则；插件的模式以字符串形式存放，才能随 manifest 序列化 */
export function compilePatterns(patterns: readonly string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, "u"));
}

/**
 * 在候选生成时、预览出站之前调用。返回空数组才允许把这些文字呈现给孩子。
 * 放在展示之前是要点：等孩子读完那句关于自己的话、按下按钮才拒绝，伤害在展示那一刻就已经造成了。
 */
export function screenChildFacingText(fields: ChildFacingFields, extraPatterns: readonly string[]): LabelHit[] {
  const patterns = [...PERSONA_PATTERNS, ...extraPatterns];
  const compiled = compilePatterns(patterns);
  const hits: LabelHit[] = [];
  for (const field of ["childFacingText", "evidenceSummaryText", "targetObjectLabel", "scopeLabel"] as const) {
    const text = fields[field];
    if (!text) continue;
    compiled.forEach((regex, index) => {
      if (regex.test(text)) hits.push({ field, pattern: patterns[index] ?? "" });
    });
  }
  return hits;
}
