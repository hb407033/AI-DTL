import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { expect, test } from "vitest";
import { z } from "zod";
import { keepOneQuestion, validateTeachingDecision, type TeachingInput } from "../src/ai/workspace-teaching-decision.js";
import { buildTeachingGates } from "../../../tools/build-teaching-gates-bundle.mjs";

type Sample = { name: string; draft: unknown; context: Record<string, unknown>; expect: { ok: boolean; reason?: string; rewrite?: string } };

function asInput(context: Record<string, unknown>): TeachingInput {
  // 照片字节不进门禁。imageAttached 只保留“有没有附图”，断言手写数的规则看的是这个事实。
  const { imageAttached, ocrNumbers: _ocr, ...rest } = context;
  return { ...(rest as unknown as TeachingInput), image: imageAttached ? Buffer.from([1]) : undefined };
}
function direct(sample: Sample) {
  try {
    return { ok: true, draft: validateTeachingDecision(sample.draft, asInput(sample.context)) };
  } catch (error) {
    const reason = error instanceof z.ZodError ? "invalidStructure" : error instanceof Error ? error.message : "invalidStructure";
    const utterance = sample.draft && typeof sample.draft === "object" && typeof (sample.draft as { utterance?: unknown }).utterance === "string"
      ? (sample.draft as { utterance: string }).utterance : "";
    return { ok: false, reason, ...(reason === "questionLimit_onlyOneQuestion" ? { rewrite: keepOneQuestion(utterance) } : {}) };
  }
}

test("JS 包在没有 Buffer/require/fetch 的 vm 里对 30 条样例的判断与直接调用一致", async () => {
  const samples = JSON.parse(await readFile(new URL("./fixtures/teaching-gates-samples.json", import.meta.url), "utf8")) as Sample[];
  expect(samples).toHaveLength(30);
  const directory = await mkdtemp(path.join(tmpdir(), "teaching-gates-"));
  try {
    const outfile = path.join(directory, "teaching-gates.js");
    await buildTeachingGates(outfile);
    const code = await readFile(outfile, "utf8");
    const context = vm.createContext({});
    new vm.Script(code).runInNewContext(context);
    const gates = (context as { TeachingGates?: { checkDraft: (draft: string, ctx: string) => string } }).TeachingGates;
    expect(gates).toBeTypeOf("object");
    for (const sample of samples) {
      const bundled = JSON.parse(gates!.checkDraft(JSON.stringify(sample.draft), JSON.stringify(sample.context)));
      const expected = direct(sample);
      expect(bundled, sample.name).toEqual(expected);
      expect(bundled.ok, sample.name).toBe(sample.expect.ok);
      if (sample.expect.reason) expect(bundled.reason, sample.name).toBe(sample.expect.reason);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("JS 包不含网络代码与密钥字样", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "teaching-gates-"));
  try {
    const outfile = path.join(directory, "teaching-gates.js");
    await buildTeachingGates(outfile);
    const code = await readFile(outfile, "utf8");
    expect(code).not.toContain('"ws"');
    expect(code).not.toContain("WebSocket(");
    expect(code).not.toContain("apiKey");
    expect(code).not.toContain("wss://");
    const manifest = JSON.parse(await readFile(`${outfile}.manifest.json`, "utf8"));
    expect(manifest.bundleSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.sourceHashes["apps/agent-host/src/ai/workspace-teaching-decision.ts"]).toMatch(/^[a-f0-9]{64}$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("decideSlow 走注入的 requestText，不自己联网", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "teaching-gates-"));
  try {
    const outfile = path.join(directory, "teaching-gates.js");
    await buildTeachingGates(outfile);
    const context = vm.createContext({});
    new vm.Script(await readFile(outfile, "utf8")).runInNewContext(context);
    const gates = (context as { TeachingGates: { decideSlow: (ctx: string, reason: string, hooks: unknown) => Promise<string> } }).TeachingGates;
    const samples = JSON.parse(await readFile(new URL("./fixtures/teaching-gates-samples.json", import.meta.url), "utf8")) as Sample[];
    const sample = samples.find(item => item.name === "正常通过-小例子");
    expect(sample).toBeTruthy();
    const calls: string[] = [];
    const spoken: string[] = [];
    const result = JSON.parse(await gates.decideSlow(JSON.stringify(sample!.context), "roteStep", {
      requestText: async (instructions: string) => {
        calls.push(instructions);
        if (instructions.includes("抢答复核器")) return '{"allowed":true,"reason":"none"}';
        return JSON.stringify(sample!.draft);
      },
      speak: async (text: string) => { spoken.push(text); return { ok: true, spoken: text }; },
    }));
    expect(result.ok).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(spoken).toEqual([result.utterance]);
    expect(calls.join("\n")).not.toContain("wss://");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
