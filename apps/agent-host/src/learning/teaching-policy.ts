import type { TeachingAction } from "@ai-scholar/session-contracts";

/** 授权范围只由宿主决定；“有证据”指关联合法，不代表模型已经看懂。 */
export function teachingPermission(confirmed: boolean, action: string,
  hasEvidence: boolean): "none" | "clarification" | "review" | "hint" {
  if (action === "clarify" || action === "uncertain") return "clarification";
  if (action !== "review" && action !== "help") return "none";
  if (!confirmed || !hasEvidence) return "clarification";
  return action === "review" ? "review" : "hint";
}

/** 只接受完整短句；未匹配交给澄清，而不是凭子串猜测孩子同意。 */
export function explicitVoiceAction(transcript: string): TeachingAction {
  const phrase = transcript.replace(/[\s，。！？、,.!?]/g, "");
  if (["看看我的想法", "这样对吗", "老师看看我的想法"].includes(phrase)) return "review";
  if (["帮我一下", "我卡住了", "给我一点提示", "我卡住了给我一点提示"].includes(phrase)) return "help";
  if (["你理解错了", "不是这个意思", "不是这个意思你理解错了"].includes(phrase)) return "correct";
  return "uncertain";
}
