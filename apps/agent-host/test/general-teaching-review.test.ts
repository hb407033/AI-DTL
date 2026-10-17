import {expect,test,vi} from "vitest";
import {requestWorkspaceText} from "../src/ai/qwen-workspace-session.js";
import {QwenTeachingDecisionProvider,type TeachingInput} from "../src/ai/workspace-teaching-decision.js";
import type {QwenConfig} from "../src/ai/config.js";
vi.mock("../src/ai/qwen-workspace-session.js",()=>({requestWorkspaceText:vi.fn()}));
const input={record:{sessionId:"s",problem:{problemId:"p",statement:{text:"每千克苹果3.6元，买0.4千克要多少元？",revision:0},
  curriculum:{edition:"人教版",grade:5,term:"上",currentUnit:"小数乘法"}},submissions:[],feedback:[]},
  turnId:"t",responseId:"r",permission:"review",child:"一份零点三六元，我只取四份，这样对应得对吗？",history:[]} as unknown as TeachingInput;
const bad={focus:"verify",observation:"孩子把价格按十份对应",evidenceIds:["t"],method:"ordinary",handoff:false,
  utterance:"你的分法很对，一份0.36元，四份就是1.44元。接下来自己算算看。"};
const good={...bad,utterance:"每份价格对应得上，那四份你准备怎么算？"};
test("真实抢答样本经独立语义复核拒绝后只改写一次，不用另一个固定题型校验器",async()=>{
  const request=vi.mocked(requestWorkspaceText);request.mockReset();
  request.mockResolvedValueOnce(JSON.stringify(bad)).mockResolvedValueOnce(JSON.stringify({allowed:false,reason:"answer_leak"}))
    .mockResolvedValueOnce(JSON.stringify(good)).mockResolvedValueOnce(JSON.stringify({allowed:true,reason:"none"}));
  const accepted=await new QwenTeachingDecisionProvider({} as QwenConfig).decide(input);
  expect(accepted.utterance).toBe(good.utterance);expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls[1]![1]).toContain(bad.utterance);expect(request.mock.calls[1]![1]).toContain(input.child);
  expect(request.mock.calls[1]![1]).not.toContain("ignored_latest");
  expect(request.mock.calls[2]![1]).toContain("semantic_answer_leak");
});
test("语义复核持续拒绝或返回无效结构，不无限调用、不放过原稿",async()=>{
  for(const review of [{allowed:false,reason:"ignored_latest"},{allowed:"yes",reason:"none"}]){
    const request=vi.mocked(requestWorkspaceText);request.mockReset();
    request.mockResolvedValueOnce(JSON.stringify(good)).mockResolvedValueOnce(JSON.stringify(review))
      .mockResolvedValueOnce(JSON.stringify(good)).mockResolvedValueOnce(JSON.stringify(review));
    await expect(new QwenTeachingDecisionProvider({} as QwenConfig).decide(input)).rejects.toThrow("decisionNeedsReview");
    expect(request).toHaveBeenCalledTimes(4);
  }
});

test("抢答复核也能看到当前照片笔迹，不把孩子已经写出的结果当作老师抢答",async()=>{
  const request=vi.mocked(requestWorkspaceText);request.mockReset();
  request.mockResolvedValueOnce(JSON.stringify(good)).mockResolvedValueOnce(JSON.stringify({allowed:true,reason:"none"}));
  const image=Buffer.from("current-child-work");
  await new QwenTeachingDecisionProvider({} as QwenConfig).decide({...input,image});
  expect(request.mock.calls[1]![2]).toBe(image);
  expect(request.mock.calls[1]![1]).toContain("孩子笔迹");
});
