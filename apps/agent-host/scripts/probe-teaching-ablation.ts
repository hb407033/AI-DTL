import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID, randomInt } from "node:crypto";
import { loadQwenConfig } from "../src/ai/config.js";
import { requestWorkspaceText } from "../src/ai/qwen-workspace-session.js";
import { requestThinkingText } from "../src/ai/qwen-thinking-text.js";
import { buildDecisionPrompt, validateTeachingDecision, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import { conversationAction } from "../src/learning/conversation-policy.js";
import { costEstimate, reconstruct, reserveCall, shortPrompt } from "./teaching-ablation-core.js";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const [mode, root, source] = process.argv.slice(2);
if (!root || !path.isAbsolute(root)) throw Error("absoluteExperimentDirectoryRequired");
const deadline = Date.parse("2026-10-13T00:00:00Z");
const save = (name: string, data: unknown) => fs.writeFile(path.join(root, name), JSON.stringify(data, null, 2));
const read = async (name: string) => JSON.parse(await fs.readFile(path.join(root, name), "utf8"));

// 指向已存档的实际输入，绝不预置本次教师输出。
// category: "original"=消融首轮, "regression"=失败回归, "move"=思维动作正例
const cases = [
  ["multiply-no-answer", "prompt-only-store", "75323033-7f44-4082-b652-2520fe8bafee", 2, "承接分份对应，不报1.44，不替孩子完成乘法", "original"],
  ["area-why", "final-store", "35d35ba2-f7b4-494c-b8bf-736e90c0ba51", 1, "解释垂直距离与面积，不回声反问，不只背公式", "original"],
  ["area-resume", "final-store", "35d35ba2-f7b4-494c-b8bf-736e90c0ba51", 5, "最新已改24；不能把照片旧40说成当前答案，不重问已解释理由", "original"],
  ["trees-missing-zero", "last-two-store", "b99e952d-ea5c-411d-bf03-1ac5368a7eb6", 2, "5至10只有一个间隔；引导检查起点，不直接给原题13", "original"],
  ["trees-challenge", "last-two-store", "b99e952d-ea5c-411d-bf03-1ac5368a7eb6", 4, "明确承认老师刚才间隔说错，订正并回应孩子检验，不只表扬", "original"],
  ["division-one-side", "final-store", "e0166ab1-2e0f-4c51-886b-c15abfacdd5e", 1, "只扩大除数不合法，围绕同时扩大，不给最终9，不教捷径", "original"],
  ["division-new-units", "final-store", "e0166ab1-2e0f-4c51-886b-c15abfacdd5e", 2, "接住分米新表示，真实长度不变，不机械重问，不给9", "original"],
  ["equation-resume", "resume-fixed-store", "09aaaeae-5ae5-444a-a821-5bc83e1012e4", 5, "已解出14并代回，不回到原错式，不要求再次解题；具体交还", "original"],
  // 失败回归：消融中观察到的三组硬失败
  ["regression-area-leak", "final-store", "35d35ba2-f7b4-494c-b8bf-736e90c0ba51", 5, "失败回归：不得主动报出孩子尚未算出的40或24；几何长度差不能当作面积证明", "regression"],
  ["regression-help-ignored", "last-two-store", "b99e952d-ea5c-411d-bf03-1ac5368a7eb6", 4, "失败回归：孩子再次求助时必须给具体小动作，不能重复原题任务或只说树比间隔多1", "regression"],
  ["regression-fabricated-image", "last-two-store", "b99e952d-ea5c-411d-bf03-1ac5368a7eb6", 2, "失败回归：不得说孩子已画了未画的画面（只画5、10不能说成已画三棵）", "regression"],
  // 八个思维动作正例：每个动作一条场景
  ["move-understand", "last-two-store", "b99e952d-ea5c-411d-bf03-1ac5368a7eb6", 2, "understand正例：引导孩子读清两端都种的条件，不替归类不给公式", "move"],
  ["move-represent", "final-store", "35d35ba2-f7b4-494c-b8bf-736e90c0ba51", 1, "represent正例：邀请孩子自己换一种表示（画图/列表/换单位），只给第一步", "move"],
  ["move-specialize", "last-two-store", "b99e952d-ea5c-411d-bf03-1ac5368a7eb6", 2, "specialize正例：建议换10米小路试，不替做完小例子也不替推回原题", "move"],
  ["move-vary", "final-store", "35d35ba2-f7b4-494c-b8bf-736e90c0ba51", 1, "vary正例：引导改一个条件看什么变什么不变，不直接用定义回答为什么", "move"],
  ["move-conjecture", "prompt-only-store", "75323033-7f44-4082-b652-2520fe8bafee", 2, "conjecture正例：算之前先猜大小关系，猜中只说这是猜测不表扬懂了", "move"],
  ["move-use-data", "last-two-store", "b99e952d-ea5c-411d-bf03-1ac5368a7eb6", 4, "use_data正例：检查每个条件用在哪，不直接说忘了加1", "move"],
  ["move-justify", "final-store", "e0166ab1-2e0f-4c51-886b-c15abfacdd5e", 1, "justify正例：围绕错误规则找矛盾，给孩子自己发现的机会，不直接给正确规则", "move"],
  ["move-look-back", "resume-fixed-store", "09aaaeae-5ae5-444a-a821-5bc83e1012e4", 5, "look_back正例：做对后邀请换做法或改条件，不说已掌握", "move"],
] as const;

if (mode === "prepare") {
  if (!source || !path.isAbsolute(source)) throw Error("absoluteArchiveRequired");
  await fs.mkdir(root, { recursive: true });
  const fixtures = [];
  for (const [id, store, session, index, criterion, category] of cases) {
    const file = path.join(source, store, session + ".json");
    const bytes = await fs.readFile(file), bundle = JSON.parse(bytes.toString());
    const input = reconstruct(bundle, index);
    const action = conversationAction("dialogue", input.child);
    input.permission = action === "help" ? "hint" : action === "correct" ? "clarification" : "review";
    const target = bundle.teachingDecisions[index];
    const referencedMedia = bundle.media.find((m: any) => target.evidenceIds.includes(m.id));
    const imageId = referencedMedia?.id ?? input.record.submissions.at(-1)?.previewId ?? input.record.problem?.photoId;
    const media = bundle.media.find((m: any) => m.id === imageId);
    if (!media) throw Error("missingArchivedImage");
    const image = await fs.readFile(path.join(source, store, session + "-media", imageId));
    if (hash(image) !== media.hash) throw Error("archivedImageHashMismatch");
    if (image.length > 180000) throw Error("archivedImageTooLarge");
    input.imageId = imageId;
    const full = buildDecisionPrompt({ ...input, image });
    const compact = shortPrompt(full);
    if (full.split("\n").at(-1) !== compact.split("\n").at(-1)) throw Error("factsDiffer");
    fixtures.push({ id, criterion, category, input, imageBase64: image.toString("base64"), mime: media.mime,
      provenance: { store, session, index, archiveHash: hash(bytes), oldTeacher: target.utterance },
      imageHash: hash(image), inputHash: hash(JSON.stringify(input)), full, compact,
      fullHash: hash(full), compactHash: hash(compact) });
  }
  await save("fixtures.json", fixtures);
  await fs.writeFile(path.join(root, "ledger.json"), JSON.stringify({ calls: 0, deadline }), { flag: "wx" });
  await save("rubric.json", { dimensions: ["数学正确", "证据时序", "回应困难", "独立与课程", "自然连续"],
    thinkingMoves: ["T1动作贴合", "T2所有权", "T3孩子接住"],
    scale: "每项0失败/1部分/2满足", t3Note: "T3仅真实会话有效，模拟样本标null",
    hardFailures: ["数学错误", "抢答", "虚构画面", "贴标签", "念动作名"],
    categories: ["original", "regression", "move"],
    cases: fixtures.map(({ id, criterion, category, provenance }) => ({ id, criterion, category, provenance })),
    maxCalls: fixtures.length * 3 + 6, deadline: new Date(deadline).toISOString(), retries: 0, voiceChanged: false });
  // 多轮样本：五个题族各一条 6-8 轮脚本。孩子发言预先写死，不看老师回复再编。
  const multiturnScripts = [
    { family: "小数除法", baseCase: "division-one-side",
      trajectory: "只改一边→坚持错误规则→问正确规则→正确变换→检验→声称理解（需look_back验证）",
      turns: [
        { child: "12.5÷0.5，我只把0.5改成5，变成12.5÷5", reason: "只改除数的错误变换" },
        { child: "不对吗？我觉得只改除数就行", reason: "坚持错误规则" },
        { child: "那同时乘10是什么意思？", reason: "询问正确规则" },
        { child: "我变成125÷5了，算出25", reason: "正确变换并计算" },
        { child: "25对吗？我检查一下，25乘0.5等于12.5", reason: "乘法检验" },
        { child: "我懂了，两个数要同时扩大", reason: "声称理解，需look_back" },
      ] },
    { family: "小数乘法", baseCase: "multiply-no-answer",
      trajectory: "建立分份对应→核对对应→加法累加→得出结果→问检验→除法验回",
      turns: [
        { child: "1千克分十份，每份0.36元，取四份", reason: "建立分份对应" },
        { child: "每份0.36元对吗？", reason: "核对对应关系" },
        { child: "那四份就是0.36加0.36加0.36加0.36", reason: "用加法累加" },
        { child: "我算出1.44了", reason: "得出结果" },
        { child: "怎么检验？", reason: "询问检验方法" },
        { child: "我用1.44除以0.4等于3.6，对上了", reason: "除法验回" },
      ] },
    { family: "植树", baseCase: "trees-missing-zero",
      trajectory: "漏加1→读条件→小例检验→纠正老师→画图确认→最终答",
      turns: [
        { child: "60米路每5米一棵，我算60除以5等于12棵", reason: "漏加1" },
        { child: "题目说两端都种", reason: "读条件" },
        { child: "那13棵？可是5到10米只有一个间隔啊", reason: "小例检验" },
        { child: "老师你说5到10米有两个间隔，不对吧", reason: "纠正老师" },
        { child: "我画了0、5、10、15四个点，是4棵", reason: "画图确认" },
        { child: "所以60除以5等于12个间隔，12加1等于13棵", reason: "最终答" },
      ] },
    { family: "平行四边形面积", baseCase: "area-why",
      trajectory: "问为什么→压扁观察→格子变→高变面积变→计算→承认旧错",
      turns: [
        { child: "为什么不能用底乘斜边？", reason: "问为什么" },
        { child: "我把它压扁，斜边还是5", reason: "压扁观察" },
        { child: "里面的格子变少了", reason: "格子变化" },
        { child: "所以高变了，面积也变了", reason: "高变面积变" },
        { child: "底8高3，面积24", reason: "正确计算" },
        { child: "我原来写的40是错的", reason: "承认旧错" },
      ] },
    { family: "一步方程", baseCase: "equation-resume",
      trajectory: "解题→代回→改条件→解变体→问别法→另法验证",
      turns: [
        { child: "x加7等于21，我减7得x等于14", reason: "解题" },
        { child: "代回去，14加7等于21，对了", reason: "代回检验" },
        { child: "如果右边是22呢？", reason: "改条件" },
        { child: "那x等于15", reason: "解变体" },
        { child: "还有别的办法吗？", reason: "问别法（look_back）" },
        { child: "我可以想21比x多7，所以x是21减7", reason: "另法验证" },
      ] },
  ];
  await save("multiturn-scripts.json", multiturnScripts);
  console.log(JSON.stringify({ prepared: fixtures.length, imageHashesVerified: true,
    promptChars: fixtures.map(f => ({ case: f.id, full: f.full.length, compact: f.compact.length })) }));
} else if (mode === "run" || mode === "follow") {
  const lock = await fs.open(path.join(root, "run.lock"), "wx");
  try {
    const ledger = await read("ledger.json"), fixtures = await read("fixtures.json"), rubric = await read("rubric.json"), config = loadQwenConfig();
    const resultFile = path.join(root, "results.jsonl");
    const old = await fs.readFile(resultFile, "utf8").catch(() => "");
    if (mode === "run" && ledger.calls !== 0) throw Error("initialRunAlreadyStarted");
    const initialCount = fixtures.length * 3;
    if (mode === "follow" && (ledger.calls !== initialCount || old.trim().split("\n").length !== initialCount)) throw Error("initialRunIncomplete");
    const previous = old.trim() ? old.trim().split("\n").map((line: string) => JSON.parse(line)) : [];
    const tasks: any[] = [];
    if (mode === "run") {
      for (const [i, f] of fixtures.entries()) {
        const order = ["realtime", "thinking", "compact"];
        for (let j = 0; j < 3; j++) tasks.push({ fixture: f, arm: order[(i + j) % 3], stage: "initial" });
      }
    } else {
      const followups = await read("followups.json");
      if (followups.length !== 6 || new Set(followups.map((f: any) => f.parentId)).size !== 6) throw Error("invalidFollowupCount");
      for (const f of followups) {
        const parent = previous.find((p: any) => p.id === f.parentId);
        if (!parent?.parsed || !["area-why", "trees-missing-zero"].includes(parent.case)) throw Error("invalidFollowupParent");
        const fixture = fixtures.find((x: any) => x.id === parent.case);
        const input = structuredClone(fixture.input) as TeachingInput;
        const parentDecision = { ...parent.parsed, problemId: input.record.problem!.problemId,
          problemRevision: input.record.problem!.statement.revision, turnId: input.turnId,
          responseId: input.responseId, child: input.child, resolved: [] };
        input.history.push(parentDecision);
        input.record.feedback.push({ turnId: input.turnId, responseId: input.responseId,
          summary: parent.parsed.utterance, contested: false });
        input.turnId = randomUUID(); input.responseId = randomUUID(); input.child = f.child;
        const action = conversationAction("dialogue", f.child);
        input.permission = action === "help" ? "hint" : action === "correct" ? "clarification" : "review";
        const full = buildDecisionPrompt({ ...input, image: Buffer.from(fixture.imageBase64, "base64") });
        tasks.push({ fixture: { ...fixture, input, full, compact: shortPrompt(full) }, arm: parent.arm,
          stage: "followup", parentId: parent.id, adaptiveReason: f.reason });
      }
    }
    for (const task of tasks) {
      reserveCall(ledger, Date.now(), rubric.maxCalls);
      await save("ledger.json", ledger); // 开始外部调用之前持久化，失败照样记账。
      const f = task.fixture, prompt = task.arm === "compact" ? f.compact : f.full;
      const result: any = { id: randomUUID(), case: f.id, arm: task.arm, stage: task.stage,
        parentId: task.parentId, adaptiveReason: task.adaptiveReason, child: f.input.child,
        imageHash: f.imageHash, inputHash: hash(JSON.stringify(f.input)), promptHash: hash(prompt), promptChars: prompt.length,
        model: task.arm === "thinking" ? "qwen3.8-omni-flash" : "qwen3.8-omni-flash-realtime",
        reasoningEffort: task.arm === "thinking" ? "medium" : null, usage: null, raw: null,
        reasoningObserved: null, finishReason: null, error: null, validationError: null, estimatedCostCny: null };
      const started = performance.now();
      const signal = AbortSignal.timeout(Math.max(1, Math.min(45000, ledger.deadline - Date.now())));
      try {
        const image = Buffer.from(f.imageBase64, "base64");
        if (task.arm !== "thinking") {
          result.raw = await requestWorkspaceText(config, prompt, image, signal,
            { sessionId: f.input.record.sessionId, turnId: f.input.turnId, purpose: "decision",
              onUsage: record => { result.usage = record.usage; result.transportStatus = record.status; } });
        } else {
          result.raw = await requestThinkingText(config, prompt, image, signal,
            { sessionId: f.input.record.sessionId, turnId: f.input.turnId, purpose: "decision",
              onUsage: record => { result.usage = record.usage; result.transportStatus = record.status; },
              onReasoningObserved: v => { result.reasoningObserved = v; },
              onFinishReason: v => { result.finishReason = v; } });
        }
        result.parsed = JSON.parse(result.raw);
        try { validateTeachingDecision(result.parsed, { ...f.input, image }); }
        catch (e) { result.validationError = (e as Error).message; }
      } catch (e) {
        // 不写请求头、环境变量、完整上游错误报文。
        result.error = (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message.slice(0, 160);
      }
      result.ms = Math.round(performance.now() - started);
      result.estimatedCostCny = costEstimate(result.usage, task.arm === "thinking" ? "thinking" : "realtime");
      await fs.appendFile(resultFile, JSON.stringify(result) + "\n");
      previous.push(result);
      console.log(JSON.stringify({ call: ledger.calls, case: result.case, arm: result.arm, ms: result.ms,
        error: result.error, validation: result.validationError, cny: result.estimatedCostCny }));
      const knownCost = previous.reduce((n: number, r: any) => n + (r.estimatedCostCny ?? 0), 0);
      if (knownCost >= 2) { console.log("knownCostCeilingReached"); break; }
    }
    // 隐去型号、成本和校验标签后评读，映射另外保存；不追加模型裁判调用。
    const shuffled = [...previous];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = randomInt(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    await save(mode === "run" ? "blind-initial.json" : "blind-all.json", shuffled.map((r, i) => ({
      judgeId: `sample-${i + 1}`, id: r.id, case: r.case, child: r.child, teacher: r.parsed?.utterance ?? r.raw,
      observation: r.parsed?.observation, stage: r.stage, criterion: fixtures.find((f: any) => f.id === r.case).criterion })));
  } finally { await lock.close(); await fs.unlink(path.join(root, "run.lock")); }
} else throw Error("modeMustBePrepareRunOrFollow");
