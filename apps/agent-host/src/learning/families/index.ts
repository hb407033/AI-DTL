/** 题族求解器：只为已确认关系生成答案；不支持或条件不足时返回 undefined。 */
export interface ParsedProblem {
  family: string;
  statement: string;
  params: Record<string, number>;
}

export interface SolutionStep {
  expression: string;
  result: number;
  precision?: "exact" | "approximate";
}

export interface Solution {
  answer: number;
  steps: SolutionStep[];
  /** exact 指返回数字的十进制表示等于有理数结果；非终止小数及舍入均标记 approximate。 */
  precision?: "exact" | "approximate";
}

export interface ProblemFamily {
  family: string;
  parse(statement: string): ParsedProblem | undefined;
  solve(problem: ParsedProblem): Solution;
}

type Rational = { numerator: bigint; denominator: bigint };
const numberPattern = "\\d+(?:\\.\\d+)?";
function invalidParameters(): never { throw new Error("invalidProblemParameters"); }

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) invalidParameters();
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  let a = numerator < 0n ? -numerator : numerator, b = denominator;
  while (b !== 0n) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

/** 从十进制字符串建有理数，兼容 Number 使用的科学记数法。 */
function decimal(value: number): Rational {
  if (typeof value !== "number" || !Number.isFinite(value)) invalidParameters();
  const [coefficient, exponentText = "0"] = String(value).toLowerCase().split("e");
  const exponent = Number(exponentText) - (coefficient!.split(".")[1]?.length ?? 0);
  const integer = BigInt(coefficient!.replace(".", ""));
  return exponent >= 0 ? rational(integer * 10n ** BigInt(exponent)) : rational(integer, 10n ** BigInt(-exponent));
}

function add(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}
function subtract(a: Rational, b: Rational): Rational { return add(a, { ...b, numerator: -b.numerator }); }
function multiply(a: Rational, b: Rational): Rational { return rational(a.numerator * b.numerator, a.denominator * b.denominator); }
function divide(a: Rational, b: Rational): Rational { return rational(a.numerator * b.denominator, a.denominator * b.numerator); }

function numericResult(value: Rational): { result: number; precision: "exact" | "approximate" } {
  const negative = value.numerator < 0n;
  const numerator = negative ? -value.numerator : value.numerator;
  let remainder = numerator % value.denominator;
  let text = String(numerator / value.denominator);
  if (remainder !== 0n) {
    text += ".";
    // 两个有限 Number 的运算最多需要约 648 位十进制，额外位数用于正确舍入。
    for (let i = 0; remainder !== 0n && i < 700; i += 1) {
      remainder *= 10n;
      text += String(remainder / value.denominator);
      remainder %= value.denominator;
    }
  }
  const result = Number(`${negative ? "-" : ""}${text}`);
  if (!Number.isFinite(result) || (result === 0 && numerator !== 0n)) invalidParameters();
  const represented = decimal(result);
  const exact = represented.numerator * value.denominator === value.numerator * represented.denominator;
  return { result, precision: exact ? "exact" : "approximate" };
}

function step(expression: string, value: Rational): SolutionStep { return { expression, ...numericResult(value) }; }
function solution(value: Rational, steps: SolutionStep[]): Solution {
  const result = numericResult(value);
  return { answer: result.result, precision: result.precision, steps };
}

function validate(problem: ParsedProblem, family: string): void {
  if (!problem || problem.family !== family || !problem.params || typeof problem.params !== "object") invalidParameters();
  const p = problem.params;
  const finite = (...keys: string[]) => keys.every(key => typeof p[key] === "number" && Number.isFinite(p[key]));
  switch (family) {
    case "decimal-division":
      if (!finite("a", "b") || p.b === 0) invalidParameters();
      break;
    case "decimal-multiplication":
      if (!finite("a", "b")) invalidParameters();
      break;
    case "tree-planting": {
      if (!finite("length", "gap", "bothEnds") || p.length! <= 0 || p.gap! <= 0 || ![0, 1].includes(p.bothEnds!)) invalidParameters();
      const intervals = divide(decimal(p.length!), decimal(p.gap!));
      if (intervals.denominator !== 1n || intervals.numerator >= BigInt(Number.MAX_SAFE_INTEGER)) invalidParameters();
      break;
    }
    case "parallelogram-area":
      if (!finite("base", "height") || p.base! <= 0 || p.height! <= 0) invalidParameters();
      break;
    case "one-step-equation":
      if (!finite("type", "a", "b") || ![1, 2, 3, 4, 5].includes(p.type!)) invalidParameters();
      if ([3, 4, 5].includes(p.type!) && p.a === 0) invalidParameters();
      if (p.type === 5 && !finite("offset")) invalidParameters();
      break;
    default: throw new Error("unknownFamily");
  }
}

function parsed(family: string, statement: string, params: Record<string, number>): ParsedProblem | undefined {
  const problem = { family, statement, params };
  try { validate(problem, family); return problem; } catch { return undefined; }
}

/** 不从复合算式截取局部关系；保留中文提示语及旧 OCR 前缀的容错。 */
function singleExpression(statement: string, pattern: string): RegExpMatchArray | undefined {
  const match = statement.match(new RegExp(`(?<![\\d.])${pattern}(?![\\d.])`, "u"));
  if (!match) return undefined;
  const outside = statement.slice(0, match.index) + statement.slice((match.index ?? 0) + match[0].length);
  return /[+\-×*÷/=xX]/u.test(outside) ? undefined : match;
}

const decimalDivision: ProblemFamily = {
  family: "decimal-division",
  parse(statement) {
    const match = singleExpression(statement, `(${numberPattern})\\s*[÷/]\\s*(\\d+\\.\\d+)`);
    if (match) return parsed(this.family, statement, { a: Number(match[1]), b: Number(match[2]) });
    if (/[=+\-×*÷/]|还剩|剩余|余下/u.test(statement) || !/(?:剪|分).*?(?:几|多少)段/u.test(statement)) return undefined;
    const total = statement.match(new RegExp(`(${numberPattern})\\s*米\\s*(?:的|长的?)?彩带`, "u"));
    const segment = statement.match(new RegExp(`每段\\s*(?:长|为)?\\s*(${numberPattern})\\s*米`, "u"));
    if (!total || !segment || [...statement.matchAll(/\d+(?:\.\d+)?/gu)].length !== 2) return undefined;
    const problem = parsed(this.family, statement, { a: Number(total[1]), b: Number(segment[1]) });
    if (!problem || problem.params.a! <= 0 || problem.params.b! <= 0) return undefined;
    return divide(decimal(problem.params.a!), decimal(problem.params.b!)).denominator === 1n ? problem : undefined;
  },
  solve(problem) {
    validate(problem, this.family);
    const { a, b } = problem.params;
    const value = divide(decimal(a!), decimal(b!));
    const denominator = decimal(b!).denominator;
    const shiftedA = numericResult(multiply(decimal(a!), rational(denominator))).result;
    const shiftedB = numericResult(multiply(decimal(b!), rational(denominator))).result;
    return solution(value, [step(`${shiftedA}÷${shiftedB}`, value)]);
  },
};

const decimalMultiplication: ProblemFamily = {
  family: "decimal-multiplication",
  parse(statement) {
    const match = singleExpression(statement, `(${numberPattern})\\s*[×xX*]\\s*(${numberPattern})`);
    if (match) return parsed(this.family, statement, { a: Number(match[1]), b: Number(match[2]) });
    if (/[=+×*÷/]|和|另|优惠|折|找/u.test(statement)) return undefined;
    const price = statement.match(new RegExp(`每千克(?:的)?(?:苹果)?\\s*(${numberPattern})\\s*元`, "u"));
    const amount = statement.match(new RegExp(`买\\s*(?:了)?\\s*(${numberPattern})\\s*千克`, "u"));
    if (!price || !amount || [...statement.matchAll(/\d+(?:\.\d+)?/gu)].length !== 2) return undefined;
    if (Number(price[1]) <= 0 || Number(amount[1]) <= 0) return undefined;
    return parsed(this.family, statement, { a: Number(price[1]), b: Number(amount[1]) });
  },
  solve(problem) {
    validate(problem, this.family);
    const { a, b } = problem.params;
    const value = multiply(decimal(a!), decimal(b!));
    return solution(value, [step(`${a}×${b}`, value)]);
  },
};

const treePlanting: ProblemFamily = {
  family: "tree-planting",
  parse(statement) {
    if (/[+\-]|两侧|两边|双侧|环形|圆形|围成|两端都不|两头都不/u.test(statement)) return undefined;
    if ([...statement.matchAll(/\d+(?:\.\d+)?/gu)].length !== 2) return undefined;
    const length = statement.match(new RegExp(`(${numberPattern})\\s*米[^。；;]*?路|路[^。；;\\d]*?(${numberPattern})\\s*米`, "u"));
    const gap = statement.match(new RegExp(`每\\s*(?:隔\\s*)?(${numberPattern})\\s*米[^。；;]*?[棵株]`, "u"));
    const bothEnds = /两端都[种栽]|两头都[种栽]/u.test(statement);
    const oneEnd = /一端[种栽]一端不[种栽]|一端不[种栽]一端[种栽]|一端[种栽][，,、\s]*(?:另)?一端不[种栽]/u.test(statement);
    if (!length || !gap || bothEnds === oneEnd) return undefined;
    return parsed(this.family, statement, { length: Number(length[1] ?? length[2]), gap: Number(gap[1]), bothEnds: bothEnds ? 1 : 0 });
  },
  solve(problem) {
    validate(problem, this.family);
    const { length, gap, bothEnds } = problem.params;
    const intervals = divide(decimal(length!), decimal(gap!));
    const value = bothEnds ? add(intervals, rational(1n)) : intervals;
    const count = numericResult(intervals).result;
    const answer = numericResult(value).result;
    return solution(value, [step(`${length}÷${gap}=${count}`, intervals), step(bothEnds ? `${count}+1=${answer}` : `${count}`, value)]);
  },
};

const parallelogramArea: ProblemFamily = {
  family: "parallelogram-area",
  parse(statement) {
    // 直接调用该题族时容许“底8高3”简写；全局解析另外要求图形名称。
    if (/三角形|梯形|长方形|正方形|圆形|周长/u.test(statement)) return undefined;
    const base = statement.match(new RegExp(`底\\s*(?:为|是|长)?\\s*(${numberPattern})\\s*(厘米|分米|毫米|千米|米)?`, "u"));
    const height = statement.match(new RegExp(`高\\s*(?:为|是)?\\s*(${numberPattern})\\s*(厘米|分米|毫米|千米|米)?`, "u"));
    if (!base || !height || [...statement.matchAll(/底\s*(?:为|是|长)?\s*\d/gu)].length !== 1 || [...statement.matchAll(/高\s*(?:为|是)?\s*\d/gu)].length !== 1) return undefined;
    if (base[2] && height[2] && base[2] !== height[2]) return undefined;
    return parsed(this.family, statement, { base: Number(base[1]), height: Number(height[1]) });
  },
  solve(problem) {
    validate(problem, this.family);
    const { base, height } = problem.params;
    const value = multiply(decimal(base!), decimal(height!));
    return solution(value, [step(`${base}×${height}`, value)]);
  },
};

/** 保留原 family ID 与 type 1–4；type 5 表示 ax + offset = b。 */
const oneStepEquation: ProblemFamily = {
  family: "one-step-equation",
  parse(statement) {
    let match = singleExpression(statement, `(${numberPattern})\\s*[xX]\\s*([+\\-])\\s*(${numberPattern})\\s*=\\s*(${numberPattern})`);
    if (match) return parsed(this.family, statement, { type: 5, a: Number(match[1]), offset: Number(match[3]) * (match[2] === "-" ? -1 : 1), b: Number(match[4]) });
    match = singleExpression(statement, `[xX]\\s*([+\\-])\\s*(${numberPattern})\\s*=\\s*(${numberPattern})`);
    if (match) return parsed(this.family, statement, { type: match[1] === "+" ? 1 : 2, a: Number(match[2]), b: Number(match[3]) });
    match = singleExpression(statement, `(${numberPattern})\\s*[xX]\\s*=\\s*(${numberPattern})`);
    if (match) return parsed(this.family, statement, { type: 3, a: Number(match[1]), b: Number(match[2]) });
    match = singleExpression(statement, `[xX]\\s*[÷/]\\s*(${numberPattern})\\s*=\\s*(${numberPattern})`);
    if (match) return parsed(this.family, statement, { type: 4, a: Number(match[1]), b: Number(match[2]) });
    // 找零是支付额的一部分：本数 × 单价 + 找零 = 支付额。
    if (!/一本(?:故事)?书\s*[xX]\s*元/u.test(statement) || /和|另|折|优惠/u.test(statement)) return undefined;
    const count = statement.match(new RegExp(`买\\s*(?:了)?\\s*(${numberPattern})\\s*本`, "u"));
    const paid = statement.match(new RegExp(`付\\s*(?:了)?\\s*(${numberPattern})`, "u"));
    const change = statement.match(new RegExp(`找\\s*(?:回|了)?\\s*(${numberPattern})`, "u"));
    if (!count || !paid || !change || [...statement.matchAll(/\d+(?:\.\d+)?/gu)].length !== 3) return undefined;
    if (!Number.isSafeInteger(Number(count[1])) || Number(count[1]) <= 0 || Number(paid[1]) <= Number(change[1])) return undefined;
    return parsed(this.family, statement, { type: 5, a: Number(count[1]), offset: Number(change[1]), b: Number(paid[1]) });
  },
  solve(problem) {
    validate(problem, this.family);
    const { type, a, b, offset } = problem.params;
    const first = decimal(a!), second = decimal(b!);
    if (type === 5) {
      const subtotal = subtract(second, decimal(offset!));
      const value = divide(subtotal, first);
      const total = numericResult(subtotal).result;
      return solution(value, [step(`${b}-(${offset})=${total}`, subtotal), step(`${total}÷${a}`, value)]);
    }
    const value = type === 1 ? subtract(second, first) : type === 2 ? add(second, first) : type === 3 ? divide(second, first) : multiply(first, second);
    const expression = type === 1 ? `${b}-${a}` : type === 2 ? `${b}+${a}` : type === 3 ? `${b}÷${a}` : `${a}×${b}`;
    return solution(value, [step(expression, value)]);
  },
};

const families = [decimalDivision, decimalMultiplication, treePlanting, parallelogramArea, oneStepEquation];

export function parseProblem(statement: string): ParsedProblem | undefined {
  if (typeof statement !== "string" || statement.length > 10_000) return undefined;
  for (const family of families) {
    if (family === parallelogramArea && !statement.includes("平行四边形")) continue;
    const problem = family.parse(statement);
    if (problem) return problem;
  }
  return undefined;
}

/** 非法结构化参数统一报错；调用方不得将其视为已验证答案。 */
export function solveProblem(problem: ParsedProblem): Solution {
  if (!problem || typeof problem.family !== "string") invalidParameters();
  const family = families.find(candidate => candidate.family === problem.family);
  if (!family) throw new Error("unknownFamily");
  return family.solve(problem);
}

export { decimalDivision, decimalMultiplication, treePlanting, parallelogramArea, oneStepEquation };
