// 孩子会看到的每一句结论都由这里的模板拼装（成长记忆层设计稿 §2.7）。
// 账本里没有任何自由描述字段：模板里只有连接词与整数，具体的词全部来自学科插件提供的儿童版短语。
// 这样家长与模型在结构上就写不出一句孩子没看过、也没同意过的话。
import type { DiscreteCounts } from "./types.js";


/** 拟写入的成长记录，讲给孩子听的那一句 */
export function renderChildFacingText(input: {
  childFacingGoalPhrase: string;
  surfaceContextLabel: string;
  counts: DiscreteCounts;
}): string {
  return `${input.surfaceContextLabel}里，${input.childFacingGoalPhrase}这件事，` +
    `你自己做出来了 ${input.counts.independentTransferSuccesses} 次。`;
}

/** 同屏展示的证据摘要（规范 9.5「提交前看到儿童版描述和主要证据」） */
export function renderEvidenceSummaryText(input: {
  counts: DiscreteCounts;
  selfCorrectionRuns: number;
}): string {
  return `我看到的是：一共 ${input.counts.supportingChallenges} 次这样的题，` +
    `其中 ${input.counts.independentTransferSuccesses} 次你一点提示都没用；` +
    `有 ${input.selfCorrectionRuns} 次是你自己发现不对再改过来的。`;
}

/** 规范 5.7 末句要求的中性呈现：不是分数也不是排名，只有两个整数 */
export function renderScaffoldLine(zeroHintRuns: number, totalRuns: number): string {
  return `最近这些题，你自己做出来了 ${zeroHintRuns} 次，一共做了 ${totalRuns} 次。`;
}

/** 活跃猜想的儿童版整句来自插件清单，内核一个字不加 */
export function renderActiveGuess(childFacingGuess: string): string {
  return childFacingGuess;
}
