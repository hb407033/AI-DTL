import { expect, test } from "vitest";
import { passesVoiceGate, isolatedTranscriptionConfig, nativeTurnDecision, isApprovedAudio } from "../src/ai/qwen-workspace-probe.js";

const evidence = { transcriptBeforeAnswer: true, teachingAudioBeforeAuthorization: 0,
  sameConnectionTurns: 5, correctedTurnStaysIsolated: true };
test("五轮独立转写且没有未授权音频才能通过", () => {
  expect(passesVoiceGate(evidence)).toBe(true);
});
test.each([
  { transcriptBeforeAnswer: false }, { teachingAudioBeforeAuthorization: 1 },
  { sameConnectionTurns: 4 }, { correctedTurnStaysIsolated: false },
])("门禁不以部分成功替代完整证据 %j", delta => {
  expect(passesVoiceGate({ ...evidence, ...delta })).toBe(false);
});
test("内部转写回合禁用音频和工具，不依赖模型生成分类", () => {
  const session = isolatedTranscriptionConfig();
  expect(session.modalities).toEqual(["text"]);
  expect(session.turn_detection).toBeNull();
  expect(session).not.toHaveProperty("tools");
});
test("只接受当前输入项的原生转写，回答文本和过期转写不能授权", () => {
  const e = { type: "conversation.item.input_audio_transcription.completed", item_id: "current", transcript: "看看我的想法。" };
  expect(nativeTurnDecision(e, "current")).toEqual({ transcript: "看看我的想法。", action: "review" });
  expect(nativeTurnDecision(e, "old")).toBeNull();
  expect(nativeTurnDecision({ ...e, type: "response.text.done" }, "current")).toBeNull();
  expect(nativeTurnDecision({ ...e, transcript: "题目里写着帮我一下" }, "current")?.action).toBe("uncertain");
});
test("转写阶段和迟到音频不能进入授权播放", () => {
  expect(isApprovedAudio("routing", "r1", "r1")).toBe(false);
  expect(isApprovedAudio("teaching", "r2", "r1")).toBe(false);
  expect(isApprovedAudio("teaching", null, null)).toBe(false);
  expect(isApprovedAudio("teaching", "r2", "r2")).toBe(true);
});
