import { expect, test } from "vitest";
import type { WorkspaceRecord } from "@ai-scholar/session-contracts";
import { buildDecisionPrompt, validateTeachingDecision, mathSpeech, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import { disciplinaryThinkingGuidance } from "../src/ai/workspace-teaching-context.js";

const cases = [
  ["小数乘法", "每千克苹果3.6元，买0.4千克要多少元？"],
  ["小数除法", "一根长5.4米的彩带，每段0.6米，可以剪成几段？"],
  ["简易方程", "一本故事书x元，买3本，付50元，找回8元。每本故事书多少元？"],
  ["多边形的面积", "一块平行四边形花坛，底8米，高3米，斜边5米。面积是多少平方米？"],
  ["植树问题", "60米的小路一侧，每隔5米栽树，两端都栽，要多少棵？"],
];
test("重开承接区分原照片的旧错答与最近口述修正，不把恢复当成重新答题", () => {
  const record = {problem:{problemId:"p",statement:{text:cases[3]![1],revision:0},
    curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:"多边形的面积"}},submissions:[],feedback:[]} as unknown as WorkspaceRecord;
  const input: TeachingInput = {record,turnId:"resume",responseId:"r",permission:"review",child:"",history:[{
    problemId:"p",problemRevision:0,responseId:"previous",observation:"孩子修正面积计算",evidenceIds:["latest"],method:"ordinary",handoff:true,
    turnId:"latest",child:"原来用斜边算错了，现在按底乘高算得24。",utterance:"接下来自己试。",focus:"return",resolved:[],
  }]};
  expect(buildDecisionPrompt(input)).toContain("照片中的旧错答不能覆盖较新的明确修正");
  expect(buildDecisionPrompt({...input,child:"我又有一个想法"})).not.toContain("这次是恢复会话");
});
test.each(cases)("%s 的真实决策链路必须包含共用 DTL 教学契约，而不只在语音旧路径生效", (unit, text) => {
  const record: WorkspaceRecord = {schemaVersion:2, sessionId:"general",eventId:"e",revision:0,phase:"exploring",
    problem:{source:"curated",problemId:"p",challengeId:"c",packVersion:"1",
      curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:unit!},statement:{text:text!,revision:0,confirmed:true}},
    childInkBase64:"",board:{revision:0,rectangles:[]},submissions:[],feedback:[],openQuestions:[]};
  const input: TeachingInput = {record,turnId:"t",responseId:"r",permission:"review",child:"我想知道为什么，不想只背规则。",history:[]};
  const prompt=buildDecisionPrompt(input);
  // 八动作可从分号改为换行；完整契约的字词、内容和顺序仍逐字保护。
  const normalizeSeparators = (value: string) => value.replace(/[；\n]/gu, "");
  expect(normalizeSeparators(prompt)).toContain(normalizeSeparators(disciplinaryThinkingGuidance));
});
test.each(cases)("%s 不得收到另一道12.5除0.5题的解法或固定除法检验要求", (unit,text) => {
  const record: WorkspaceRecord = {schemaVersion:2,sessionId:"general",eventId:"e",revision:0,phase:"exploring",
    problem:{source:"curated",problemId:"p",challengeId:"c",packVersion:"1",
      curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:unit!},statement:{text:text!,revision:0,confirmed:true}},
    childInkBase64:"",board:{revision:0,rectangles:[]},submissions:[],feedback:[],openQuestions:[]};
  const prompt=buildDecisionPrompt({record,turnId:"t",responseId:"r",permission:"review",child:"我不会",history:[]});
  expect(prompt).not.toContain("125÷5=205");
  expect(prompt).not.toContain("用25乘0.5");
  expect(prompt).not.toContain("商×除数是否回到被除数");
  expect(prompt).not.toContain("125÷5");
});

test("口头交还独立尝试必须与结构化 handoff 一致，不把它记为继续检验", () => {
  const record: WorkspaceRecord = {schemaVersion:2,sessionId:"general",eventId:"e",revision:0,phase:"exploring",
    problem:{source:"curated",problemId:"p",challengeId:"c",packVersion:"1",
      curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:"简易方程"},statement:{text:cases[2]![1]!,revision:0,confirmed:true}},
    childInkBase64:"",board:{revision:0,rectangles:[]},submissions:[],feedback:[],openQuestions:[]};
  const input: TeachingInput = {record,turnId:"t",responseId:"r",permission:"review",child:"三本十四元，加八元等于五十元。",history:[]};
  const plan = {focus:"verify",observation:"孩子代回等量关系核对",evidenceIds:["t"],
    utterance:"你代回核对了钱数。接下来自己试试别的问题吧。",method:"ordinary",handoff:false};
  expect(() => validateTeachingDecision(plan,input)).toThrow("returnSpeechRequiresReturn");
  expect(() => validateTeachingDecision({...plan,utterance:"新条件算得对，验算也完整。接下来自己再试一个变化吧。"},input))
    .toThrow("returnSpeechRequiresReturn");
  expect(validateTeachingDecision({...plan,focus:"return",handoff:true},input).handoff).toBe(true);
  expect(validateTeachingDecision({...plan,focus:"return",handoff:true,resolved:["invariance","verify"]},input).resolved)
    .toEqual([]);
  expect(() => validateTeachingDecision({...plan,focus:"return",handoff:true,observation:"孩子已掌握这类方程并学会了检验。"},input))
    .toThrow("abilityLabel_notAllowed");
});

test("一般题型的检查权限也拦截未经孩子提出的数值结论，不只保护小数除法", () => {
  const record: WorkspaceRecord = {schemaVersion:2,sessionId:"general",eventId:"e",revision:0,phase:"exploring",
    problem:{source:"curated",problemId:"p",challengeId:"c",packVersion:"1",
      curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:"植树问题"},statement:{text:cases[4]![1]!,revision:0,confirmed:true}},
    childInkBase64:"",board:{revision:0,rectangles:[]},submissions:[],feedback:[],openQuestions:[]};
  const input: TeachingInput = {record,turnId:"t",responseId:"r",permission:"review",child:"六十除以五是十二，所以是十二棵吗？",history:[]};
  const plan = {focus:"clarify",observation:"孩子混淆间隔与树",evidenceIds:["t"],
    utterance:"12是间隔数。两端都栽时，树比间隔多1棵，所以一共13棵。",method:"ordinary",handoff:false};
  expect(() => validateTeachingDecision(plan,input)).toThrow("unrequestedConclusion");
  expect(() => validateTeachingDecision({...plan,utterance:"所以一共十三棵。"},input)).toThrow("unrequestedConclusion");
  expect(validateTeachingDecision(plan,{...input,child:"十二个间隔，应该十三棵。"}).utterance).toBe(plan.utterance);
  expect(validateTeachingDecision({...plan,utterance:"十二是间隔数，试着用十米的小路看看端点。"},input).handoff).toBe(false);
});

test("另一道小数除法的竖式提示使用当前转换式，不夹带12.5题的步骤", () => {
  const record: WorkspaceRecord = {schemaVersion:2,sessionId:"general",eventId:"e",revision:0,phase:"exploring",
    problem:{source:"curated",problemId:"p",challengeId:"c",packVersion:"1",
      curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:"小数除法"},statement:{text:"5.4÷0.6",revision:0,confirmed:true}},
    childInkBase64:"",board:{revision:0,rectangles:[]},submissions:[],feedback:[],openQuestions:[]};
  const prompt=buildDecisionPrompt({record,turnId:"t",responseId:"r",permission:"hint",history:[],
    child:"我把5.4和0.6同时乘10，得到54除以6，我想先算竖式步骤。"});
  expect(prompt).toContain("54÷6");expect(prompt).not.toContain("125÷5");expect(prompt).not.toContain("用25乘0.5");
});

test("方程播报规范化字母和加减号，不能因3x+8的读法差异中断会话",()=>{
  expect(mathSpeech("3x+8=50，x=14。" )).toBe("三乘艾克斯加八等于五十，艾克斯等于十四。");
  expect(mathSpeech("三乘埃克斯加八等于五十，艾克斯等于十四。")).toBe(mathSpeech("3x+8=50，x=14。"));
  expect(mathSpeech("50-8=42，AI-DTL" )).toBe("五十减八等于四十二，AI-DTL");
});

test("空白题首次开场先让孩子表达想法，不能直接安排计算算法",()=>{
  const record: WorkspaceRecord={schemaVersion:2,sessionId:"general",eventId:"e",revision:0,phase:"exploring",
    problem:{source:"curated",problemId:"p",challengeId:"c",packVersion:"1",
      curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:"小数除法"},statement:{text:cases[1]![1]!,revision:0,confirmed:true}},
    childInkBase64:"",board:{revision:0,rectangles:[]},submissions:[],feedback:[],openQuestions:[]};
  const input:TeachingInput={record,turnId:"t",responseId:"r",permission:"review",child:"",history:[]};
  const plan={focus:"transformation",observation:"尚无孩子当前想法",evidenceIds:["problem"],method:"ordinary",handoff:false,
    utterance:"把5.4和0.6同时扩大10倍，变成整数除法来算算看。"};
  expect(()=>validateTeachingDecision(plan,input)).toThrow("openingNeedsChildIdea");
  expect(validateTeachingDecision({...plan,utterance:"这道题你准备怎么想？"},input).handoff).toBe(false);
});

test("退出重开后的简短承接不是重复问句；重复的真正问句仍须拦截",()=>{
  const record:WorkspaceRecord={schemaVersion:2,sessionId:"general",eventId:"e",revision:0,phase:"exploring",
    problem:{source:"curated",problemId:"p",challengeId:"c",packVersion:"1",
      curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:"简易方程"},statement:{text:cases[2]![1]!,revision:0,confirmed:true}},
    childInkBase64:"",board:{revision:0,rectangles:[]},submissions:[],feedback:[],openQuestions:[]};
  const input:TeachingInput={record,turnId:"t",responseId:"r",permission:"review",child:"",history:[]};
  const raw={focus:"return",observation:"孩子已解出并检验",evidenceIds:["problem"],method:"ordinary",handoff:true,
    utterance:"解得对，检验也清楚。接下来自己试试别的题吧。"};
  const previous=validateTeachingDecision({...raw,evidenceIds:["t"],utterance:"你已经检验，接下来自己试试。"},
    {...input,child:"我算出十四元，代回得到五十。"});
  const history=[{...previous,utterance:raw.utterance}];
  expect(validateTeachingDecision(raw,{...input,history}).handoff).toBe(true);
  const question={...raw,focus:"verify",handoff:false,utterance:"你准备用什么办法检验？"};
  expect(()=>validateTeachingDecision(question,{...input,history:[{...previous,...question} as typeof previous]})).toThrow("repeatedQuestion");
});

test("孩子明确不懂为什么时，不能把为什么反问给他冒充帮助",()=>{
  const record:WorkspaceRecord={schemaVersion:2,sessionId:"general",eventId:"e",revision:0,phase:"exploring",
    problem:{source:"curated",problemId:"p",challengeId:"c",packVersion:"1",
      curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:"多边形的面积"},statement:{text:cases[3]![1]!,revision:0,confirmed:true}},
    childInkBase64:"",board:{revision:0,rectangles:[]},submissions:[],feedback:[],openQuestions:[]};
  const input:TeachingInput={record,turnId:"t",responseId:"r",permission:"hint",history:[],
    child:"我知道公式写底乘高，可我不懂为什么斜边不行，不想只把五换成三就算了。"};
  const raw={focus:"invariance",observation:"孩子问斜边为何不能当高",evidenceIds:["t"],method:"ordinary",handoff:false,
    utterance:"把五换成三算出了面积，那你能说说为什么斜边不行吗？"};
  expect(()=>validateTeachingDecision(raw,input)).toThrow("whyEchoNeedsHelp");
  expect(validateTeachingDecision({...raw,focus:"transformation",utterance:"试着沿高剪开拼成长方形，看看哪条线变成了它的宽？"},input).handoff).toBe(false);
});
