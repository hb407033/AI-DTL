/** 可解释的窄门禁，不做正误/能力判断，也不宣称能识别所有语义重复。 */
export function dialogueReplyIssue(text: string, permission: string, expressions: string[]) {
  if (!text.trim() || text.length > 60) return "length";
  if ((text.match(/[？?]/gu) ?? []).length > 1) return "multipleQuestions";
  // 后来出现一个尚未解释的新结果时，不能拿更早的理由阻止老师询问新结果。
  const latestResult = [...expressions].reverse().find(t => /算出|算得|结果[是为]|答案[是为]|得到|得出|等于|先把|因为|所以/u.test(t));
  const explained = latestResult && !/打算|准备|我想|如果|假如/u.test(latestResult)
    && /(?:先|把|因为|所以)[\s\S]{0,120}(?:乘|除|加|减|缩小|扩大|分成)/u.test(latestResult);
  if (explained && /(?:怎么|怎样)(?:算|得|来)|(?:怎么|怎样)[^？?。！]{0,8}(?:算出|得到)/u.test(text)) return "repeatedReason";
  if (permission === "review" && /需要|应该|要先|先把|接下来|再调整|直接|只要/u.test(text)) {
    const procedures = ["小数点位置", "几位小数", "数小数位", "移动小数点", "列竖式", "通分"];
    if (procedures.some(rule => text.includes(rule) && !expressions.some(e => e.includes(rule)))) return "unsolicitedProcedure";
  }
}
