import { expect, test } from "vitest";
import { costEstimate, SseAccumulator, reserveCall, reconstruct, shortPrompt } from "../scripts/teaching-ablation-core.js";

test("未知或坏用量不是零，思考已含在completion中不重复收费，缓存按返回计数", () => {
  expect(costEstimate(null, "thinking")).toBeNull();
  expect(costEstimate({ prompt_tokens: -1, completion_tokens: 2 }, "thinking")).toBeNull();
  expect(costEstimate({ prompt_tokens: 1000, completion_tokens: 2000,
    prompt_tokens_details: { cached_tokens: 400 }, completion_tokens_details: { reasoning_tokens: 1500 } }, "thinking"))
    .toBeCloseTo((600 * 0.8 + 400 * 0.1 + 2000 * 2.7) / 1e6);
  expect(costEstimate({ input_tokens: 1000, output_tokens: 100,
    input_token_details: { audio_tokens: 5 } }, "realtime")).toBeCloseTo((995 * 1.5 + 5 * 6 + 100 * 4.5) / 1e6);
});
test("SSE任意块边界、CRLF、usage空choices可解析，不保存思维链", () => {
  const s = new SseAccumulator();
  const raw = 'data: {"choices":[{"delta":{"reasoning_content":"private","content":"你"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":9}}\n\ndata: [DONE]\n\n';
  for (const c of raw) s.push(c);
  expect(s.text).toBe("你好"); expect(s.usage?.prompt_tokens).toBe(8);
  expect(JSON.stringify(s)).not.toContain("private"); expect(s.done).toBe(true);
  const truncated = new SseAccumulator(); truncated.push('data: {"choices":[]');
  expect(() => truncated.finish()).toThrow("incompleteSse");
});
test("调用前计数，失败也消耗额度，跨执行不能超过预算或截止时间", () => {
  const ledger = { calls: 29, deadline: 1000 };
  reserveCall(ledger, 900); expect(ledger.calls).toBe(30);
  expect(() => reserveCall(ledger, 901)).toThrow("callBudget");
  expect(() => reserveCall({ calls: 1, deadline: 1000 }, 1000)).toThrow("deadline");
  // 可配置预算
  const ledger2 = { calls: 62, deadline: 1000 };
  reserveCall(ledger2, 900, 63); expect(ledger2.calls).toBe(63);
  expect(() => reserveCall(ledger2, 901, 63)).toThrow("callBudget");
});
test("只重建当时已有提交/反馈，绝不把目标老师或未来纠正发给模型", () => {
  const bundle = { record: { submissions: [{ explanation: "first" }, { explanation: "future" }],
    feedback: [{ responseId: "r0" }, { responseId: "r1" }, { responseId: "r2" }] },
    teachingDecisions: [{ child: "", responseId: "r0" }, { child: "first", responseId: "r1", turnId: "t1" },
      { child: "future", responseId: "r2" }] };
  const result = reconstruct(bundle as any, 1);
  expect(result.record.submissions).toHaveLength(1); expect(result.history).toHaveLength(1);
  expect(result.record.feedback).toEqual([{ responseId: "r0" }]);
  expect(JSON.stringify(result)).not.toContain("future");
});
test("精简只压缩规则，题目历史等事实JSON原样保留，课程权限保留", () => {
  const facts = JSON.stringify({ problem: "题目", child: "新思路", history: [{ child: "旧思路" }], previousWork: [], prior: [] });
  const full = '长规则\n课程：人教版，五年级上，当前单元面积。本轮权限hint。\n按当前题目和课程选择方法，不套用其他题型的固定提问。method用ordinary。\n' + facts;
  const compact = shortPrompt(full);
  expect(compact.split("\n").at(-1)).toBe(facts); expect(compact).toContain("权限hint");
  expect(compact).toContain("当前单元面积");
});
