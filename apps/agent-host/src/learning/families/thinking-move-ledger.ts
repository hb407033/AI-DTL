/** 当前单孩子 workspace 目录的可重建投影；不读取旧 kernel 成长库或另存永久记录。 */
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import type { TeachingDecision } from "../teaching-decision.js";

type Move = Exclude<NonNullable<TeachingDecision["move"]>, "none">;
export interface ThinkingMoveMemoryEntry {
  move: Move;
  /** 0=未见（无条目），1=具体提示后做，2=泛化邀请后做，3=有原话支持的自发动作。 */
  withdrawalLevel: 1 | 2 | 3;
  evidenceId: string;
  turnId: string;
  sessionId: string;
}

const moveWords: Record<Move, RegExp> = {
  understand: /题意|条件|已知|要求|意思/u,
  represent: /画|图|线|表示|表格|列式/u,
  specialize: /例子|小数|小一点|简单|试一个|试一种/u,
  conjecture: /猜|可能|规律|预测/u,
  justify: /理由|为什么|因为|解释|说明/u,
  look_back: /检验|检查|核对|验算|乘回|代回/u,
  vary: /类似|同类|其他|换|变|推广/u,
  use_data: /数据|记录|统计|比较|整理/u,
};

const performedWords: Record<Move, RegExp> = {
  understand: /(?:读|看|找|圈)(?:了|出|过)|条件是|要求是|题意是/u,
  represent: /(?:画|写|列|标|圈|表示)(?:了|出|成|过)/u,
  specialize: /(?:试|举|换)(?:了|过)|拿[^。！？]{0,8}(?:举例|试)/u,
  conjecture: /我(?:猜|觉得|估计|预测)|我的猜想/u,
  justify: /因为|所以|理由是|(?:解释|说明)(?:了|过)/u,
  look_back: /(?:检验|检查|核对|验算|乘回|代回)(?:了|过)|(?:乘|代)回去/u,
  vary: /(?:换|改|变)(?:了|成|过)|如果[^。！？]{0,30}那么/u,
  use_data: /(?:比较|整理|记录|统计|用)(?:了|过)|根据[^。！？]{0,16}(?:数据|条件)/u,
};

/**
 * 仅排除明确的拒绝、不会或未进行的负证据，不宣称词语匹配能核验全部动作语义。
 * 同轮另有肯定的已做描述时保留；本轮图像来源由调用方另外处理。
 */
export function hasOnlyUnperformedMoveEvidence(child: string, move: NonNullable<TeachingDecision["childMove"]>["move"]): boolean {
  if (!(move in performedWords)) return false;
  const negative = /不会|不懂|不知道|不想|不愿|不要|拒绝|先不|暂不|还没|还没有|尚未|没(?:有)?(?:做|试|画|列|写|算|检验|检查|核对|解释|说明|比较|记录|读|看)/u;
  if (!negative.test(child)) return false;
  const clauses = child.split(/[，,。！？!?；;\n]|但是|不过|可是|但|却|后来|然后/gu);
  return !clauses.some(clause => !negative.test(clause) && !/[?？]|(?:你|老师|他|她)/u.test(clause)
    && performedWords[move as Move].test(clause));
}

function level(record: WorkspaceRecord, decision: TeachingDecision, previous: TeachingDecision[], move: Move): 1 | 2 | 3 {
  const responseIndex = record.feedback.findIndex(f => f.responseId === decision.responseId && f.turnId === decision.turnId);
  const previousResponses = new Set(previous.map(d => d.responseId));
  // 被异议或无法恢复的先前指导不能用于唤起，也不能让后续动作凭空升级成自发。
  if (record.feedback.slice(0, responseIndex).some(f => !previousResponses.has(f.responseId))) return 1;
  const words = moveWords[move];
  const prompt = [...previous].reverse().find(d => d.move === move || words.test(d.utterance));
  if (prompt) {
    // 泛化邀请没有指定画法、算式或步骤；不把反复拒绝/沉默当作动作证据。
    const general = /你(?:想|准备|打算)|用什么(?:办法|方法)|怎么(?:试|表示|检验|检查)|有什么(?:办法|方法)/u.test(prompt.utterance);
    const concrete = /先[^。！？]{0,16}(?:画|分|乘|除|写|列|算)|再[^。！？]{0,12}(?:画|分|乘|除|写|列|算)|\d|[一二三四五六七八九十]+(?:份|段|格)/u.test(prompt.utterance);
    return general && !concrete ? 2 : 1;
  }
  // 没有可确认的动作发起原话时保守记1，不能由模型另报一个等级。
  return /我(?:自己)?(?:先|主动|想到|决定)/u.test(decision.child) && words.test(decision.child) ? 3 : 1;
}

export function projectThinkingMoveMemory(record: WorkspaceRecord, decisions: TeachingDecision[]): ThinkingMoveMemoryEntry[] {
  const entries: ThinkingMoveMemoryEntry[] = [];
  for (const [index, decision] of decisions.entries()) {
    const observed = decision.childMove;
    if (!observed || observed.move === "none") continue;
    const hasSource = observed.evidenceId === decision.turnId && !!decision.child.trim()
        && !hasOnlyUnperformedMoveEvidence(decision.child, observed.move)
      || record.submissions.some(s => s.previewId === observed.evidenceId
        && s.problemId === decision.problemId && s.problemRevision === decision.problemRevision);
    if (!hasSource) continue;
    entries.push({ move: observed.move, withdrawalLevel: level(record, decision, decisions.slice(0, index), observed.move),
      evidenceId: observed.evidenceId, turnId: decision.turnId, sessionId: record.sessionId });
  }
  return entries;
}

/** 一个动作仅注入一条真实证据；高等级证据优先，同等级优先较新的作品内轮次。 */
export function summarizeThinkingMoveMemory(entries: ThinkingMoveMemoryEntry[]): ThinkingMoveMemoryEntry[] {
  const summary = new Map<Move, ThinkingMoveMemoryEntry>();
  for (const entry of entries) {
    const previous = summary.get(entry.move);
    if (!previous || entry.withdrawalLevel >= previous.withdrawalLevel) summary.set(entry.move, entry);
  }
  return [...summary.values()];
}

export function validThinkingMoveMemoryReference(summary: readonly ThinkingMoveMemoryEntry[], evidenceId: string, move?: string): boolean {
  return summary.some(entry => entry.evidenceId === evidenceId && (!move || entry.move === move));
}
