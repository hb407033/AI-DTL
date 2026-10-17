/** 小数除法的课程规则与可核对表达。只作会话焦点门禁，不作能力诊断。 */

/** 精确十进制除法：用 BigInt 消除浮点误差，如 1.1÷0.1=11 而非 11.000000000000002。 */
export function preciseDivide(a: number, b: number): number {
  if (b === 0 || !Number.isFinite(a) || !Number.isFinite(b)) return a / b;
  const aStr = String(a), bStr = String(b);
  const aDec = aStr.includes(".") ? aStr.split(".")[1]!.length : 0;
  const bDec = bStr.includes(".") ? bStr.split(".")[1]!.length : 0;
  const aInt = BigInt(aStr.replace(".", ""));
  const bInt = BigInt(bStr.replace(".", ""));
  const num = aInt * 10n ** BigInt(bDec);
  const den = bInt * 10n ** BigInt(aDec);
  if (num % den === 0n) return Number(num / den);
  const scale = 10n ** 10n;
  const scaled = (num * scale * 2n + den) / (2n * den);
  return Number(scaled) / 1e10;
}

/** 小数除法的课程规则与可核对表达。只作会话焦点门禁，不作能力诊断。 */
export function spokenMath(text: string): string {
  const numerals = "零一二三四五六七八九";
  const integer = (word: string) => {
    if (!/[十百千万]/u.test(word) && word.length > 1) return Number([...word.replace(/两/gu, "二")].map(char => numerals.indexOf(char)).join(""));
    let total = 0, digit = 0;
    for (const char of word.replace(/两/gu, "二")) {
      if (numerals.includes(char)) digit = numerals.indexOf(char);
      else { total += (digit || 1) * ({ 十: 10, 百: 100, 千: 1000, 万: 10000 }[char] ?? 0); digit = 0; }
    }
    return total + digit;
  };
  return text.replace(/幺/gu, "一").replace(/[零一二三四五六七八九十百千两]+(?:点[零一二三四五六七八九]+)?/gu, word => {
    const [whole, fraction] = word.split("点");
    return String(integer(whole!)) + (fraction ? "." + [...fraction].map(d => numerals.indexOf(d)).join("") : "");
  }).replace(/除以?|[÷/]/gu, "÷").replace(/乘以?|×/gu, "×").replace(/等于|=/gu, "=");
}

export function decimalDivision(statement: string) {
  const found = statement.match(/(\d+(?:\.\d+)?)\s*[÷/]\s*(\d+\.\d+)/u);
  if (!found || Number(found[2]) <= 0) return;
  const power = 10 ** found[2]!.split(".")[1]!.length;
  const a = Number(found[1]), b = Number(found[2]);
  return { a, b, power, answer: preciseDivide(a, b), converted: `${Math.round(a * power * 1e6) / 1e6}÷${Math.round(b * power)}` };
}

/** 会话选择不是理解证据。先算的选择持续生效，直到孩子主动回到理由。 */
export function divisionTurnIntent(expressions: string[]) {
  let calculationFirst = false;
  let calculationSteps = false;
  for (const expression of expressions) {
    const wantsCalculation = /(?:想|要|先|直接)[^。！？]{0,16}(?:算|计算|竖式)|怎么(?:列|写|算)[^。！？]{0,6}竖式/u.test(expression);
    if (wantsCalculation) calculationFirst = true;
    else if (/(?:现在|再|还是|想|要)[^。！？]{0,8}(?:知道|讨论|理解|听|问)[^。！？]{0,8}(?:为什么|理由|商不变)/u.test(expression)) calculationFirst = false;
    calculationSteps = wantsCalculation && /竖式|步骤|怎么算/u.test(expression);
  }
  return { calculationFirst, calculationSteps };
}

/** 补零可能是缺位补足，也可能额外扩大；先核对完整操作，不凭词语判错。 */
export function divisionOperationCheck(expression: string): "removalThenZero" | "zeroPlacement" | undefined {
  const text = spokenMath(expression);
  const zero = /(?:补|加|添)[^。！？]{0,4}(?:0|零)/u;
  if (!zero.test(text)) return;
  if (/不能[^。！？]{0,20}(?:补|加|添)[^。！？]{0,4}(?:0|零)|(?:不|别|无需|不用|不必|不要|不该)(?:再|额外)?(?:补|加|添)[^。！？]{0,4}(?:0|零)/u.test(text)) return;
  if (/小数点[^。！？]{0,8}(?:划掉|去掉|删掉)|(?:划掉|去掉|删掉)[^。！？]{0,8}小数点/u.test(text)) return "removalThenZero";
  // 整数除法里给商补零是位值计算问题，不是给被除数补零的变换规则。
  // 只有表达明确指向商/整数除法结果且没有操作数或小数点语境时才区分；含糊补零仍须核对。
  if (!/小数点|被÷数|(?<!被)÷数|缺位|位数不够/u.test(text)
    && (/(?:商|得数|结果)[^。！？]{0,12}(?:补|加|添)[^。！？]{0,4}(?:0|零)/u.test(text)
      || /(?<![\d.])\d+\s*÷\s*\d+\s*=\s*\d+(?![\d.])/u.test(text))) return;
  return "zeroPlacement";
}

export function divisionProgress(statement: string, expressions: string[]) {
  const d = decimalDivision(statement); if (!d) return;
  let invariance = false, result = false, placeValue = false, verified = false, transformed = false, invalidTransformation = false;
  let reported: number | undefined;
  let operationCheck: ReturnType<typeof divisionOperationCheck>;
  let transfer: { statement: string; a: number; b: number; reported?: number; checked: boolean } | undefined;
  const escaped = (number: number) => String(number).replace(".", "\\.");
  for (const expression of expressions) {
    const text = spokenMath(expression).replace(/\s/gu, "");
    const mentioned = text.match(/(\d+(?:\.\d+)?)[，,]*(?:再|然后)?[，,]*÷(\d+(?:\.\d+)?)/u);
    // 竖式里的中间一步（“125先看12”“12个10÷5，商写在10位上”）不是孩子另举的新题。
    const longDivisionStep = mentioned && Number(mentioned[2]) === d.b * d.power
      && (String(d.a * d.power).startsWith(mentioned[1]!) || /个(?:10|100)÷/u.test(text))
      && /商\d+余\d+|落下来|竖式|落下|先看|(?:个|十|百|10|100)位/u.test(text)
      && !/新题|换题|另[1一]题|另外/u.test(text);
    if (mentioned && Number(mentioned[2]) > 0 && !longDivisionStep) {
      const a = Number(mentioned[1]), b = Number(mentioned[2]);
      const originalOrConverted = (a === d.a && b === d.b)
        || (Math.abs(a - d.a * d.power) < 1e-8 && Math.abs(b - d.b * d.power) < 1e-8);
      const oneSideOnly = (a === d.a && b === d.b * d.power) || (a === d.a * d.power && b === d.b);
      if (oneSideOnly && !/新题|换题|另[1一]题|另外|自己试/u.test(text)) {
        transfer = undefined; invalidTransformation = true; transformed = false; invariance = false;
      } else if (!originalOrConverted) {
        // 新例子有自己的结果，不能用“新题商8”推翻已经核验的“原题商25”。
        if (!transfer || transfer.a !== a || transfer.b !== b) transfer = { statement: `${a}÷${b}`, a, b, checked: false };
      } else {
        transfer = undefined;
        if (a !== d.a && originalOrConverted) { transformed = true; invalidTransformation = false; }
      }
    }
    if (transfer) {
      const reported = text.match(/(?:商(?:是|为)?|算出|得到|改成|答案(?:是|为)?)[^\d。！？]{0,5}(\d+(?:\.\d+)?)/u);
      if (reported) { transfer.reported = Number(reported[1]); transfer.checked = false; }
      const inverse = text.match(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)[，,]*(?:=|算回|得到)(\d+(?:\.\d+)?)/u);
      if (inverse) transfer.checked = !/准备|打算|如果|假如|还没算|不知道|不是|对不对|吗|[？?]/u.test(expression)
        && Number(inverse[1]) === preciseDivide(transfer.a, transfer.b)
        && Number(inverse[2]) === transfer.b && Number(inverse[3]) === transfer.a
        && (transfer.reported === undefined || transfer.reported === transfer.a / transfer.b);
      continue;
    }
    // 只背“同时扩大，商不变”不算解释；要看到两边变化与份/组数量的联系。
    if (/(?:总量|被÷数|2个数)/u.test(text) && /每[1一]?组|÷数|2个数/u.test(text)
      && /都|同时|同样/u.test(text) && /扩大|×/u.test(text)
      && /(?:组数|份数|分的组|分成的份)[^。！？]{0,12}(?:没变|不变|相同|1样)/u.test(text)) invariance = true;
    // 接受数值可核对的元→角换单位解释；不是见到“份数不变”就算理解。
    const unitPair = (n: number, scaled: number) => new RegExp(`${escaped(n)}元[^。！？]{0,5}(?:换成|是|变成)${escaped(scaled)}角`, "u").test(text);
    const explainsUnchangedQuantity = /单位[^。！？]{0,8}(?:1起|同时|都)/u.test(text) && /份数[^。！？]{0,6}(?:没变|不变)/u.test(text)
      || /单位[^。！？]{0,6}(?:变了|变小)/u.test(text)
        && /钱(?:总数|数|的总数)?[^。！？]{0,4}(?:没多|没变|没增加|没有增加)/u.test(text)
        && /商[^。！？]{0,6}(?:还是|没变|不变)/u.test(text);
    if (unitPair(d.a, d.a * 10) && unitPair(d.b, d.b * 10) && explainsUnchangedQuantity) {
      invariance = true; transformed = true; invalidTransformation = false;
    }
    if (/只有[^。！？]{0,12}(?:被÷数|÷数)[^。！？]{0,12}(?:扩大|×)/u.test(text)
      && !/不是只有|不能只有|不能只/u.test(text)) invariance = false;
    if (/(?:都|同时)[^。！？]{0,10}(?:×|扩大)/u.test(text) && text.includes(String(d.power))) {
      transformed = true; invalidTransformation = false;
    }
    // 先取完整除法式的结果，不能把“算出125÷5=25”里的被除数125当作商。
    const report = text.match(new RegExp(`${d.converted.replaceAll(".", "\\.")}.{0,30}?(?:=|是)(\\d+(?:\\.\\d+)?)`, "u"))
      // “商写在10位上”说的是数位，不是商；“应该是25”是改正后的结果。
      ?? [...text.matchAll(/(?:商(?:应该|应当|是|为)?|结果(?:是|为)?|应该是|改成|算出|得到|答案(?:是|为)?)[^\d。！？]{0,5}(\d+(?:\.\d+)?)(?![\d.]|位)/gu)].at(-1);
    if (report) reported = Number(report[1]);
    if (report && reported !== d.answer) { result = false; verified = false; placeValue = false; }
    if (new RegExp(`(?:商|结果|改成|算出|得到|答案)[^。！？]{0,8}(?<![\\d.])${escaped(d.answer)}(?![\\d.])`, "u").test(text)
      || text.includes(`${d.converted}=${d.answer}`)) result = true;
    if (result && /商|零|位/u.test(text) && /表示[^。！？]{0,8}个10/u.test(text) && /表示[^。！？]{0,8}个1(?!\d)/u.test(text)) placeValue = true;
    const multiplyBack = new RegExp(`(?<![\\d.])${escaped(d.answer)}×${escaped(d.b)}[，,]*(?:=|算回|得到|正好是)${escaped(d.a)}(?![\\d.])`, "u");
    const inverse = text.match(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)[，,]*(?:=|算回|得到|正好是)(\d+(?:\.\d+)?)/u);
    const tentative = /准备|打算|如果|假如|还没算|不知道|不是|对不对|吗|[？?]/u.test(expression);
    if (!tentative && inverse && Number(inverse[1]) === d.answer && Number(inverse[2]) === d.b && Number(inverse[3]) !== d.a) verified = false;
    if (!tentative && multiplyBack.test(text)) { verified = true; result = true; }
    if (/没懂|不明白|不知道为什么|照着你说|跟着你说/u.test(expression)) invariance = false;
    const check = divisionOperationCheck(expression);
    if (check) {
      operationCheck = check;
      // 未核对的新规则会撤销旧的变换/理由结论，但不是能力诊断。
      transformed = false; invariance = false; verified = false;
    } else if (text.includes(d.converted) && transformed) operationCheck = undefined;
  }
  const resolved = [transformed ? "transformation" : undefined, invariance ? "invariance" : undefined,
    placeValue ? "place_value" : undefined, verified ? "verify" : undefined].filter((v): v is "transformation" | "invariance" | "place_value" | "verify" => !!v);
  return { resolved, transfer, reported, operationCheck, next: transfer ? transfer.checked ? "return" : "transfer"
    : invalidTransformation ? "transformation" : !invariance ? "invariance" : !result ? "place_value" : !verified ? "verify" : "return" };
}
