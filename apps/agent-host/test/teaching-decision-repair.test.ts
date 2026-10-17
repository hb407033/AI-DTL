import { expect, test, vi } from "vitest";
import { requestWorkspaceText } from "../src/ai/qwen-workspace-session.js";
import { QwenTeachingDecisionProvider, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import type { QwenConfig } from "../src/ai/config.js";

vi.mock("../src/ai/qwen-workspace-session.js", () => ({ requestWorkspaceText: vi.fn() }));
const input = { record: { problem: { problemId: "p", statement: { text: "12.5÷0.5", revision: 0 },
  curriculum: { edition: "人教版", term: "上" } }, submissions: [], feedback: [] },
  turnId: "t", responseId: "r", permission: "review", child: "我觉得你说得不对，我还没想明白。", history: [] } as unknown as TeachingInput;
const draft = { focus: "clarify", observation: "孩子质疑老师", evidenceIds: ["t"], method: "scale_both", handoff: false,
  utterance: "你觉得哪里不对？是哪一步没想明白？" };

test("修复必须看到被拒绝的原稿并收到具体单问要求，不只看到错误码", async () => {
  const request = vi.mocked(requestWorkspaceText); request.mockReset();
  request.mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce(JSON.stringify({ ...draft, utterance: "你觉得哪一步不对？" }))
    .mockResolvedValueOnce('{"allowed":true,"reason":"none"}');
  const accepted = await new QwenTeachingDecisionProvider({} as QwenConfig).decide(input);
  expect(accepted.utterance).toBe("你觉得哪一步不对？");
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[1]![1]).toContain(draft.utterance);
  expect(request.mock.calls[1]![1]).toContain("删除其他问句");
  expect(request.mock.calls[1]![1].length).toBeLessThan(request.mock.calls[0]![1].length/2);
});
test("修复仍不合规时保持一次修复上限，不把坏稿交给播报", async () => {
  // 只剩多问时宿主会删问句后复核；这里的坏稿删问句后仍抢答，必须整轮拒绝，不能播报。
  const bad = { ...draft, utterance: "答案是25，你觉得对吗？是哪一步没想明白？" };
  const request = vi.mocked(requestWorkspaceText); request.mockReset(); request.mockResolvedValue(JSON.stringify(bad));
  await expect(new QwenTeachingDecisionProvider({} as QwenConfig).decide(input)).rejects.toThrow("decisionNeedsReview");
  expect(request).toHaveBeenCalledTimes(2);
});
test("抢答被拒绝时重写明确要求删掉未由孩子给出的商", async () => {
  const request = vi.mocked(requestWorkspaceText); request.mockReset();
  request.mockResolvedValueOnce(JSON.stringify({ ...draft, utterance: "答案是25，你想怎么检查？" }))
    .mockResolvedValueOnce(JSON.stringify({ ...draft, utterance: "你觉得哪一步不对？" }))
    .mockResolvedValueOnce('{"allowed":true,"reason":"none"}');
  await new QwenTeachingDecisionProvider({} as QwenConfig).decide(input);
  expect(request.mock.calls[1]![1]).toContain("删除正确商");
});
test("明确不懂为什么后的回声反问使用短定点修复，不重复整套教学提示", async () => {
  const request = vi.mocked(requestWorkspaceText); request.mockReset();
  const childInput: TeachingInput = { ...input, permission: "clarification", child: "我不懂为什么两个数一起扩大商不变。" };
  request.mockResolvedValueOnce(JSON.stringify({ ...draft, utterance: "你觉得为什么两个数要一起扩大？" }))
    .mockResolvedValueOnce(JSON.stringify({ ...draft, utterance: "总量和每份一起变成原来的同样倍数，能分成的份数不变。" }))
    .mockResolvedValueOnce('{"allowed":true,"reason":"none"}');
  const accepted = await new QwenTeachingDecisionProvider({} as QwenConfig).decide(childInput);
  expect(accepted.utterance).toContain("份数不变");
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[1]![1]).toContain("不得再出现为什么");
  expect(request.mock.calls[1]![1].length).toBeLessThan(request.mock.calls[0]![1].length / 2);
});
test("超长utterance走受限编辑器压缩，不新增数字和结论", async () => {
  const request = vi.mocked(requestWorkspaceText); request.mockReset();
  const longUtterance = "把它慢慢压扁，你会发现斜边一直是五不变，但是里面的格子数量明显变少了，这是因为平行四边形的高变小了，虽然底边没有变但是面积确实跟着改变了，所以我们不能再用底边乘斜边来计算平行四边形的面积了，要用底边乘以高才行。";
  expect(longUtterance.length).toBeGreaterThan(90);
  const compressed = "把它慢慢压扁，斜边还是五，里面的格子变少了吗？";
  const areaInput = { ...input, child: "我不懂为什么斜边不能当高。", permission: "clarification" as const,
    record: { ...input.record, problem: { ...input.record.problem!, statement: { text: "平行四边形底8米高3米斜边5米，面积是多少？", revision: 0, confirmed: true } } } };
  const areaDraft = { ...draft, method: "ordinary" };
  request.mockResolvedValueOnce(JSON.stringify({ ...areaDraft, utterance: longUtterance }))
    .mockResolvedValueOnce(JSON.stringify({ ...areaDraft, utterance: compressed }))
    .mockResolvedValueOnce('{"allowed":true,"reason":"none"}');
  const accepted = await new QwenTeachingDecisionProvider({} as QwenConfig).decide(areaInput);
  expect(accepted.utterance).toBe(compressed);
  expect(accepted.utterance).toContain("压扁");
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[1]![1]).toContain("压缩");
  expect(request.mock.calls[1]![1]).toContain("90字");
  expect(request.mock.calls[1]![1].length).toBeLessThan(request.mock.calls[0]![1].length / 2);
});
