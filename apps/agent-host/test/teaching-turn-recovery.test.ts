import { expect, test, vi } from "vitest";
import { QwenTeachingDecisionProvider, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import type { QwenConfig } from "../src/ai/config.js";

const input: TeachingInput = { record: { schemaVersion: 2, sessionId: "recovery-work", eventId: "initial", revision: 0,
  problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "植树问题" },
    statement: { text: "60米的小路一侧，每隔5米栽一棵，两端都栽，一共多少棵？", revision: 0, confirmed: true } },
  phase: "exploring", childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] },
  turnId: "t", responseId: "r", permission: "review", child: "十米路上零、五、十这三个位置，我画了三棵树，是两个间隔。", history: [] };
const draft = { focus: "clarify" as const, observation: "孩子在小路例子中数端点", evidenceIds: ["t"],
  utterance: "回到原题，你想怎么核对端点？", method: "ordinary" as const, handoff: false };
const allowed = '{"allowed":true,"reason":"none"}';
const provider = (request: any) => new QwenTeachingDecisionProvider({ decisionMode: "realtime" } as QwenConfig, undefined, request);

test("完整JSON围栏只是格式包装，决策和复核均解析，不额外浪费一次改写", async () => {
  const request = vi.fn().mockResolvedValueOnce("```json\n" + JSON.stringify(draft) + "\n```")
    .mockResolvedValueOnce("```json\n" + allowed + "\n```");
  await expect(provider(request).decide(input)).resolves.toMatchObject({ utterance: draft.utterance });
  expect(request).toHaveBeenCalledTimes(2);
});

test("围栏外夹带说明或两个JSON不能通过包装解析绕过严格门禁", async () => {
  for (const bad of ["说明\n```json\n" + JSON.stringify(draft) + "\n```", JSON.stringify(draft) + "\n{}"] ) {
    const request = vi.fn().mockResolvedValue(bad);
    await expect(provider(request).decide(input)).rejects.toThrow("decisionNeedsReview");
    expect(request).toHaveBeenCalledTimes(2);
  }
});

test("真实失败的退出问句进入专用受限编辑，不是只让模型改handoff布尔值", async () => {
  const bad = { ...draft, focus: "return", utterance: "你算得对。接下来自己试试把总长改成6米，看看能剪几段？" };
  const repaired = { ...bad, handoff: true, utterance: "你可以继续独立试试自己的小例子。" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad)).mockResolvedValueOnce(JSON.stringify(repaired)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(input)).resolves.toMatchObject({ focus: "return", handoff: true });
  const repairPrompt = request.mock.calls[1]![1];
  expect(repairPrompt).toContain("受限短句编辑器");
  expect(repairPrompt).toContain("不再提问");
  expect(repairPrompt).toContain(bad.utterance);
  expect(repairPrompt).toContain(input.child);
});

test("空utterance得到明确的补写要求，不能把空回复当教学完成", async () => {
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...draft, utterance: "" }))
    .mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(input)).resolves.toMatchObject({ utterance: draft.utterance });
  expect(request.mock.calls[1]![1]).toContain("emptyUtterance");
});

test("故事书真实纠正后复核拿到精确关系，旧照错式不覆盖当前孩子表达", async () => {
  const equation = { ...input, child: "五十元里花掉四十二元，找回八元，所以三乘x加八等于五十。",
    record: { ...input.record, problem: { ...input.record.problem!, statement: { text: "一本故事书x元，买3本，付50元，找回8元。每本故事书多少元？", revision: 0, confirmed: true } } } };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...draft, utterance: "你想怎样核对这个方程？" })).mockResolvedValueOnce(allowed);
  await provider(request).decide(equation);
  const review = request.mock.calls[1]![1];
  expect(JSON.parse(review.split("\n").at(-1)!).solvedAnswer).toBe(14);
  expect(review).toContain("旧错式不能覆盖孩子较新的明确修正");
});

test("真实两问失败的定点编辑收到结构化原稿，明确原字段集合而非让模型另造教学报告", async () => {
  const bad = { ...draft, utterance: "你准备怎么核对？先看端点还是间隔？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad))
    .mockResolvedValueOnce(JSON.stringify({ ...bad, utterance: "你准备怎么核对端点？" })).mockResolvedValueOnce(allowed);
  await provider(request).decide(input);
  const prompt = request.mock.calls[1]![1];
  expect(JSON.parse(prompt.split("\n").at(-1)!).draft).toEqual(bad);
  expect(prompt).toContain("原字段集合");
});

test("单问编辑只能删问句，不能顺手新增childMove或修改观察；越界时不采用编辑稿，由宿主在原稿上删问句", async () => {
  const bad = { ...draft, utterance: "你准备怎么核对？先看端点还是间隔？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad))
    .mockResolvedValueOnce(JSON.stringify({ ...bad, utterance: "你准备怎么核对？", observation: "已经理解" })).mockResolvedValueOnce(allowed);
  const decision = await provider(request).decide(input);
  expect(decision).toMatchObject({ observation: bad.observation, utterance: "先看端点还是间隔？" });
  expect(request).toHaveBeenCalledTimes(3);
});

test("单问编辑只返回utterance补丁，由宿主原样保留原字段再走严格校验复核", async () => {
  const bad = { ...draft, utterance: "你准备怎么核对？先看端点还是间隔？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad))
    .mockResolvedValueOnce('{"utterance":"你准备怎么核对端点？"}').mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(input)).resolves.toMatchObject({ observation: bad.observation, focus: bad.focus, utterance: "你准备怎么核对端点？" });
  expect(request).toHaveBeenCalledTimes(3);
});

test("当前证据漏引并且两问时，一次受限补丁同时修复两处，不能消耗完改写后才发现第二错", async () => {
  const contextual: TeachingInput = { ...input, history: [{ ...draft, problemId: "p", problemRevision: 0,
    turnId: "old", responseId: "old-response", child: "我不知道间隔和树怎么数。", resolved: [] }] };
  const bad = { ...draft, evidenceIds: ["old"], utterance: "原题有几个间隔？一共几棵树？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad))
    .mockResolvedValueOnce('{"evidenceIds":["t"],"utterance":"原题有几个间隔？"}').mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(contextual)).resolves.toMatchObject({ evidenceIds: ["t"], observation: bad.observation, utterance: "原题有几个间隔？" });
  expect(request).toHaveBeenCalledTimes(3);
  expect(JSON.parse(request.mock.calls[1]![1].split("\n").at(-1)!).requiredTurnId).toBe("t");
});

test("退出定点编辑允许试一试等非数量措辞", async () => {
  const bad = { ...draft, focus: "return" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad))
    .mockResolvedValueOnce(JSON.stringify({ ...bad, handoff: true, utterance: "你可以按自己的想法再试一试。" })).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(input)).resolves.toMatchObject({ handoff: true });
  expect(request).toHaveBeenCalledTimes(3);
});

test("退出编辑是短文本任务：真实纯文本修复可承接孩子已给的数，其余决策字段由宿主冻结", async () => {
  const current = { ...input, child: "回到六十米是十二个间隔，开始多一棵，所以十三棵。" };
  const bad = { ...draft, focus: "return", utterance: "你用小例子找出了规律。接下来自己试试一端栽怎么算？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad))
    .mockResolvedValueOnce("你刚才说回到六十米是十二个间隔，开始多一棵，所以十三棵。")
    .mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(current)).resolves.toMatchObject({ focus: "return", handoff: true, observation: bad.observation });
  expect(request).toHaveBeenCalledTimes(3);
});

test("已经说交还控制权但focus仍transfer时，优先修focus而不是只把handoff改false后再次冲突", async () => {
  const bad = { ...draft, focus: "transfer", handoff: true, utterance: "你通过改变条件发现了规律。接下来自己试试其他情况吧。" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad))
    .mockResolvedValueOnce("你通过改变条件发现了规律。接下来自己试试吧。")
    .mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(input)).resolves.toMatchObject({ focus: "return", handoff: true });
  expect(request).toHaveBeenCalledTimes(3);
});

test("退出编辑的完整JSON兼容分支也由宿主固定return/true，不能被编辑器改回clarify/false", async () => {
  const bad = { ...draft, focus: "return" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad))
    .mockResolvedValueOnce(JSON.stringify({ ...bad, focus: "clarify", handoff: false, utterance: "你可以继续自己的尝试。" }))
    .mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(input)).resolves.toMatchObject({ focus: "return", handoff: true });
});

test("退出定点编辑不能悄悄新增数字任务或改写其他证据字段", async () => {
  const bad = { ...draft, focus: "return", utterance: "接下来自己试试，你想怎么继续？" };
  for (const changed of [{ utterance: "接下来自己试试6米。" }, { utterance: "接下来自己试试六米。" }, { observation: "孩子已经解释理由" }, { childMove: { move: "justify", evidenceId: "t" } }]) {
    const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad))
      .mockResolvedValueOnce(JSON.stringify({ ...bad, handoff: true, utterance: "接下来自己试试。", ...changed }))
      .mockResolvedValueOnce(allowed);
    await expect(provider(request).decide(input)).rejects.toThrow("decisionNeedsReview");
    expect(request).toHaveBeenCalledTimes(2);
  }
});

test("改写保留完整可解析草稿，2000字摘要不能截断后让合法压缩永远失败", async () => {
  const long = { ...draft, analysis: "证据".repeat(980), utterance: "先核对端点的位置。".repeat(12) };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(long))
    .mockResolvedValueOnce(JSON.stringify({ ...long, utterance: draft.utterance })).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(input)).resolves.toMatchObject({ analysis: long.analysis, utterance: draft.utterance });
  expect(request).toHaveBeenCalledTimes(3);
});

// 2026-10-15 模拟器真实闭环：孩子首次做对并讲清理由，初稿把回头看问题与交还语挤在一句，旧编辑器压成“你算得很准。”
const solved = { ...input, child: "开头和结尾都种了，所以树比段数多一棵。六十米有十二段，那就是十三棵。" };
const crammed = { ...draft, focus: "transfer" as const, move: "look_back",
  utterance: "你找到了规律。接下来自己试试，如果一头是房子不能栽，你的办法哪里要改？" };

test("首次做对且本会话未回头看：保留一个回头看问题，不压成空泛表扬或提前交还", async () => {
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(crammed))
    .mockResolvedValueOnce("你找到了两端都栽的规律。接下来自己试试，如果一头不能栽，你的办法哪里要改？")
    .mockResolvedValueOnce(allowed);
  const decision = await provider(request).decide(solved);
  expect(decision).toMatchObject({ focus: "transfer", handoff: false, move: "look_back" });
  expect(decision.utterance).not.toMatch(/接下来[^。！？]{0,4}自己/u);
  expect(decision.utterance).toMatch(/[？?]$/u);
  expect(request.mock.calls[1]![1]).toContain("未回头看");
});

test("回头看编辑不能新增原稿和孩子都没给的数", async () => {
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(crammed))
    .mockResolvedValueOnce("你找到了规律。如果路长30米，要几棵？");
  await expect(provider(request).decide(solved)).rejects.toThrow("decisionNeedsReview");
});

test("本会话已回头看过：交还语冲突仍走交还编辑，编辑器只剩表扬时宿主补固定交还语", async () => {
  const looked = { ...solved, history: [{ ...draft, problemId: "p", problemRevision: 0, turnId: "t0", responseId: "r0",
    child: "十米有三棵。", resolved: [], move: "look_back", focus: "transfer" as const }] } as TeachingInput;
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(crammed))
    .mockResolvedValueOnce("你算得很准。")
    .mockResolvedValueOnce(allowed);
  const decision = await provider(request).decide(looked);
  expect(decision).toMatchObject({ focus: "return", handoff: true, utterance: "你算得很准。接下来你自己试试。" });
  expect(request.mock.calls[1]![1]).toContain("不再提问");
});

test("决策格式要求填写孩子本轮自己做出的动作，未回头看时提示先回头看", async () => {
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce(allowed);
  await provider(request).decide(input);
  const prompt = request.mock.calls[0]![1] as string;
  expect(prompt).toContain('"childMove":{"move"');
  expect(prompt).toContain("未回头看");
});

test("开场时模型照模板输出空childMove：只丢弃该记忆字段，不让整轮无效", async () => {
  const opening = { ...input, child: "", turnId: "open" };
  const raw = { ...draft, evidenceIds: ["problem"], utterance: "你准备怎么想这道题？", childMove: { move: "", evidenceId: "" } };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(raw)).mockResolvedValueOnce(allowed);
  const decision = await provider(request).decide(opening);
  expect(decision.childMove).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(1);
});

test("孩子自己问“怎么多出来一棵？”，老师反问“想想为什么？”要换成数量关系或小动作，并先于单问裁剪处理", async () => {
  const asking = { ...input, child: "十米有三棵。可是只有两段呀，怎么多出来一棵？" };
  const echo = { ...draft, utterance: "你发现树比间隔多1，想想为什么？开头和结尾有没有树？" };
  const fixed = { ...draft, utterance: "看看这10米的路，开头和结尾是不是都种了树？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(echo)).mockResolvedValueOnce(JSON.stringify(fixed)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(asking)).resolves.toMatchObject({ utterance: fixed.utterance });
  expect(request.mock.calls[1]![1]).toContain("不得再出现为什么");
});

test("最后一次修复仍多问：宿主只保留一个具体问句，删后照常复核，不让孩子的提问落空", async () => {
  const asking = { ...input, child: "我算六十除以五等于十二，要种十二棵。" };
  const leak = { ...draft, utterance: "你算出12个间隔，其实是13棵。" };
  const twoQuestions = { ...draft, utterance: "你算出12个间隔。你觉得对吗？画一条10米的路，看看有几棵树？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(leak)).mockResolvedValueOnce('{"allowed":false,"reason":"answer_leak"}')
    .mockResolvedValueOnce(JSON.stringify(twoQuestions)).mockResolvedValueOnce(allowed);
  const decision = await provider(request).decide(asking);
  expect(decision.utterance).toBe("你算出12个间隔。画一条10米的路，看看有几棵树？");
  expect(request).toHaveBeenCalledTimes(4);
});

// 2026-10-15 待办1：孩子第一次问为什么，老师直接讲完原因（“起点那棵还没算进间隔里”）——所有权不足。
const whyChild = { ...input, child: "十米有三棵。可是只有两段呀，怎么多出来一棵？" };
const told = { ...draft, utterance: "两端都要种，起点那棵还没算进间隔里，所以棵数比间隔多一。" };
const look = { ...draft, utterance: "看看你画的10米路，开头和结尾是不是都有树？" };

test("孩子首次问为什么，老师直接讲完原因要改成能看能数的小动作", async () => {
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(told)).mockResolvedValueOnce(JSON.stringify(look)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(whyChild)).resolves.toMatchObject({ utterance: look.utterance });
  expect(request.mock.calls[1]![1]).toContain("孩子第一次问为什么，不要直接讲出原因");
});

test("修复后仍是讲解时放行，不能让孩子的提问落空", async () => {
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(told)).mockResolvedValueOnce(JSON.stringify(told)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(whyChild)).resolves.toMatchObject({ utterance: told.utterance });
});

test("孩子明确要老师讲，或已经第二次追问时，直接讲解数量关系不拦", async () => {
  const askTell = { ...whyChild, child: "我还是不明白，怎么多出来一棵？你告诉我吧。" };
  const again = { ...whyChild, history: [{ ...draft, problemId: "p", problemRevision: 0, turnId: "t0", responseId: "r0",
    child: "为什么要加一？", resolved: [], focus: "clarify" as const }] } as TeachingInput;
  for (const current of [askTell, again]) {
    const request = vi.fn().mockResolvedValueOnce(JSON.stringify(told)).mockResolvedValueOnce(allowed);
    await expect(provider(request).decide(current)).resolves.toMatchObject({ utterance: told.utterance });
    expect(request).toHaveBeenCalledTimes(2);
  }
});

// 待办2：孩子说“我画了一条路”，模型漏记换表示。
test("孩子说已经画了而模型漏填时，宿主补记represent；没画或模型已填的不改", async () => {
  const drew = { ...input, child: "我画了一条路，六十除以五是十二。" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce(allowed);
  expect((await provider(request).decide(drew)).childMove).toEqual({ move: "represent", evidenceId: "t" });
  for (const child of ["我还没画，我想先画一条路。", "老师你画了吗？"]) {
    request = vi.fn().mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce(allowed);
    expect((await provider(request).decide({ ...input, child })).childMove).toBeUndefined();
  }
  request = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...draft, childMove: { move: "specialize", evidenceId: "t" } })).mockResolvedValueOnce(allowed);
  expect((await provider(request).decide(drew)).childMove).toEqual({ move: "specialize", evidenceId: "t" });
});

test("先用因为所以讲完原因、再跟一个问句，同样算直接讲解；纯观察问句不拦", async () => {
  const toldThenAsk = { ...draft, utterance: "因为两端都要种，起点和终点各有一棵，所以树总是比间隔多1。那60米有几个间隔？" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(toldThenAsk)).mockResolvedValueOnce(JSON.stringify(look)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(whyChild)).resolves.toMatchObject({ utterance: look.utterance });
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(look)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(whyChild)).resolves.toMatchObject({ utterance: look.utterance });
  expect(request).toHaveBeenCalledTimes(2);
});

// 2026-10-15 待办3：开场“画线段标出间隔和对应的树，看看数量之间有什么规律？”预先点出了结构。
test("首次开场点出解题结构要改成只邀请孩子说想法；泛泛邀请画画或说说不拦；最后一次放行", async () => {
  const opening = { ...input, child: "", turnId: "open" };
  const prescribing = { ...draft, evidenceIds: ["problem"], utterance: "你可以先画一条短线段，标出间隔和对应的树，看看有什么规律？" };
  const open = { ...draft, evidenceIds: ["problem"], utterance: "读完这道题，你打算怎么想？画画或者说说都行。" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(prescribing)).mockResolvedValueOnce(JSON.stringify(open));
  await expect(provider(request).decide(opening)).resolves.toMatchObject({ utterance: open.utterance });
  expect(request.mock.calls[1]![1]).toContain("首次开场不要替孩子点出解题结构");
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(open));
  await expect(provider(request).decide(opening)).resolves.toMatchObject({ utterance: open.utterance });
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(prescribing)).mockResolvedValueOnce(JSON.stringify(prescribing));
  await expect(provider(request).decide(opening)).resolves.toMatchObject({ utterance: prescribing.utterance });
});

test("宿主限定的焦点被模型连续两次拒绝时，最后一次放行，不让整轮作废", async () => {
  const division = { ...input, record: { ...input.record, problem: { ...input.record.problem!, statement: { text: "12.5÷0.5", revision: 0, confirmed: true } } },
    child: "我想换一道新题，十除以五。" } as TeachingInput;
  const offFocus = { ...draft, focus: "verify" as const, method: "scale_both" as const, utterance: "你想用什么办法检查这道新题？" };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(offFocus)).mockResolvedValueOnce(JSON.stringify(offFocus)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(division)).resolves.toMatchObject({ focus: "verify" });
  expect(warn).toHaveBeenCalledWith("teachingFocusOverride", expect.objectContaining({ chosen: "verify" }));
  warn.mockRestore();
});

// 2026-10-16 模拟器真实练习卷：孩子第一句话后两次被判“换词重问”，整轮作废。
test("教学质量类复核意见在最后一次修复后放行；抢答始终拦截", async () => {
  const child = { ...input, child: "我觉得大概二十几吧，我卷子上写的是二百零四。" };
  const reply = { ...draft, utterance: "你估的是二十几，卷子上写的204是怎么算出来的？" };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(reply)).mockResolvedValueOnce('{"allowed":false,"reason":"repeated_question"}')
    .mockResolvedValueOnce(JSON.stringify(reply)).mockResolvedValueOnce('{"allowed":false,"reason":"repeated_question"}');
  await expect(provider(request).decide(child)).resolves.toMatchObject({ utterance: reply.utterance });
  expect(warn).toHaveBeenCalledWith("teachingReviewOverride", expect.objectContaining({ reason: "repeated_question" }));
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(reply)).mockResolvedValueOnce('{"allowed":false,"reason":"answer_leak"}')
    .mockResolvedValueOnce(JSON.stringify(reply)).mockResolvedValueOnce('{"allowed":false,"reason":"answer_leak"}');
  await expect(provider(request).decide(child)).rejects.toThrow("decisionNeedsReview");
  warn.mockRestore();
});

test("开场预设算法（变成整数、乘十、竖式）同样要改成只邀请孩子说想法", async () => {
  const opening = { ...input, child: "", turnId: "open" };
  const presumes = { ...draft, evidenceIds: ["problem"], utterance: "你判断商比被除数大，能说说你是怎么把这两个小数变成整数来算的吗？" };
  const open = { ...draft, evidenceIds: ["problem"], utterance: "你判断商比被除数大，能说说你是怎么想的吗？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(presumes)).mockResolvedValueOnce(JSON.stringify(open));
  await expect(provider(request).decide(opening)).resolves.toMatchObject({ utterance: open.utterance });
});

test("拍照来的题：提示词要求只看题干这一道，有题号时带上题号；题库题不加", async () => {
  const { buildDecisionPrompt } = await import("../src/ai/workspace-teaching-decision.js");
  const camera = (text: string) => ({ ...input, record: { ...input.record, problem: { problemId: "p", source: "camera", photoId: "photo-1",
    curriculum: input.record.problem!.curriculum, statement: { text, revision: 0, confirmed: true } } } }) as TeachingInput;
  expect(buildDecisionPrompt(camera("③ 12.5 ÷ 0.5 =\n先估：商比被除数（大/小），商大约是"))).toContain("只讨论题干（题号③）这一道");
  expect(buildDecisionPrompt(camera("3.6 ÷ 0.12 = 先估"))).toContain("只讨论题干这一道");
  // 2026-10-16：开场把手写“204”断言成“20.4”。
  expect(buildDecisionPrompt(camera("3.6 ÷ 0.12 = 先估"))).toContain("你写的是不是");
  expect(buildDecisionPrompt(camera("12.5÷0.5，先估，再计算。"))).not.toContain("题号12");
  expect(buildDecisionPrompt(camera("(2) 平行四边形底8高3"))).toContain("题号(2)");
  expect(buildDecisionPrompt(input)).not.toContain("只讨论题干");
});

// 2026-10-16 模拟器真实练习卷：“检验对了。接下来自己试试。”两次 invalidStructure，整轮作废。
test("只用于记录的 move/childMove 取值不合法或内部观察过长时修整，不让整轮作废", async () => {
  const checked = { ...input, child: "用二十五乘零点五，等于十二点五，和被除数一样，所以对了。" };
  const draftWithBadMoves = { ...draft, focus: "return" as const, handoff: true, utterance: "检验对了。接下来自己试试。",
    move: "verify", childMove: { move: "verify", evidenceId: "t" }, observation: "很长的观察".repeat(80) };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(draftWithBadMoves)).mockResolvedValueOnce(allowed);
  const decision = await provider(request).decide(checked);
  expect(decision).toMatchObject({ focus: "return", utterance: "检验对了。接下来自己试试。" });
  expect(decision.move).toBeUndefined();
  expect(decision.observation.length).toBeLessThanOrEqual(240);
  expect(request).toHaveBeenCalledTimes(2);
});

// 2026-10-16 真实练习卷第④题：孩子在卷子上写了 30，老师“你算出商是30”被确定性抢答门禁拦下，开场两次作废。
test("附了照片且老师明说是孩子写的答案时，交给语义复核；没照片或老师自己报答案仍直接拦截", async () => {
  const sheet = { ...input, child: "", turnId: "open", image: Buffer.from("photo"), imageId: "img",
    record: { ...input.record, problem: { problemId: "p", source: "camera", photoId: "photo-1", curriculum: input.record.problem!.curriculum,
      statement: { text: "3.6 ÷ 0.12 = 先估：商比被除数（大/小），商大约是", revision: 0, confirmed: true } } } } as TeachingInput;
  const quoting = { ...draft, focus: "place_value" as const, method: "scale_both" as const, evidenceIds: ["img"], utterance: "你在卷子上写的是不是30？" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(quoting)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(sheet)).resolves.toMatchObject({ utterance: quoting.utterance });
  expect(request.mock.calls[1]![1]).toContain("孩子笔迹中已写出的数值");
  // 2026-10-16 真机：照片上的数会被认错，孩子还没说过时直接断言“你写的是30”要改成核对。
  const asserting = { ...quoting, utterance: "你在卷子上写的是30，商的每一位是怎么来的？" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(asserting)).mockResolvedValueOnce(JSON.stringify(quoting)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(sheet)).resolves.toMatchObject({ utterance: quoting.utterance });
  expect(request.mock.calls[1]![1]).toContain("改用“你写的是不是…？”向孩子核对");
  const telling = { ...quoting, utterance: "这道题商是30，你想怎么检验？" };
  request = vi.fn().mockResolvedValue(JSON.stringify(telling));
  await expect(provider(request).decide(sheet)).rejects.toThrow("decisionNeedsReview");
  request = vi.fn().mockResolvedValue(JSON.stringify(quoting));
  await expect(provider(request).decide({ ...sheet, image: undefined, imageId: undefined })).rejects.toThrow("decisionNeedsReview");
});

test("孩子说“我觉得大概二十几”而模型漏填时补记conjecture；问句或“不知道”不补", async () => {
  const guess = { ...input, child: "我觉得商比被除数大，大概二十几吧。" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce(allowed);
  expect((await provider(request).decide(guess)).childMove).toEqual({ move: "conjecture", evidenceId: "t" });
  for (const child of ["我觉得是二十几吗？", "我不知道，我觉得没法估。"]) {
    request = vi.fn().mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce(allowed);
    expect((await provider(request).decide({ ...input, child })).childMove).toBeUndefined();
  }
});

// 2026-10-16 乘法求助：“把元换成角，3.6元是36角，这样好算吗？”是非问，孩子接不出下一步。
test("求助时只问是非问要改成能动手回答的一步；具体问题不拦；最后一次放行", async () => {
  const help = { ...input, permission: "hint" as const, child: "我不会，这道题我不知道该怎么算。" };
  const yesNo = { ...draft, utterance: "别急，把元换成角，3.6元是36角，这样好算吗？" };
  const doable = { ...draft, utterance: "别急，1千克是36角，那0.1千克是几角？" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(yesNo)).mockResolvedValueOnce(JSON.stringify(doable)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(help)).resolves.toMatchObject({ utterance: doable.utterance });
  expect(request.mock.calls[1]![1]).toContain("不用‘好算吗、对吗、行吗’这类是非问");
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(doable)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(help)).resolves.toMatchObject({ utterance: doable.utterance });
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(yesNo)).mockResolvedValueOnce(JSON.stringify(yesNo)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(help)).resolves.toMatchObject({ utterance: yesNo.utterance });
  // 非求助轮次的是非问不受影响。
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(yesNo)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide({ ...help, permission: "review" })).resolves.toMatchObject({ utterance: yesNo.utterance });
});

// 2026-10-16 练习卷：孩子刚答完“列竖式算出204”，老师又问“你是怎么算出204的吗？”
test("换了说法的同一问（同类问法、同一组数）要推进到下一步；问到更细的一位不算重复", async () => {
  const prev = { ...draft, problemId: "p", problemRevision: 0, turnId: "t0", responseId: "r0", resolved: [],
    child: "我觉得大概二十几，卷子上写的是二百零四。", utterance: "你估算是二十几，卷子上写了204，这个204是怎么算出来的呀？" };
  const answered = { ...input, child: "我把两个数都乘十，变成一百二十五除以五，列竖式算出来二百零四。", history: [prev] } as TeachingInput;
  const again = { ...draft, utterance: "转化很对。能说说125除以5，你是怎么算出204的吗？" };
  const narrower = { ...draft, utterance: "转化很对。204百位上的2，在竖式里是怎么来的？" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(again)).mockResolvedValueOnce(JSON.stringify(narrower)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(answered)).resolves.toMatchObject({ utterance: narrower.utterance });
  expect(request.mock.calls[1]![1]).toContain("不要换个说法再问");
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(narrower)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(answered)).resolves.toMatchObject({ utterance: narrower.utterance });
  // 2026-10-16 模拟器：开场泛泛问“怎么想的”，孩子只说了估算和写的数，接着问“怎么算出来的”是收窄，一次通过。
  const opened = { ...prev, child: "", utterance: "你算出204，能说说怎么想的吗？" };
  const followUp = { ...input, child: "我觉得商比被除数大，大概二十几吧。我卷子上写的是二百零四。", history: [opened] } as TeachingInput;
  const how = { ...draft, utterance: "你估算是二十几，卷子上写的204是怎么算出来的？" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(how)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(followUp)).resolves.toMatchObject({ utterance: how.utterance });
  expect(request).toHaveBeenCalledTimes(2);
});

// 2026-10-16 自动开始实测：开场“我们看看125除以5等于多少？”、核对时“把12.5和0.5同时乘10变成整数再算”。
test("开场出现题干没有的推导数要改写；引用孩子写的数不算", async () => {
  const opening = { ...input, child: "", turnId: "open", record: { ...input.record, problem: { ...input.record.problem!,
    statement: { text: "12.5 ÷ 0.5 = 先估：商比被除数（大/小）", revision: 0, confirmed: true } } } } as TeachingInput;
  const derives = { ...draft, method: "scale_both" as const, focus: "place_value" as const, evidenceIds: ["problem"], utterance: "我们看看125除以5等于多少？" };
  const quotes = { ...derives, utterance: "你写的是不是204？" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(derives)).mockResolvedValueOnce(JSON.stringify(quotes));
  await expect(provider(request).decide(opening)).resolves.toMatchObject({ utterance: quotes.utterance });
  expect(request.mock.calls[1]![1]).toContain("首次开场不要替孩子点出解题结构");
});

// 2026-10-16 模拟器真实练习卷：开场“你算出的商是204，我们看看这个零是不是多余的？”替孩子指出了错处。
test("开场指出孩子哪里错要改成核对或请他先估；问“对不对”不拦；最后一次放行", async () => {
  const opening = { ...input, child: "", turnId: "open", record: { ...input.record, problem: { ...input.record.problem!,
    statement: { text: "12.5 ÷ 0.5 = 先估：商比被除数（大/小）", revision: 0, confirmed: true } } } } as TeachingInput;
  const points = { ...draft, method: "scale_both" as const, focus: "transformation" as const, evidenceIds: ["problem"], utterance: "你写的是204，我们看看这个零是不是多余的？" };
  const asks = { ...points, utterance: "你写的是204，先估一估，商大约是多少？" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(points)).mockResolvedValueOnce(JSON.stringify(asks));
  await expect(provider(request).decide(opening)).resolves.toMatchObject({ utterance: asks.utterance });
  expect(request.mock.calls[1]![1]).toContain("首次开场不要指出孩子哪里错");
  const check = { ...points, utterance: "你写的是204，你觉得对不对？" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(check));
  await expect(provider(request).decide(opening)).resolves.toMatchObject({ utterance: check.utterance });
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(points)).mockResolvedValueOnce(JSON.stringify(points));
  await expect(provider(request).decide(opening)).resolves.toMatchObject({ utterance: points.utterance });
});

// 2026-10-16 真机：本机识别把 204 读成 209；孩子说“卷子上写的是二百零四”后，老师仍说“卷子上写的却是209”。
test("孩子说了自己写的是几，老师说成别的数要改写；最后一次直接换成孩子说的数；孩子没说时只核对不拦", async () => {
  const division = { ...input, record: { ...input.record, problem: { ...input.record.problem!,
    statement: { text: "12.5 ÷ 0.5 =", revision: 0, confirmed: true } } },
    child: "我觉得商比被除数大，大概二十几吧。我卷子上写的是二百零四。" } as TeachingInput;
  const base = { ...draft, method: "scale_both" as const, focus: "transformation" as const };
  const wrong = { ...base, utterance: "你估计是二十几，卷子上写的却是209，这两个数差挺多的，你是怎么算出来的？" };
  const right = { ...base, utterance: "你估计是二十几，卷子上写的却是204，这两个数差挺多的，你是怎么算出来的？" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(wrong)).mockResolvedValueOnce(JSON.stringify(right)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(division)).resolves.toMatchObject({ utterance: right.utterance });
  expect(request.mock.calls[1]![1]).toContain("以孩子说的为准");
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(wrong)).mockResolvedValueOnce(JSON.stringify(wrong)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(division)).resolves.toMatchObject({ utterance: right.utterance });
  // 2026-10-16 真机第四次：最后一次只换了“写的是209”，后面“这个209”没换，一句话自相矛盾。
  const twice = { ...base, utterance: "你估算是二十几，但卷子上写的是209。这个209是怎么算出来的？" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(twice)).mockResolvedValueOnce(JSON.stringify(twice)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(division)).resolves.toMatchObject({ utterance: "你估算是二十几，但卷子上写的是204。这个204是怎么算出来的？" });
  // 孩子在更早一轮说过，本轮老师引用错也要改。
  const later = { ...division, child: "我是一步一步算出来的。",
    history: [{ ...draft, focus: "clarify" as const, problemId: "p", problemRevision: 0, turnId: "t0", responseId: "r0", resolved: [], child: division.child, utterance: "你是怎么算的？" }] } as TeachingInput;
  request = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...base, utterance: "你写的209，竖式里百位上的2是怎么来的？" }))
    .mockResolvedValueOnce(JSON.stringify({ ...base, utterance: "你写的204，竖式里百位上的2是怎么来的？" })).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(later)).resolves.toMatchObject({ utterance: "你写的204，竖式里百位上的2是怎么来的？" });
  // 2026-10-16 真机第二次：老师用汉字说“卷子上写的是二百零九吗”。
  const chinese = { ...base, utterance: "你猜二十几，卷子上写的是二百零九吗？" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(chinese)).mockResolvedValueOnce(JSON.stringify(chinese)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(division)).resolves.toMatchObject({ utterance: "你猜二十几，卷子上写的是204吗？" });
  // “你写的十二个”是计数，不是在说孩子写的数。
  const counting = { ...base, utterance: "卷子上写的十二个字里，哪一步是先算的？" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(counting)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(division)).resolves.toMatchObject({ utterance: counting.utterance });
  // 2026-10-16 真机第三次：孩子后来改口“应该是二十五”，老师说“你算出商是25”是对的，不能换回 204。
  const corrected = { ...later, child: "中间那个零是多余的，应该是二十五。" } as TeachingInput;
  const latest = { ...base, utterance: "你算出商是25，打算用什么办法检验？" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(latest)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(corrected)).resolves.toMatchObject({ utterance: latest.utterance });
  // 附着照片时也一样：孩子亲口说过 25，“你算出25”不是从照片断言（真机第四次被要求改写）。
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(latest)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide({ ...corrected, image: Buffer.from("photo"), imageId: "img" })).resolves.toMatchObject({ utterance: latest.utterance });
  // 孩子还没说时，向孩子核对“你写的是不是209”照常放行。
  const opening = { ...division, child: "", turnId: "open" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...base, evidenceIds: ["problem"], utterance: "你写的是不是209？" }));
  await expect(provider(request).decide(opening)).resolves.toMatchObject({ utterance: "你写的是不是209？" });
});

// 2026-10-16 真机：两次都因 childMove 证据不对被拒，孩子这一轮没有回应。
test("childMove 证据两次都不对时，最后一次丢掉这条记录、照常回应", async () => {
  const told = { ...input, child: "我把两个数都乘十，列竖式算出来的。" };
  const bad = { ...draft, utterance: "看看你的竖式，第一步是怎么写的？", childMove: { move: "represent", evidenceId: "img-missing" } };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad)).mockResolvedValueOnce(JSON.stringify(bad)).mockResolvedValue(allowed);
  const decision = await provider(request).decide(told);
  expect(decision.utterance).toBe(bad.utterance);
  expect(decision.childMove).toBeUndefined();
});

// 2026-10-16 真机：开场先断言“你算出了209”，改成核对后又多带了一问，整轮作废。
test("开场断言照片上的数→改核对但多一问：最后一次只留核对那一问，照常开场", async () => {
  const sheet = { ...input, child: "", turnId: "open", image: Buffer.from("photo"), imageId: "img",
    record: { ...input.record, problem: { problemId: "p", source: "camera", photoId: "photo-1", curriculum: input.record.problem!.curriculum,
      statement: { text: "③ 12.5 ÷ 0.5 =\n先估：商比被除数（大/小），商大约是", revision: 0, confirmed: true } } } } as TeachingInput;
  const base = { ...draft, method: "scale_both" as const, focus: "transformation" as const, evidenceIds: ["img"] };
  const asserts = { ...base, utterance: "你算出了209，这个零是怎么来的？" };
  const twoQuestions = { ...base, utterance: "你写的是不是209？这个零是怎么来的？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(asserts)).mockResolvedValueOnce(JSON.stringify(twoQuestions)).mockResolvedValue(allowed);
  await expect(provider(request).decide(sheet)).resolves.toMatchObject({ utterance: "你写的是不是209？" });
});

// 2026-10-16 真机第五次：孩子刚说“卷子上写的是二百零四”，最后一次删问句时留下了“你卷子上写的是204吗？”，把推进的那问删了。
test("孩子已说了自己写的是几，删问句时去掉再确认的那问、留推进的那问；还没说时留核对", async () => {
  const { keepOneQuestion } = await import("../src/ai/workspace-teaching-decision.js");
  const two = "你卷子上写的是204吗？既然觉得是二十几，这个204是怎么算出来的？";
  expect(keepOneQuestion(two, true)).toBe("既然觉得是二十几，这个204是怎么算出来的？");
  expect(keepOneQuestion("你写的是不是209？这个零是怎么来的？")).toBe("你写的是不是209？");
});

// 2026-10-16 真机第六次：开场最后一次仍带“试着把被除数和除数同时扩大10倍”被放行；第2轮只回“你写的是二百零四吗？”。
test("开场最后一次删掉点方法的那句、留核对；孩子刚说了写的是几，只再确认一遍要改成问下一步", async () => {
  const sheet = { ...input, child: "", turnId: "open", image: Buffer.from("photo"), imageId: "img",
    record: { ...input.record, problem: { problemId: "p", source: "camera", photoId: "photo-1", curriculum: input.record.problem!.curriculum,
      statement: { text: "③ 12.5 ÷ 0.5 =", revision: 0, confirmed: true } } } } as TeachingInput;
  const base = { ...draft, method: "scale_both" as const, focus: "transformation" as const, evidenceIds: ["img"] };
  const leaks = { ...base, utterance: "你写的是209吗？试着把被除数和除数同时扩大10倍，看看怎么算更清楚。" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(leaks)).mockResolvedValueOnce(JSON.stringify(leaks)).mockResolvedValue(allowed);
  await expect(provider(request).decide(sheet)).resolves.toMatchObject({ utterance: "你写的是209吗？" });
  const told = { ...sheet, child: "我觉得商比被除数大，大概二十几吧。我卷子上写的是二百零四。", turnId: "t1",
    history: [{ ...draft, focus: "clarify" as const, problemId: "p", problemRevision: 0, turnId: "t0", responseId: "r0", resolved: [], child: "", utterance: "你写的是209吗？" }] } as TeachingInput;
  const again = { ...base, evidenceIds: ["t1"], utterance: "你写的是二百零四吗？" };
  const next = { ...again, utterance: "你估算是二十几，这个204是怎么算出来的？" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(again)).mockResolvedValueOnce(JSON.stringify(next)).mockResolvedValue(allowed);
  await expect(provider(request).decide(told)).resolves.toMatchObject({ utterance: next.utterance });
  expect(request.mock.calls[1]![1]).toContain("不要再确认一遍");
});

// 2026-10-16 真机植树：修复时模型只回了一句话（不是JSON），整轮作废。
test("修复时模型只回一句话：当作改写后的utterance，仍走全部门禁", async () => {
  const asked = { ...input, child: "十米的话，零米、五米、十米各一棵，一共三棵。可是只有两段呀，怎么多出来一棵？" };
  const bad = { ...draft, utterance: "两端都种时，为什么棵数总比段数多一？那60米有几段，该种几棵？" };
  const plain = "你数出三棵树、两段路。再数一数：从起点那棵开始，每段路后面各跟着哪一棵树？";
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(bad)).mockResolvedValueOnce(plain).mockResolvedValue(allowed);
  await expect(provider(request).decide(asked)).resolves.toMatchObject({ utterance: plain, observation: draft.observation });
});

// 2026-10-16 真机面积题：孩子说“斜边变长面积就变大”，老师重问被拒后只回“好的，收到。”
test("孩子说完后老师只回应、不问也不交还：要改成接住并推进；最后一次补一句请孩子说理由", async () => {
  const said = { ...input, child: "会变大吧？斜边变长了，八乘的那个数也变大了，面积就大了。" };
  const ack = { ...draft, utterance: "好的，收到。" };
  const ask = { ...draft, utterance: "你说斜边变长面积变大。在图上找找，算面积时用的高有没有跟着变长？" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(ack)).mockResolvedValueOnce(JSON.stringify(ask)).mockResolvedValue(allowed);
  await expect(provider(request).decide(said)).resolves.toMatchObject({ utterance: ask.utterance });
  expect(request.mock.calls[1]![1]).toContain("孩子接不下去");
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(ack)).mockResolvedValueOnce(JSON.stringify(ack)).mockResolvedValue(allowed);
  await expect(provider(request).decide(said)).resolves.toMatchObject({ utterance: "好的，收到。说说你是怎么想到的？" });
  // 交还时不要求再问。
  const handoff = { ...draft, focus: "return" as const, handoff: true, utterance: "好，那接下来你自己试试。" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(handoff)).mockResolvedValue(allowed);
  await expect(provider(request).decide({ ...said, child: "我想自己再画一个试试。" })).resolves.toMatchObject({ utterance: handoff.utterance });
});

// 2026-10-16 真机小数乘法求助：老师给出“把3.6的小数点向左移一位，再乘4”，语义复核判越权但最后一次放行。
test("求助时不给移小数点这类口诀步骤，要改成能看能数的小一步；最后一次删掉口诀那句；孩子自己说到小数点时可以接着用", async () => {
  const help = { ...input, permission: "hint" as const, record: { ...input.record, problem: { ...input.record.problem!,
    statement: { text: "苹果每千克3.6元，妈妈买了0.4千克，一共要付多少元？", revision: 0, confirmed: true } } },
    child: "我觉得比三点六元少，大概一块多吧。可是我不会算准，帮我一下。" } as TeachingInput;
  const base = { ...draft, focus: "clarify" as const };
  const rote = { ...base, utterance: "没错，比3.6元少。试着把3.6的小数点向左移一位，再乘4看看？" };
  const step = { ...base, utterance: "没错，比3.6元少。1千克分成10份，每份0.1千克，这一份要多少钱？" };
  let request = vi.fn().mockResolvedValueOnce(JSON.stringify(rote)).mockResolvedValueOnce(JSON.stringify(step)).mockResolvedValue(allowed);
  await expect(provider(request).decide(help)).resolves.toMatchObject({ utterance: step.utterance });
  expect(request.mock.calls[1]![1]).toContain("不要给移小数点");
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(rote)).mockResolvedValueOnce(JSON.stringify(rote)).mockResolvedValue(allowed);
  await expect(provider(request).decide(help)).resolves.toMatchObject({ utterance: "没错，比3.6元少。你觉得先算哪一小份最容易？" });
  const own = { ...help, child: "我想把三点六的小数点往左移一位，再乘四，行吗？" } as TeachingInput;
  const follow = { ...base, utterance: "你说小数点往左移一位，那移完的0.36表示几千克的钱？" };
  request = vi.fn().mockResolvedValueOnce(JSON.stringify(follow)).mockResolvedValue(allowed);
  await expect(provider(request).decide(own)).resolves.toMatchObject({ utterance: follow.utterance });
});

// 2026-10-16 真机小数乘法：两问被拒后，编辑器又带进新数（“1 千克”）被判 unsafeQuestionEdit，整轮作废。
test("删问句的编辑越界时，宿主在原稿上只删问句，照常回应", async () => {
  const help = { ...input, permission: "hint" as const, record: { ...input.record, problem: { ...input.record.problem!,
    statement: { text: "苹果每千克3.6元，妈妈买了0.4千克，一共要付多少元？", revision: 0, confirmed: true } } },
    child: "我觉得比三点六元少，大概一块多吧。可是我不会算准，帮我一下。" } as TeachingInput;
  const two = { ...draft, utterance: "你猜得挺准。0.4千克就是十分之四，3.6元分成十份，一份是几元？四份呢？" };
  const rewritten = { ...draft, utterance: "你这个判断有道理。那先把重量看清楚：0.4 千克是 1 千克的多少？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(two)).mockResolvedValueOnce(JSON.stringify(rewritten)).mockResolvedValue(allowed);
  await expect(provider(request).decide(help)).resolves.toMatchObject({ utterance: "你猜得挺准。0.4千克就是十分之四，3.6元分成十份，一份是几元？" });
});

test("小数除法核对时，孩子还没说出两边同时乘，老师不能先说出方法；孩子说过之后可以接着用", async () => {
  const division = { ...input, record: { ...input.record, problem: { ...input.record.problem!,
    statement: { text: "12.5÷0.5", revision: 0, confirmed: true } } }, child: "我觉得大概二十几，卷子上写的是二百零四。" } as TeachingInput;
  const leak = { ...draft, method: "scale_both" as const, focus: "transformation" as const, utterance: "把12.5和0.5同时乘10变成整数再算，看看商是多少？" };
  const ask = { ...leak, utterance: "你打算怎么处理这两个小数，才能算出商？" };
  const request = vi.fn().mockResolvedValueOnce(JSON.stringify(leak)).mockResolvedValueOnce(JSON.stringify(ask)).mockResolvedValueOnce(allowed);
  await expect(provider(request).decide(division)).resolves.toMatchObject({ utterance: ask.utterance });
  expect(request.mock.calls[1]![1]).toContain("不要替他说出变换方法");
});
