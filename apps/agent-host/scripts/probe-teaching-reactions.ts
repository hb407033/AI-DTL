import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import { loadQwenConfig } from "../src/ai/config.js";
import { QwenTeachingDecisionProvider, speakDecision, type TeachingDecision } from "../src/ai/workspace-teaching-decision.js";
import { WorkspaceVoiceProvider } from "../src/ai/workspace-voice-provider.js";
import { conversationAction } from "../src/learning/conversation-policy.js";

// 只预置孩子的多种反应与行为边界，不预置老师回复。每条老师回复来自真实模型。
const reason = "总量和每一组都扩大十倍，能分的组数没变，所以商不变。";
const scenarios = [
  { name: "不会再不会", turns: ["我不会。", "我还是不会，你给我一点提示吧。", reason, "我自己算出二十五了。", "二十五乘零点五等于十二点五。"], focuses: [["transformation", "invariance"], ["transformation", "invariance"], "place_value", "verify", "return"] },
  { name: "只改一个数和错商", turns: ["我只把零点五乘十，算十二点五除以五，可以吗？", "那两个数都乘十，变成一百二十五除以五，算出二百零五。", reason, "我改成二十五了。", "我算二十五乘零点五等于十三。"], focuses: ["transformation", "place_value", "place_value", "verify", "verify"] },
  { name: "换钱单位思路", turns: ["我不想画图，我想用钱来想。", "我按钱来想，十二点五元换成一百二十五角，每份零点五元换成五角，单位一起变了，份数没变。", "我算出二十五。", "二十五乘零点五等于十二点五。"], focuses: ["clarify", "place_value", "verify", "return"] },
  { name: "猜中但没懂", turns: ["我猜二十五，不知道为什么。", "我其实还是没懂为什么商不变。"], focuses: ["verify", ["transformation", "invariance"]] },
  { name: "词语不懂", turns: ["商是什么意思？"], focuses: ["clarify"] },
  { name: "不是日期", turns: ["我说的不是十二月五日，是十二点五这个小数。"], focuses: ["clarify"] },
  { name: "提出课外技巧", turns: ["我觉得除零点五就是乘二，能这样想吗？"], focuses: [["transformation", "invariance"]] },
  { name: "新题先错再改", turns: ["我想换一道，四点八除零点六。", "我算出九。", "我改成八了，八乘零点六等于四点八。"], focuses: ["transfer", "transfer", "return"] },
  { name: "质疑老师", turns: ["我觉得你说得不对，我还没想明白。"], focuses: ["clarify"] },
  { name: "不愿画图", turns: ["别让我画图了，我想直接算。"], focuses: ["clarify"] },
  { name: "听不清数字", turns: ["是二十五还是二百零五？我没听清。"], focuses: ["clarify"] },
  { name: "撤回跟读", turns: [reason, "二十五乘零点五等于十二点五。", "刚才那句是照着你说的，我不知道为什么。"], focuses: ["place_value", "return", "invariance"] },
  { name: "拒绝重复解释", turns: ["两个数都乘十，变成125除以5。", "老师，别问我为什么啦，我现在就想自己先算。"], focuses: [["invariance", "place_value"], "clarify"] },
  { name: "自然单位解释", turns: ["是单位变了，12.5元变成125角，0.5元变成5角。钱总数没多，只是数得更细了，所以商还是25。"], focuses: ["verify"] },
  { name: "完整操作待核对", turns: ["两个数都乘十，变成125除以5。", "哎呀老师，您别总跟我绕这个单位啦。我就想知道，下次遇到这种题，我是不是直接把小数点都划掉，右边补个零，然后当整数除就行了？"], focuses: [["invariance", "place_value"], "clarify"] },
];
const root = process.env.AI_DTL_REACTIONS_DIRECTORY;
if (!root || !path.isAbsolute(root)) throw Error("absoluteReactionsDirectoryRequired");
await fs.mkdir(root, { recursive: true });
const config = loadQwenConfig(), decisions = new QwenTeachingDecisionProvider(config);
const results: unknown[] = [];
let failures = 0;
const requestedScenario = process.argv.find(arg => arg.startsWith("--scenario="))?.slice("--scenario=".length);
const selected = scenarios.filter(s => !requestedScenario || s.name === requestedScenario);
if (!selected.length) throw Error("unknownScenario");
for (const scenario of selected) {
  const history: TeachingDecision[] = [], sessionId = randomUUID();
  const record: WorkspaceRecord = { schemaVersion: 2, sessionId, eventId: randomUUID(), revision: 0,
    problem: { source: "curated", problemId: randomUUID(), challengeId: "reactions", packVersion: "1",
      curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数除法" },
      statement: { text: "12.5÷0.5", revision: 0, confirmed: true } }, phase: "exploring",
    childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
  for (const [index, child] of scenario.turns.entries()) {
    const turnId = randomUUID(), action = conversationAction("dialogue", child);
    const started = performance.now();
    try {
      // 此探针只检查教学决策/播报；correct的完整命令链另外在WS测试中验证。
      const decision = await decisions.decide({ record, turnId, responseId: randomUUID(), child, history,
        permission: action === "help" ? "hint" : action === "correct" ? "clarification" : "review" });
      const expected = scenario.focuses[index]!;
      if (!(Array.isArray(expected) ? expected : [expected]).includes(decision.focus)) throw Error(`focus:${decision.focus}`);
      const audio: Buffer[] = [];
      if (process.argv.includes("--speech")) {
        await speakDecision(decision, () => new WorkspaceVoiceProvider(config), pcm => audio.push(pcm), undefined, { sessionId, turnId });
        await fs.writeFile(path.join(root, `${scenario.name}-${index}.pcm`), Buffer.concat(audio));
      }
      history.push(decision);
      const result = { scenario: scenario.name, index, child, action, decision, audioBytes: Buffer.concat(audio).length, ms: Math.round(performance.now() - started) };
      results.push(result); console.log(JSON.stringify(result));
    } catch (error) {
      failures++; const failure = { scenario: scenario.name, index, child, error: (error as Error).message };
      results.push(failure); console.log(JSON.stringify(failure));
      break;
    }
  }
}
await fs.writeFile(path.join(root, "reactions.json"), JSON.stringify({ scenarios: selected.length, failures, results }, null, 2));
console.log(JSON.stringify({ scenarios: selected.length, failures, turns: results.length }));
if (failures) process.exitCode = 1;
