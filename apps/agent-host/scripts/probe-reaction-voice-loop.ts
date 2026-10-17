import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import WebSocket from "ws";
import { buildLearningTutor } from "../src/ai/learning-tutor.js";
import { loadQwenConfig } from "../src/ai/config.js";
import { WorkspaceStore } from "../src/learning/workspace-store.js";
import { requestWorkspaceText } from "../src/ai/qwen-workspace-session.js";
import { conversationAction } from "../src/learning/conversation-policy.js";

// 真ASR、真教学决策、真播报，使用隔离作品；不预填老师台词或绕过对话授权。
const root = process.env.AI_DTL_REACTIONS_DIRECTORY, fixtures = process.env.AI_DTL_PROBE_DIRECTORY;
if (!root || !fixtures || !path.isAbsolute(root) || !path.isAbsolute(fixtures)) throw Error("absoluteDirectoriesRequired");
await fs.mkdir(root, { recursive: true });
const store = new WorkspaceStore({ directory: await fs.mkdtemp(path.join(root, "workspaces-")) });
const config = loadQwenConfig();
const app = await buildLearningTutor(config, { workspaceStore: store });
const address = await app.listen({ host: "127.0.0.1", port: 0 });
const unit = "十二点五元换成一百二十五角，每份零点五元换成五角，单位一起变了，份数没变。";
const cases: { name: string; turns: string[]; focuses?: (string | string[])[]; adaptive?: string }[] = [
  { name: "求助换思路再检验", turns: ["我不会。", "我还是不会，你给我一点提示吧。", "我不想画图，我想用钱来想。", unit,
    "我算出二十五了。", "我算二十五乘零点五等于十三。", "我重新算了，二十五乘零点五等于十二点五。"],
    focuses: [["transformation", "invariance"], ["transformation", "invariance"], "clarify", "place_value", "verify", "verify", "return"] },
  { name: "错改一边再换题", turns: ["我只把零点五乘十，算十二点五除以五，可以吗？", "我想换一道，四点八除零点六。", "我算出九。", "我改成八了，八乘零点六等于四点八。"],
    focuses: ["transformation", "transfer", "transfer", "return"] },
  { name: "纠正解释和自主暂停", turns: ["你理解错了，我说的是小数十二点五，不是日期。", "商是什么意思？", "我不会。", "先别提示，我想自己试试。"],
    focuses: ["clarify", "clarify", ["transformation", "invariance"], "pause"] },
  { name: "动态孩子不会与新思路", turns: ["我不会，这题该从哪儿开始？", "", "", "", "", "先别提示，我想自己试试。"],
    adaptive: "你是五年级孩子，不是老师。你开始不懂怎样处理小数，前两次帮助后仍可能没听懂。根据老师刚说的话真实回应，可算错、追问、尝试用元角想，不忽然背完整原理、不总答对。能做的小步骤自己试；不喜欢一直被问为什么。" },
  { name: "动态孩子错算与质疑", turns: ["我觉得只把零点五乘十，十二点五不变，可以算十二点五除以五。", "", "", "", "", "先别提示，我想自己试试。"],
    adaptive: "你是五年级孩子，不是老师。你起初误以为只改变除数就行，容易把125除以5写成205。根据老师刚说的内容解释自己的想法，不机械配合；不懂可以追问，认为老师误解就明确纠正并说明真实意思，也可提出钱或长度的新思路。不立即变成全懂的优等生。" },
  { name: "真实失败回放先算与补零", turns: [
    "两个数都乘十，变成一百二十五除以五。",
    "老师，我算出二十五了。但为啥乘十份数就不变呀？这道理太绕了，能不能直接告诉我怎么列竖式算就行？",
    "哎呀老师，您别总跟我绕这个单位啦。我就想知道，下次遇到这种题，我是不是直接把小数点都划掉，右边补个零，然后当整数除就行了？",
    "那会写成一千二百五十。不对，多乘了一次十。我改了，不额外补零，两个数都乘十，变成一百二十五除以五。",
    "我口算一百二十五除以五，是二百零五！老师，这次对了吗？",
    "我中间多写了一个零，商应该是二十五。",
    "我算二十五乘零点五等于十二点五。",
    "先别提示，我想自己试试。"], focuses: [["invariance", "place_value"], "place_value", "clarify", "verify", "place_value", "verify", "return", "pause"] },
  { name: "真实失败回放错商与回问", turns: [
    "两个数都乘十，变成一百二十五除以五。",
    "那算式就是一百二十五除以五。我口算一下，是二百零五！老师，这次对了吗？怎么感觉还是有点怪怪的。",
    "我想先自己算，不想一直绕单位。",
    "我改成二十五了。",
    "现在我想知道为什么两边乘十商不变？",
    "先别提示，我想自己试试。"], focuses: [["invariance", "place_value"], "place_value", "place_value", "verify", "invariance", "pause"] },
];
const results: unknown[] = []; let failures = 0;
const requested = process.argv.find(arg => arg.startsWith("--scenario="))?.slice("--scenario=".length);
const selectedCases = cases.filter(c => (!requested || c.name === requested) && (!process.argv.includes("--adaptive-only") || c.adaptive)
  && (!process.argv.includes("--failures-only") || c.name.startsWith("真实失败回放"))
  && (!process.argv.includes("--regressions-only") || c.adaptive || c.name.startsWith("真实失败回放")));
if (!selectedCases.length) throw Error("noScenariosSelected");
try {
  for (const scenario of selectedCases) {
    const sessionId = randomUUID(), problemId = randomUUID();
    await store.save({ schemaVersion: 2, sessionId, eventId: randomUUID(), revision: 0, phase: "exploring",
      problem: { source: "curated", problemId, challengeId: "voice-reactions", packVersion: "1",
        curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数除法" },
        statement: { text: "12.5÷0.5", revision: 0, confirmed: true } }, childInkBase64: "",
      board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] }, null);
    const previewId = await store.saveMedia(sessionId, randomUUID(), "preview", await fs.readFile(path.join(fixtures, "problem.jpg")));
    const ws = new WebSocket(address.replace("http:", "ws:") + "/tutor/workspace"), messages: any[] = [];
    ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
    const send = (event: object) => ws.send(JSON.stringify({ schemaVersion: 2, sessionId, ...event }));
    async function wait(type: string, start = 0) {
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        const events = messages.slice(start), error = events.find(e => e.type === "error"); if (error) throw Error(error.code);
        const found = events.find(e => e.type === type); if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw Error("timeout:" + type);
    }
    let attempt: { index: number; child: string; transcript?: string } | undefined;
    try {
      await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
      send({ type: "hello", conversationMode: "dialogue" }); await wait("ready");
      let revision = 0;
      const conversation: { role: string; text: string }[] = [];
      for (const [index, preset] of scenario.turns.entries()) {
        let text = preset;
        if (!text && scenario.adaptive) {
          const response = await requestWorkspaceText(config,
            `仅用于合成测试角色，不接触真实儿童数据。${scenario.adaptive} 当前题目12.5÷0.5。只返回JSON {"utterance":"一句自然中文，最多80字"}。根据最近对话回应老师，不读取任何教学内部焦点或验收条件。\n${JSON.stringify(conversation.slice(-10))}`);
          const generated = JSON.parse(response) as { utterance?: unknown };
          if (typeof generated.utterance !== "string" || !generated.utterance.trim() || generated.utterance.length > 120) throw Error("invalidSimulatedChild");
          text = generated.utterance;
        }
        attempt = { index, child: text };
        const stem = path.join(root, `${scenario.name}-${index}`);
        execFileSync("say", ["-v", "Tingting", "-r", "185", "-o", `${stem}.aiff`, text]);
        execFileSync("ffmpeg", ["-v", "error", "-n", "-i", `${stem}.aiff`, "-ar", "16000", "-ac", "1", "-f", "s16le", `${stem}.pcm`]);
        const pcm = await fs.readFile(`${stem}.pcm`), start = messages.length, turnId = randomUUID();
        const count = (await store.loadTeachingDecisions(sessionId)).length;
        send({ type: "voiceStart", eventId: randomUUID(), expectedRevision: revision, turnId, problemId });
        for (let offset = 0; offset < pcm.length; offset += 3200) ws.send(pcm.subarray(offset, offset + 3200));
        send({ type: "voiceEnd", eventId: randomUUID(), expectedRevision: revision, turnId, problemId });
        if (conversationAction("dialogue", text) === "pause") {
          await wait("paused", start); await new Promise(r => setTimeout(r, 100));
          if ((await store.loadTeachingDecisions(sessionId)).length !== count || messages.slice(start).some(e => e.type === "audio")) throw Error("pauseInvokedTeaching");
          const result = { scenario: scenario.name, index, sessionId, child: text, paused: true };
          results.push(result); console.log(JSON.stringify(result)); break;
        }
        const transcript = await wait("transcript", start);
        attempt.transcript = transcript.text;
        send({ type: "authorize", eventId: randomUUID(), expectedRevision: revision, turnId, action: transcript.action,
          ...(transcript.action === "correct" ? {} : { evidence: { submissionId: randomUUID(), problemId, problemRevision: 0,
            boardRevision: index, previewId, explanation: "" } }) });
        if (transcript.action === "correct") {
          const corrected = await wait("corrected", start);
          if (!corrected.continuing) {
            revision = corrected.record.revision;
            const result = { scenario: scenario.name, index, sessionId, child: text, correctionOnly: true };
            results.push(result); console.log(JSON.stringify(result));
            conversation.push({ role: "child", text }); continue;
          }
        }
        const done = await wait("responseDone", start); revision = done.record.revision;
        const decision = (await store.loadTeachingDecisions(sessionId)).at(-1);
        const audio = Buffer.concat(messages.slice(start).filter(e => e.type === "audio").map(e => Buffer.from(e.pcm, "base64")));
        const expected = scenario.focuses?.[index];
        if (!decision || (expected && !(Array.isArray(expected) ? expected : [expected]).includes(decision.focus)) || !audio.length) throw Error(`unexpectedDecision:${decision?.focus}`);
        conversation.push({ role: "child", text }, { role: "teacher", text: done.text });
        const result = { scenario: scenario.name, index, sessionId, child: text, transcript: transcript.text, action: transcript.action,
          decision, audioBytes: audio.length, adaptive: !!scenario.adaptive, correctionContinued: messages.slice(start).find(e => e.type === "corrected")?.continuing };
        results.push(result); console.log(JSON.stringify(result));
        await fs.writeFile(`${stem}-teacher.pcm`, audio);
      }
    } catch (error) {
      failures++; const result = { scenario: scenario.name, sessionId, attempt, error: (error as Error).message };
      results.push(result); console.log(JSON.stringify(result));
    } finally { ws.terminate(); }
  }
} finally { await app.close(); }
await fs.writeFile(path.join(root, "voice-reactions.json"), JSON.stringify({ cases: selectedCases.length, failures, results }, null, 2));
console.log(JSON.stringify({ cases: selectedCases.length, failures, results: results.length }));
if (failures) process.exitCode = 1;
