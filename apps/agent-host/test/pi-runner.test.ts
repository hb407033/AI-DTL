import { expect, test } from "vitest";
import { parsePiOutput, piArguments, createPiRunner } from "../src/ai/pi-runner.js";
import { fileURLToPath } from "node:url";

test("Pi 只读最终成功消息，不输出思考链或半成品", () => {
  const raw = [{ type: "message_update", assistantMessageEvent: { delta: "wrong" } },
    { type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "{}" }] } }].map(x => JSON.stringify(x)).join("\n");
  expect(parsePiOutput(raw)).toBe("{}");
  expect(() => parsePiOutput(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "secret" } }))).toThrow("piNoSuccessfulMessage");
});
test("限制 Pi 工具与自动发现，不把学习内容放命令行参数", () => {
  const args = piArguments({ command: "pi", provider: "test", model: "exact-model" });
  for (const flag of ["--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files", "--no-approve"]) expect(args).toContain(flag);
  expect(args).toContain("exact-model");
});

const config = { command: fileURLToPath(new URL("../fixtures/fake-pi-cli.cjs", import.meta.url)), provider: "test", model: "test" };
test("真实子进程 stdin/JSONL 往返，不丢中文或 Unicode 分隔符", async () => {
  expect(await createPiRunner(config)("中文\u2028材料", new AbortController().signal)).toBe("中文\u2028材料");
});
test("进程错误不暴露 stderr；输出超限终止", async () => {
  await expect(createPiRunner(config)("error", new AbortController().signal)).rejects.toThrow("piProcessFailed");
  await expect(createPiRunner(config)("oversize", new AbortController().signal)).rejects.toThrow("piOutputTooLarge");
});
test("超时或取消均终止正在等待的真实子进程", async () => {
  await expect(createPiRunner(config, 80)("wait", new AbortController().signal)).rejects.toThrow("piTimeout");
  const controller = new AbortController();
  const task = createPiRunner(config)("wait", controller.signal);
  controller.abort();
  await expect(task).rejects.toThrow("piStopped");
});
