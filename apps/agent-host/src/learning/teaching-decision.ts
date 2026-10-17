import { z } from "zod";
import { MATH_THINKING_MOVES } from "@ai-scholar/plugin-math";

export const teachingFocus = z.enum(["clarify", "transformation", "invariance", "place_value", "verify", "transfer", "return", "acknowledge"]);
/** 八个思维动作，与 plugin-math 的 thinkingMoves 对应。 */
export const thinkingMove = z.enum([...MATH_THINKING_MOVES, "none"]);
/** 会话工作记忆，不是能力结论；随作品删除，异议后不再用于决策。 */
export const teachingDecisionSchema = z.strictObject({
  problemId: z.string().min(1).max(80), problemRevision: z.number().int().nonnegative(),
  turnId: z.string().min(1).max(80), responseId: z.string().min(1).max(80), child: z.string().max(1000),
  focus: teachingFocus, observation: z.string().min(1).max(240),
  evidenceIds: z.array(z.string().min(1).max(80)).min(1).max(8),
  resolved: z.array(teachingFocus).max(7), utterance: z.string().min(1).max(90),
  method: z.enum(["scale_both", "ordinary"]), handoff: z.boolean(),
  /** 两段式决策的内部分析，不进入播报和下发给iPad的载荷。可选，旧存档无此字段。 */
  analysis: z.string().max(2000).optional(),
  /** 老师本轮选用的思维动作，八选一或 none。可选，旧存档无此字段。 */
  move: thinkingMove.optional(),
  /** 孩子本轮做出的思维动作及证据编号。可选，旧存档无此字段。 */
  childMove: z.strictObject({ move: thinkingMove, evidenceId: z.string().min(1).max(80) }).optional(),
  /** 3.5: 老师拟用的小例子（题族和参数），host 求解后交给复核器。可选。 */
  probe: z.strictObject({ family: z.string().min(1).max(40), params: z.record(z.string(), z.number()) }).optional(),
  /** 5.1: 请求一个线段图邀请，用于植树和小数乘法的 specialize/represent。可选。 */
  scaffoldRequest: z.boolean().optional(),
});
export type TeachingDecision = z.infer<typeof teachingDecisionSchema>;
