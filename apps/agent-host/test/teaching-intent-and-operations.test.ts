import { expect, test } from "vitest";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import { buildDecisionPrompt, validateTeachingDecision, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import { divisionProgress, divisionTurnIntent } from "../src/learning/decimal-division-policy.js";

const record: WorkspaceRecord = { schemaVersion: 2, sessionId: "intent-operations", eventId: "initial", revision: 0,
  problem: { source: "curated", problemId: "p", challengeId: "c", packVersion: "1",
    curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数除法" },
    statement: { text: "12.5÷0.5", revision: 0, confirmed: true } }, phase: "exploring",
  childInkBase64: "", board: { revision: 0, rectangles: [] }, submissions: [], feedback: [], openQuestions: [] };
const base: TeachingInput = { record, turnId: "t", responseId: "r", permission: "review", child: "", history: [] };
const raw = { focus: "invariance", observation: "孩子给出了两个数同时乘十的式子", evidenceIds: ["t"],
  utterance: "两个数都乘十，为什么分出来的份数没变呢？", method: "scale_both", handoff: false };
// base 是空发言的通用夹具，这些测试不测开场质量（openingPrescribesStructure 等软门禁），只跳过软门禁。
const soft = { softGates: true };
const transformed = { ...validateTeachingDecision(raw, base, soft), child: "两个数都乘十，变成125除以5。" };

test("真机续聊：商中间补零不能误判成给被除数划点补零", () => {
  const reason = "十二点五和零点五都乘十，变成一百二十五除以五。总量和每组都变成十倍，组数没变，所以商不变。";
  const history = [{ ...transformed, child: reason }];
  for (const child of [
    "我算了一百二十五除以五等于二百零五，因为我在中间补了一个零。我这样算对吗？",
    "我把商中间补了一个零，算成205，这样对吗？",
    "125除以5等于205，商里面我加了一个零。",
  ]) {
    const state = divisionProgress("12.5÷0.5", [reason, child]);
    expect(state?.operationCheck, child).toBeUndefined();
    expect(state?.resolved, child).toContain("transformation");
    expect(state?.resolved, child).toContain("invariance");
    expect(validateTeachingDecision({ ...raw, focus: "place_value", utterance: "看看商的每一位，中间这个零真的需要吗？" },
      { ...base, history, child }).focus).toBe("place_value");
  }
});

test("真机续聊：孩子改正商并乘回检验后不受旧商补零误判阻塞", () => {
  const reason = "两个数都乘十，变成125除以5。总量和每组都扩大十倍，组数没变，所以商不变。";
  const wrong = "我算了一百二十五除以五等于二百零五，因为我在中间补了一个零。我这样算对吗？";
  const child = "我重新检查了，二表示两个十，五表示五个一，中间不该写零，商是二十五。我用二十五乘零点五，算回十二点五，检验也对。";
  const input = { ...base, history: [{ ...transformed, child: reason }, { ...transformed, child: wrong }], child };
  expect(validateTeachingDecision({ ...raw, focus: "return", handoff: true,
    utterance: "你检查了商的数位，也乘回去核对了。接下来自己试试。" }, input).focus).toBe("return");
});

test("真实失败：想先列竖式时可先计算，不把未证明的理由当作必经问句", () => {
  const input = { ...base, history: [transformed], child: "老师，我算出25了。但为啥乘10份数就不变呀？这道理太绕了，能不能直接告诉我怎么列竖式算就行？" };
  const result = validateTeachingDecision({ ...raw, focus: "place_value", utterance: "先按竖式来看，125里的12表示几个十？" }, input);
  expect(result.focus).toBe("place_value");
  expect(result.resolved).not.toContain("invariance");
  expect(() => validateTeachingDecision(raw, input)).toThrow();
  expect(() => validateTeachingDecision({ ...raw, focus: "place_value", utterance: "先别管道理，用25乘0.5看看能不能变回12.5？" }, input)).toThrow("calculationStepsIgnored");
});

test("先算的选择跨轮保留，算错先查计算而非重问商不变", () => {
  const choice = { ...transformed, child: "我想先算125除以5，暂时不讲理由。" };
  const input = { ...base, history: [transformed, choice], child: "我口算一下，是205！怎么感觉怪怪的。" };
  expect(validateTeachingDecision({ ...raw, focus: "place_value", utterance: "先看125的大小，分成5份后，每份可能比总数还大吗？" }, input).focus).toBe("place_value");
  expect(() => validateTeachingDecision({ ...raw, focus: "return", handoff: true, utterance: "接下来自己试试。" }, input)).toThrow();
});

test("真实失败：当前整数式错商优先核对位值，不受原理缺证据阻塞", () => {
  const input = { ...base, history: [transformed], child: "那算式就是125除以5。我口算一下……是205！老师，这次对了吗？怎么感觉还是有点怪怪的。" };
  expect(validateTeachingDecision({ ...raw, focus: "place_value", utterance: "125除以5的商，会比125还大吗？" }, input).focus).toBe("place_value");
  expect(() => validateTeachingDecision(raw, input)).toThrow();
});

test("先算正确后可先检验，仍不伪造原理理解；主动回问理由时可以讨论", () => {
  const choice = { ...transformed, child: "我先算，不想一直绕单位。" };
  const input = { ...base, history: [transformed, choice], child: "我算出25了。" };
  const result = validateTeachingDecision({ ...raw, focus: "verify", utterance: "你准备怎样检查这个结果？" }, input);
  expect(result.resolved).not.toContain("invariance");
  expect(validateTeachingDecision({ ...raw, utterance: "可以，用同样大小的份来想，总量和每份一起扩大时组数如何变化？" }, { ...input, child: "现在我想知道为什么两边乘十商不变？" }).focus).toBe("invariance");
});

test("完整操作：不能只肯定划掉小数点而漏掉额外补零", () => {
  const input = { ...base, history: [transformed], child: "哎呀老师，您别总跟我绕这个单位啦。我就想知道，下次遇到这种题，我是不是直接把小数点都划掉、右边补个零，然后当整数除就行了？" };
  expect(() => validateTeachingDecision({ ...raw, focus: "clarify", utterance: "划掉小数点相当于同时乘10。为什么这样算出来的份数不会变呢？" }, input)).toThrow();
  const result = validateTeachingDecision({ ...raw, focus: "clarify", utterance: "先看你说的补零：12.5划掉小数点后再在右边补0，你会写成什么数？" }, input);
  expect(result.resolved).not.toContain("invariance");
  expect(result.resolved).not.toContain("transformation");
  expect(buildDecisionPrompt(input)).toContain("完整操作");
});

test("完整操作门禁阻止只肯定前半句，允许询问补零位置而不抢答", () => {
  const input = { ...base, child: "我把小数点去掉，再在后面加一个0就行了吧？" };
  expect(() => validateTeachingDecision({ ...raw, focus: "clarify", utterance: "去掉小数点就是乘10，你可以先算算。" }, input)).toThrow("incompleteOperationCheck");
  expect(() => validateTeachingDecision({ ...raw, focus: "clarify", utterance: "对，划掉小数点再补零就可以了。" }, input)).toThrow("incompleteOperationCheck");
  expect(validateTeachingDecision({ ...raw, focus: "clarify", utterance: "你说的加0是补在哪里？先把12.5变后的数写出来。" }, input).focus).toBe("clarify");
  expect(validateTeachingDecision({ ...raw, focus: "clarify", utterance: "划掉小数点再补一个零，12.5就成了多少？" }, input).focus).toBe("clarify");
  expect(() => validateTeachingDecision({ ...raw, focus: "clarify", utterance: "对，划掉小数点再补零，变成1250就行。" }, input)).toThrow("incompleteOperationCheck");
});

test("疑似错误规则不能保留旧的变换证据；孩子明确改正后解除待核对", () => {
  const rule = "我把小数点划掉，然后右边再补个零，当整数除。";
  expect(divisionProgress("12.5÷0.5", [transformed.child, rule])?.resolved).not.toContain("transformation");
  expect(divisionProgress("12.5÷0.5", [transformed.child, rule, "我改了，不额外补零。两个数都乘10，变成125除以5。"])?.resolved).toContain("transformation");
});

test("补零不一概视为错误：否定额外补零、一般提问、补足位数都先区分", () => {
  for (const child of ["不能划掉小数点再补零。我把两个数都乘10，变成125除以5。", "我不补零，两个数都乘10，变成125除以5。"])
    expect(divisionProgress("12.5÷0.5", [child])?.resolved).toContain("transformation");
  expect(validateTeachingDecision({ ...raw, focus: "clarify", utterance: "你准备在什么位置补零？先说说哪个数缺位。" },
    { ...base, child: "移动小数点时位数不够，是不是可以补零？" }).focus).toBe("clarify");
});

test("analysis 可选：旧存档无此字段仍能解析，新响应带 analysis 也能解析", () => {
  // 旧存档无 analysis
  const old = validateTeachingDecision(raw, base, soft);
  expect(old.analysis).toBeUndefined();
  // 新响应带 analysis
  const withAnalysis = validateTeachingDecision({ ...raw, analysis: "孩子已给出正确变换，焦点应转向检验。" }, base, soft);
  expect(withAnalysis.analysis).toBe("孩子已给出正确变换，焦点应转向检验。");
  // analysis 不影响其他字段
  expect(withAnalysis.focus).toBe(old.focus);
  expect(withAnalysis.utterance).toBe(old.utterance);
});

test("analysis 不出现在提示词的播报指令中，utterance 仍是唯一播报内容", () => {
  const prompt = buildDecisionPrompt(base);
  expect(prompt).toContain("analysis");
  expect(prompt).toContain("analysis不播报");
  // 提示词要求先写 analysis 再写 utterance
  expect(prompt).toContain("先在analysis中分析");
});

test("move/childMove 可选：旧存档无此字段仍能解析，新响应带 move 也能解析", () => {
  // 旧存档无 move/childMove
  const old = validateTeachingDecision(raw, base, soft);
  expect(old.move).toBeUndefined();
  expect(old.childMove).toBeUndefined();
  // 新响应带 move
  const withMove = validateTeachingDecision({ ...raw, move: "justify" }, base, soft);
  expect(withMove.move).toBe("justify");
  // 新响应带 childMove
  const withChildMove = validateTeachingDecision({ ...raw, childMove: { move: "conjecture", evidenceId: "t" } }, { ...base, child: "我先猜会变少。" }, soft);
  expect(withChildMove.childMove?.move).toBe("conjecture");
  expect(withChildMove.childMove?.evidenceId).toBe("t");
  // move 为 none 也可以
  expect(validateTeachingDecision({ ...raw, move: "none" }, base, soft).move).toBe("none");
});

test("提示词包含八个思维动作选项", () => {
  const prompt = buildDecisionPrompt(base);
  expect(prompt).toContain("understand");
  expect(prompt).toContain("look_back");
  expect(prompt).toContain("move是思维动作");
});

test("2.4: utterance 不得出现动作术语", () => {
  const input = { ...base, child: "我算不出来。" };
  expect(() => validateTeachingDecision({ ...raw, utterance: "我们来specialize一下，试个小例子。" }, input)).toThrow("moveTermInUtterance");
  expect(() => validateTeachingDecision({ ...raw, utterance: "这是特殊化的思路。" }, input)).toThrow("moveTermInUtterance");
  // 正常用语不受影响：不抛 moveTermInUtterance
  expect(() => validateTeachingDecision({ ...raw, utterance: "换个小的试试看？" }, input)).not.toThrow("moveTermInUtterance");
});

test("2.4: childMove 证据必须是本轮 turnId 或 imageId", () => {
  expect(() => validateTeachingDecision({ ...raw, childMove: { move: "conjecture", evidenceId: "wrong" } }, { ...base, child: "我先猜会变少。" })).toThrow("childMoveEvidenceInvalid");
  // 最后一次放行时只丢掉这条记录，回复照常。
  expect(validateTeachingDecision({ ...raw, childMove: { move: "conjecture", evidenceId: "wrong" } }, base, soft).childMove).toBeUndefined();
  expect(validateTeachingDecision({ ...raw, childMove: { move: "conjecture", evidenceId: "t" } }, { ...base, child: "我先猜会变少。" }, soft).childMove?.evidenceId).toBe("t");
});

test("2.5: 孩子纠正老师时进入 acknowledge 状态", () => {
  const history = [{ ...transformed, child: "老师你说得不对，5到10米只有一个间隔。" }];
  const input = { ...base, history, child: "是你刚才说错了，不是两个间隔。" };
  const result = validateTeachingDecision({ ...raw, focus: "acknowledge", utterance: "你说得对，是我说错了。你是怎么发现的？" }, input, soft);
  expect(result.focus).toBe("acknowledge");
  // 孩子纠正的是自己而不是老师时不误触发
  const selfCorrect = { ...base, history: [], child: "我说错了，应该加1。" };
  expect(validateTeachingDecision(raw, selfCorrect, soft).focus).not.toBe("acknowledge");
});

test("3.4: 无图时禁止现在时'你画了'，过去时'你原来写的'不误拦", () => {
  const input = { ...base, child: "我画了三个点。" };
  // 无图 + 现在时 → 拦截
  expect(() => validateTeachingDecision({ ...raw, utterance: "你画了三个点，间隔对吗？" }, input)).toThrow("fabricatedImageClaim");
  // 无图 + 过去时 → 不拦
  expect(() => validateTeachingDecision({ ...raw, utterance: "你原来写的是40，现在改了？" }, input)).not.toThrow("fabricatedImageClaim");
});

test("真实复测：不能把孩子改正的商25说成除数变成25", () => {
  const input = { ...base, history: [transformed, { ...transformed, child: "我想先自己算，不想一直绕单位。" }], child: "我改成二十五了。" };
  expect(() => validateTeachingDecision({ ...raw, focus: "verify", utterance: "除数变成25了，你想用什么办法检验这个结果？" }, input)).toThrow("operandRoleMismatch");
  expect(validateTeachingDecision({ ...raw, focus: "verify", utterance: "你把商改成25了，想怎样检查？" }, input).focus).toBe("verify");
});

test("真实复测：同时扩大时不能说份数被放大、每份大小没变", () => {
  expect(() => validateTeachingDecision({ ...raw, utterance: "两边同时扩大，相当于把原来的份数整体等比例放大，每份的大小没变，所以商不变。" },
    { ...base, child: "现在我想知道为什么两边乘十商不变？" })).toThrow("invarianceQuantityMismatch");
});

test("错商205的零可能多余，不能诱导孩子只把零挪到另一位", () => {
  const input = { ...base, history: [transformed], child: "我算125除以5，是205。" };
  expect(() => validateTeachingDecision({ ...raw, focus: "place_value", utterance: "看看125除以5，商里的零该放在哪一位？" }, input)).toThrow("extraZeroMustBeChecked");
  expect(validateTeachingDecision({ ...raw, focus: "place_value", utterance: "这个零一定需要吗？先检查每一位实际算出的商。" }, input).focus).toBe("place_value");
});

test("不是关键词清单：正确变换后的计算与核验不被未说明理由锁死", () => {
  const input = { ...base, history: [transformed], child: "乘十，12.5变成125，0.5变成5。那现在算式是125除以5吗？我试着除一下看看。" };
  expect(validateTeachingDecision({ ...raw, focus: "place_value", utterance: "可以，你按这个整数式试算，遇到卡点再说。" }, input).focus).toBe("place_value");
  expect(() => validateTeachingDecision({ ...raw, focus: "return", handoff: true, utterance: "接下来自己试试。" }, input)).toThrow();
  expect(divisionProgress("12.5÷0.5", ["我算出125除以5等于25了。"])?.reported).toBe(25);
  expect(validateTeachingDecision({ ...raw, focus: "verify", utterance: "你准备怎么检查这个结果？" },
    { ...input, child: "我算出125除以5等于25了。" }).focus).toBe("verify");
});

test("初次求助可先处理变换；只改变除数不是孩子选择先算的意愿", () => {
  expect(validateTeachingDecision({ ...raw, focus: "transformation", utterance: "先试试把除数0.5乘十，看它变成什么。" },
    { ...base, child: "我不会，这题该从哪儿开始？", permission: "hint" }).focus).toBe("transformation");
  const expressions = ["我觉得只把零点五乘十，十二点五不变，可以算十二点五除以五。",
    "我刚才说十二点五不变呀，要是它也乘十，变成一百二十五除以五，那结果不就变大了吗？老师，我是不是哪里想错了？"];
  expect(divisionTurnIntent(expressions).calculationFirst).toBe(false);
});

test("竖式子步骤不是换新题；计算核验后交还不等于已经理解理由", () => {
  const step = "我看一下，12除以5商2余2，把5落下来是25，25除以5商5。所以结果是25，不是205，我刚才把数位搞混了。";
  const state = divisionProgress("12.5÷0.5", [transformed.child, step]);
  expect(state?.transfer).toBeUndefined();
  expect(state?.reported).toBe(25);
  const choice = { ...transformed, child: "我想先自己算，不想一直绕单位。" };
  const input = { ...base, history: [transformed, choice], child: "我算25乘0.5等于12.5。" };
  const decision = validateTeachingDecision({ ...raw, focus: "return", handoff: true, utterance: "计算结果核对上了，接下来自己试试。" }, input);
  expect(decision.resolved).toContain("verify");
  expect(decision.resolved).not.toContain("invariance");
  expect(() => validateTeachingDecision({ ...raw, focus: "return", handoff: true, utterance: "你已经理解了商不变，接下来自己试试。" }, input)).toThrow("unprovenUnderstanding");
});

test("没有复述完整转换式也可核验正确商，交还不补造变换或理由证据", () => {
  const child = "12除以5商2余2，把5落下来是25，25除以5商5。所以结果是25，不对吧，刚才不是小数吗？";
  expect(validateTeachingDecision({ ...raw, focus: "verify", utterance: "你算出25了，想怎么检查它和原题是否对应？" }, { ...base, child }).focus).toBe("verify");
  const decision = validateTeachingDecision({ ...raw, focus: "return", handoff: true, utterance: "计算核对一致，接下来自己试试。" },
    { ...base, child: "25乘0.5等于12.5。" });
  expect(decision.resolved).toEqual(["verify"]);
});

test("有实际画布图片时可先核对计算，但不能把看图动作计成孩子理解证据", () => {
  const input = { ...base, imageId: "ink", image: Buffer.from("synthetic-image") };
  const decision = validateTeachingDecision({ ...raw, focus: "place_value", evidenceIds: ["ink"], utterance: "画布这一步算出的商是怎样来的？" }, input);
  expect(decision.resolved).toEqual([]);
  expect(() => validateTeachingDecision({ ...raw, focus: "place_value", utterance: "商的2和5分别在哪一位？" }, base, soft)).toThrow();
});
