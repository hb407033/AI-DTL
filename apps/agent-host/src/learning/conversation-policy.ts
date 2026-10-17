// 第一阶段 T2：一次开启对话的权限限定。这是回应权限选择，不是判断内容正确。
// independent：默认状态，不开麦、不主动调用模型；只有明确短语才识别为 review/help/correct。
// dialogue：孩子点击一次"和老师聊"后，当前题意版本内的开放表达允许老师核对含义（review）。
// 明确否定与暂停直接停止本轮，不能被后续默认 review 覆盖。
import { explicitVoiceAction } from "./teaching-policy.js";

export type ConversationMode = "independent" | "dialogue";
export type ConversationAction = "pause" | "review" | "help" | "correct" | "uncertain";

const PAUSE_PHRASES = /^(暂停|停一下|等一下|我想休息|我先想一想|我想自己想一想|我想想先别说|不要给我提示)$/u;
// 对话模式下明确纠正开头：仅限特定开头词，不凭通用否定/引用误触发。
const CORRECTION_OPENERS = /^(你理解错了|不是这个意思)/u;

/** 去除标点空白后整体匹配暂停短语；不凭子串猜测。 */
export function isPauseRequest(transcript: string): boolean {
  const phrase = transcript.replace(/[\s，。！？、,.!?]/gu, "");
  return PAUSE_PHRASES.test(phrase) || /^(?:我(?:不会|没懂)但)?先别(?:提示|说)我想自己(?:试试|想想)$/u.test(phrase);
}

export function conversationAction(mode: ConversationMode, transcript: string): ConversationAction {
  if (isPauseRequest(transcript)) return "pause";
  const explicit = explicitVoiceAction(transcript);
  if (explicit === "review" || explicit === "help" || explicit === "correct") return explicit;
  const phrase = transcript.replace(/[\s，。！？、,.!?]/gu, "");
  if (!phrase) return "uncertain";
  if (mode === "dialogue") {
    // 明确纠正开头+补充内容 → correct；独立模式不放宽，仍需完整短语。
    if (CORRECTION_OPENERS.test(phrase)) return "correct";
    // 只承认孩子当前的直接求助；引用、假设或“先别提示”不能被升级为提示授权。
    if (!/先别|不要|不用|不需要|自己试|自己想|如果|假如|他说|她说|同学|不是不会/u.test(phrase)
      && (/^(?:嗯|呃)?(?:我)?(?:还是|真的|完全)?(?:不会|不知道|没听懂|没懂|不明白)(?:[呀啊呢吧]|为什么|怎么做|怎么算)?$/u.test(phrase)
        || /(?:^|[，。！？、,.!?])我(?:说我)?(?:其实)?(?:还是)?(?:不会|没听懂|没懂|不明白|不知道为什么)[^。！？]{0,40}/u.test(transcript)
        || /^(?:我)?(?:还是)?(?:不会|没听懂|不明白).*(?:给我.*提示|帮我|能用.*想)/u.test(phrase)
        || /^我不想画图(?:能|可以)用.+(?:想|算)吗$/u.test(phrase))) return "help";
    // 开放对话中的直接求助，不要求孩子背固定口令。完整短句匹配避免引用/否定误授权。
    if (/^(?:嗯|呃)?(?:(?:我不知道)?怎么(?:分|算|做)(?:呀|啊|呢|吗)?){1,2}$/u.test(phrase)
      || /^(?:能|可以)?给我(?:一点|一个)?提示(?:吗|呀)?$/u.test(phrase)) return "help";
    return "review";
  }
  return "uncertain";
}
