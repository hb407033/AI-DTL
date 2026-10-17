import { expect, test } from "vitest";
import { SseAccumulator } from "../src/ai/qwen-thinking-text.js";

test("SseAccumulator 逐字符推送也能正确拼接文本和用量，不泄露思维链", () => {
  const s = new SseAccumulator();
  const raw = 'data: {"choices":[{"delta":{"reasoning_content":"private","content":"你"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":9}}\n\ndata: [DONE]\n\n';
  for (const c of raw) s.push(c);
  expect(s.text).toBe("你好");
  expect(s.usage?.prompt_tokens).toBe(8);
  expect(s.usage?.completion_tokens).toBe(9);
  expect(s.reasoningObserved).toBe(true);
  expect(s.finishReason).toBeNull();
  expect(s.done).toBe(true);
  expect(JSON.stringify(s)).not.toContain("private");
});

test("SseAccumulator 记录 finish_reason 并在未完成时抛异常", () => {
  const s = new SseAccumulator();
  s.push('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
  s.push('data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n');
  s.push("data: [DONE]\n\n");
  expect(s.text).toBe("ok");
  expect(s.finishReason).toBe("stop");
  expect(s.done).toBe(true);

  const incomplete = new SseAccumulator();
  incomplete.push('data: {"choices":[]');
  expect(() => incomplete.finish()).toThrow("incompleteSse");
});

test("SseAccumulator 超长响应抛 responseTooLong", () => {
  const s = new SseAccumulator();
  const long = "x".repeat(16001);
  expect(() => s.push(`data: {"choices":[{"delta":{"content":"${long}"}}]}\n\n`)).toThrow("responseTooLong");
});
