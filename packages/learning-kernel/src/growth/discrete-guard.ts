// 离散守卫：拦住浮点置信度进入长期记忆（设计规范 9.1「第一版不保存由模型随口生成的浮点置信度」）。
// 判定按值而不是猜键名：早先按 confidence|probability|score|weight 之类子串扫键名，
// 会把每条候选都必填的 probeId、probeFamilyId 全部误伤，等于 100% 拒绝；
// 换个名字的浮点比率又照样漏过。所以这里只认三件事——非整数、落在 0 与 1 之间的数、被后缀声明为比率的数值字段。

/** 字段名以这些后缀结尾且值是数值时，即使是整数也拒：它在名字上就宣称自己是比率 */
const RATIO_SUFFIXES = ["Ratio", "Rate", "Confidence", "Probability", "Likelihood"] as const;

/** 明确的计数字段：必须是非负整数 */
const COUNT_FIELDS = new Set([
  "supportingChallenges", "refutingChallenges", "distinctSurfaceContexts",
  "independentTransferSuccesses", "hintedSuccesses", "escalationCount",
  "probesIssued", "consecutiveDeclines", "versionNo", "difficultyBandIndex",
]);

export type DiscreteViolationCode = "nonInteger" | "ratioLike" | "declaredRatio" | "negativeCount";

export interface DiscreteViolation {
  /** 违规值在对象里的位置，例如 $.a[1].x */
  path: string;
  code: DiscreteViolationCode;
}

function lastSegment(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1);
}

function checkNumber(value: number, path: string): DiscreteViolation | null {
  const key = lastSegment(path);
  if (RATIO_SUFFIXES.some((suffix) => key.endsWith(suffix))) return { path, code: "declaredRatio" };
  if (COUNT_FIELDS.has(key)) {
    if (!Number.isInteger(value)) return { path, code: "nonInteger" };
    return value < 0 ? { path, code: "negativeCount" } : null;
  }
  if (Number.isInteger(value)) return null;
  // 落在 0 与 1 之间的数就是置信度的形状；其余非整数也不是可解释的离散事实
  const magnitude = Math.abs(value);
  return { path, code: magnitude > 0 && magnitude < 1 ? "ratioLike" : "nonInteger" };
}

export function findDiscreteViolations(value: unknown, path = "$"): DiscreteViolation[] {
  if (typeof value === "number") {
    const violation = checkNumber(value, path);
    return violation ? [violation] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => findDiscreteViolations(item, `${path}[${index}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => findDiscreteViolations(item, `${path}.${key}`));
  }
  return [];
}

/** 落盘前对每条记录、候选与假设行调用；有违规就带上全部路径抛出 */
export function assertDiscreteOnly(value: unknown): void {
  const violations = findDiscreteViolations(value);
  if (violations.length === 0) return;
  throw new Error(`只能保存离散事实，发现 ${violations.length} 处违规：${violations.map((v) => `${v.path}(${v.code})`).join("、")}`);
}
