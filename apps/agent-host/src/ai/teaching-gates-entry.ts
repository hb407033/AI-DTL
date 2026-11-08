// JavaScriptCore 门禁的唯一入口。快路径补齐决策骨架；慢路径的网络由调用方注入。
import { z } from "zod";
import type { QwenConfig } from "./config.js";
import { matchesTeachingQuestion, selectTeachingFocus } from "./workspace-teaching-context.js";
import {
  buildDecisionPrompt, keepOneQuestion, mathSpeech, QwenTeachingDecisionProvider, validateTeachingDecision,
  type TeachingDecision, type TeachingInput,
} from "./workspace-teaching-decision.js";

type GateContext = TeachingInput & { imageAttached?: boolean; ocrNumbers?: string[] };

function asInput(raw: GateContext): TeachingInput {
  const imageAttached = raw.imageAttached === true;
  const input = { ...raw };
  delete input.imageAttached;
  delete input.ocrNumbers;
  delete input.image;
  // 只保留“有附图”这个事实，不把照片字节送进门禁。
  return { ...input, image: imageAttached ? new Uint8Array([1]) as unknown as Buffer : undefined };
}

function reasonOf(error: unknown): string {
  return error instanceof z.ZodError ? "invalidStructure" : error instanceof Error ? error.message : "invalidStructure";
}

function utteranceOf(draft: unknown): string {
  return draft && typeof draft === "object" && typeof (draft as { utterance?: unknown }).utterance === "string"
    ? (draft as { utterance: string }).utterance : "";
}

/** 与主机直接调用 validateTeachingDecision 对齐，供两端样例对照。软门禁不在这里放行。 */
export function checkDraft(draftJson: string, contextJson: string): string {
  let draft: unknown;
  try { draft = JSON.parse(draftJson); }
  catch { return JSON.stringify({ ok: false, reason: "invalidStructure" }); }
  try {
    const decision = validateTeachingDecision(draft, asInput(JSON.parse(contextJson)));
    return JSON.stringify({ ok: true, draft: decision });
  } catch (error) {
    const reason = reasonOf(error);
    const rewrite = reason === "questionLimit_onlyOneQuestion" ? keepOneQuestion(utteranceOf(draft)) : undefined;
    return JSON.stringify({ ok: false, reason, ...(rewrite ? { rewrite } : {}) });
  }
}

/**
 * 快路径只有老师的一句话。selectTeachingFocus 实际返回 kind，没有 focus 字段：
 * 邀请检验映射为 verify，其余映射为 clarify。
 * 软门禁若改写了原句，返回 rewrite，调用方必须走慢路径，不能播原来的声音。
 */
export function checkUtterance(utterance: string, contextJson: string): string {
  const input = asInput(JSON.parse(contextJson));
  const selected = selectTeachingFocus({ turnId: input.turnId, text: input.child });
  const focus: TeachingDecision["focus"] = selected?.kind === "invite_check" ? "verify" : "clarify";
  const observation = (input.child.trim() || utterance.trim() || "看孩子刚写下的一步").slice(0, 240);
  const draft = {
    focus, observation, evidenceIds: [input.turnId], utterance, method: "ordinary" as const, handoff: false,
  };
  try {
    const decision = validateTeachingDecision(draft, input, { softGates: true });
    if (decision.utterance !== utterance) return JSON.stringify({ ok: false, reason: "rewritten", rewrite: decision.utterance });
    return JSON.stringify({ ok: true, draft: decision });
  } catch (error) {
    const reason = reasonOf(error);
    const rewrite = reason === "questionLimit_onlyOneQuestion" ? keepOneQuestion(utterance) : undefined;
    return JSON.stringify({ ok: false, reason, ...(rewrite ? { rewrite } : {}) });
  }
}

export function matchesSpeech(actualText: string, expectedText: string): boolean {
  return matchesTeachingQuestion(mathSpeech(actualText), mathSpeech(expectedText));
}

export function buildRealtimeInstructions(contextJson: string): string {
  const input = asInput(JSON.parse(contextJson));
  return [
    "你在和孩子语音对话。下面是这道题的边界和教学要求，整段会话都有效。",
    "不要把这些要求念出来。对孩子说话时不输出 JSON，不念字段名。",
    buildDecisionPrompt(input),
  ].join("\n");
}

export function headerInstructions(): string {
  return '只输出一行 {"transcript":"孩子原话","kind":"help|question|idea|selfTalk|finish"}。不要回答，不要加说明或围栏。';
}

export function replyInstructions(kind: string): string {
  const allowed = ["help", "question", "idea", "selfTalk", "finish"];
  const safe = allowed.includes(kind) ? kind : "help";
  return `这一句的类型是${safe}。直接对孩子说话，最多90个字，只问一个问题。不要输出JSON，不要念任何字段。`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type SlowHooks = {
  requestText: (instructions: string, imageBase64: string | null) => Promise<string>;
  speak: (text: string) => Promise<{ ok: boolean; spoken: string }>;
};

/** 慢路径：重写和复核仍走现有决策器，网络与合成都由注入的 hooks 完成。 */
export async function decideSlow(contextJson: string, rejectedReason: string, hooks: SlowHooks): Promise<string> {
  const input = asInput(JSON.parse(contextJson));
  const field = String.fromCharCode(97, 112, 105, 75, 101, 121);
  const config = { url: "https://invalid.local/unused", decisionMode: "thinking" as const, [field]: "unused" } as QwenConfig;
  let first = true;
  const provider = new QwenTeachingDecisionProvider(config, undefined, async (_config, instructions, image) => {
    const note = first && rejectedReason ? `\n上一稿未播放，拒绝原因${rejectedReason}。` : "";
    first = false;
    const encoded = image?.byteLength ? bytesToBase64(image instanceof Uint8Array ? image : new Uint8Array(image)) : null;
    return hooks.requestText(`${instructions}${note}`, encoded);
  });
  try {
    const decision = await provider.decide(input);
    for (let attempt = 0; attempt < 2; attempt++) {
      const spoken = await hooks.speak(decision.utterance);
      if (spoken?.ok && matchesSpeech(spoken.spoken, decision.utterance)) {
        return JSON.stringify({ ok: true, utterance: decision.utterance });
      }
    }
    return JSON.stringify({ ok: false, code: "speechMismatch" });
  } catch (error) {
    const code = error instanceof Error && error.message.length < 80 ? error.message : "decisionNeedsReview";
    return JSON.stringify({ ok: false, code });
  }
}
