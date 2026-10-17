// 只使用合成学习材料；不读取/输出密钥，不修改家庭作品。
import assert from "node:assert/strict";
import { loadQwenConfig } from "../apps/agent-host/src/ai/config.ts";
import { QwenLineScaffoldProvider } from "../apps/agent-host/src/ai/qwen-line-scaffold.ts";
import { offerLineScaffold, consentToLineScaffold, generateLineScaffold } from "../apps/agent-host/src/learning/line-scaffold.ts";
import { partitionQuantity } from "../packages/session-contracts/src/line-scaffold.ts";

const provider = new QwenLineScaffoldProvider(loadQwenConfig());
const context = { problem: "一升果汁6.8元，买半升要多少元？",
  expression: "我画的这条线表示一升果汁，半升应该是其中的一半。我想看看辅助线段。",
  curriculum: { edition: "人教版", grade: 5, term: "上", currentUnit: "小数乘法" } };
const signal = AbortSignal.timeout(60000);
const understanding = await provider.understand(context, signal);
assert(understanding, "明确表示关系不能无故丢弃");
assert.equal(understanding.whole, "1"); assert.equal(understanding.unit, "升");
assert(context.expression.includes(understanding.sourceQuote));
const basis = { problemId: "synthetic-p", problemRevision: 0, submissionId: "synthetic-e", responseId: "synthetic-r" };
const offer = offerLineScaffold("synthetic-offer", basis, understanding);
// 明确为测试脚本模拟同意，不冒充真人操作。
const consent = consentToLineScaffold(offer, offer.offerId, basis);
const raw = await provider.generate(context, consent, signal);
const state = generateLineScaffold(consent, basis, raw, [context.expression]);
assert.equal(state.line.partitions, 2);
assert.deepEqual(partitionQuantity(state.line.whole, state.line.partitions), { numerator: 1, denominator: 2 });
console.log(JSON.stringify({ syntheticInput: true, realProvider: true, simulatedConsent: true,
  understanding, line: state.line, status: state.status, checks: ["quantity", "unit", "quote", "unchangedAnchor", "exactHalf"] }, null, 2));
