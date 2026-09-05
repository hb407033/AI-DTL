# AI 学科心智学习系统阶段 0 门禁实施计划

> **已废止：** 用户已于 2026-09-01 确认平板端采用完整原生 Swift App 与 PencilKit。本计划中的 PWA/Vite 平板路线不得执行；替代计划见 `docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在编写正式学习系统前，用可重复证据验证教学闭环、目标平板交互能力和 Codex 订阅实时路径，并自动生成进入下一阶段或停止的门禁报告。

**Architecture:** 三项门禁彼此隔离：Wizard-of-Oz 只验证教学方法，平板探针只验证浏览器、触控、音频、局域网和 HTTPS，Codex 探针只验证本机登录身份、实验协议、实时音频和用量归属。三者使用同一套本地结果契约，最终由纯本地报告器汇总；任一门禁失败都不得自动切换模型或继续实现上层课程、画布和成长记忆。

**Tech Stack:** Node.js 22、pnpm 11、TypeScript、Vite Vanilla、Fastify、WebSocket、Zod、Vitest、Codex CLI app-server、mkcert、家庭局域网中的 iPad/Safari 与 Apple Pencil。

---

## 0. 范围、产物与停止条件

本计划只实现阶段 0，不实现正式儿童学习产品。计划结束时必须产生：

- 一份包含 3 次真实短会话的 Wizard-of-Oz 聚合记录；
- 一份由目标平板生成的设备测量 JSON；
- 一份由当前 ChatGPT 登录身份生成的 Codex 实时探针 JSON；
- 一份自动汇总的 Markdown 门禁报告；
- 明确结论：`PASS`、`FAIL` 或 `BLOCKED`。

以下内容不在本计划内：课程插件、正式语义画布、SQLite 成长档案、完整教学状态机、家长后台、文学插件。三项门禁全部 `PASS` 后，再为“单挑战机器原型”单独编写实施计划。

门禁阈值固定为：

| 指标 | 通过阈值 |
|---|---:|
| 触控事件到本机画布出现 | P95 ≤ 50 ms |
| 开始说话到本机停止 Agent 播放 | P95 ≤ 200 ms |
| 平板事件到 Mac mini 确认 | P95 ≤ 150 ms |
| 一句话结束到第一段 Agent 音频 | P50 ≤ 1500 ms，P95 ≤ 3000 ms |
| 远端语义画布动作出现 | P95 ≤ 300 ms |
| 网络恢复到重新连接 | ≤ 5000 ms |
| Codex 实时会话成功率 | 至少 19/20 |

## 1. 计划后的文件结构

```text
.
├── apps/
│   ├── gate-server/
│   │   ├── package.json
│   │   ├── src/codex-relay.ts
│   │   ├── src/probe-protocol.ts
│   │   ├── src/result-store.ts
│   │   ├── src/server.ts
│   │   ├── test/codex-relay.test.ts
│   │   ├── test/probe-protocol.test.ts
│   │   └── tsconfig.json
│   └── tablet-probe/
│       ├── index.html
│       ├── package.json
│       ├── src/audio-probe.ts
│       ├── src/canvas-probe.ts
│       ├── src/codex-audio-probe.ts
│       ├── src/main.ts
│       ├── src/probe-client.ts
│       ├── src/style.css
│       ├── test/audio-probe.test.ts
│       ├── test/codex-audio-probe.test.ts
│       ├── test/probe-client.test.ts
│       └── tsconfig.json
├── packages/
│   └── gate-contracts/
│       ├── package.json
│       ├── src/index.ts
│       ├── src/metrics.ts
│       ├── src/schemas.ts
│       ├── test/metrics.test.ts
│       └── tsconfig.json
├── tools/
│   ├── codex-realtime-probe/
│   │   ├── package.json
│   │   ├── src/app-server-client.ts
│   │   ├── src/cli.ts
│   │   ├── src/live-probe.ts
│   │   ├── test/app-server-client.test.ts
│   │   ├── test/fixtures/fake-app-server.mjs
│   │   ├── test/live-probe.test.ts
│   │   └── tsconfig.json
│   └── gate-report/
│       ├── package.json
│       ├── src/cli.ts
│       ├── src/evaluate.ts
│       ├── test/evaluate.test.ts
│       └── tsconfig.json
├── validation/
│   ├── README.md
│   ├── results/.gitkeep
│   └── wizard-of-oz/
│       ├── session-guide.md
│       └── session-template.json
├── scripts/
│   ├── issue-local-cert.sh
│   ├── run-device-gate.sh
│   └── snapshot-codex-schema.sh
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Task 1：初始化受控工作区

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`

- [ ] **Step 1：确认目录尚未属于其他 Git 仓库**

Run:

```bash
pwd
git rev-parse --show-toplevel
```

Expected: `pwd` 为 `/Users/houbin/Documents/Codex/2026-08-29/wo-yo`；第二条返回“not a git repository”。若第二条返回其他仓库路径，立即停止，不初始化嵌套仓库。

- [ ] **Step 2：直接初始化工作分支，避免在保护分支上工作**

Run:

```bash
git init -b feat/phase-0-validation-gates
git rev-parse --abbrev-ref HEAD
```

Expected: `feat/phase-0-validation-gates`。

- [ ] **Step 3：写入最小工作区文件**

`package.json`：

```json
{
  "name": "ai-scholar-learning-system",
  "private": true,
  "packageManager": "pnpm@11.1.2",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "pnpm -r --if-present typecheck",
    "build:tablet": "pnpm --filter @ai-scholar/tablet-probe build",
    "gate:device": "bash scripts/run-device-gate.sh",
    "gate:codex": "pnpm --filter @ai-scholar/codex-realtime-probe start",
    "gate:report": "pnpm --filter @ai-scholar/gate-report start"
  }
}
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - apps/*
  - packages/*
  - tools/*
```

`tsconfig.base.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

实现某个子项目时同时创建其 `tsconfig.json`，内容继承 `../../tsconfig.base.json`，并在该子项目 `package.json` 中定义 `"typecheck": "tsc --noEmit"`，保证已存在的子项目都参加根目录递归类型检查。

`.gitignore`：

```gitignore
node_modules/
dist/
coverage/
.DS_Store
.superpowers/
outputs/
certs/
validation/results/*
!validation/results/.gitkeep
work/codex-app-server-schema/
*.log
```

- [ ] **Step 4：安装统一开发依赖**

Run:

```bash
pnpm add -Dw typescript vitest tsx @types/node
```

Expected: 生成 `pnpm-lock.yaml`，命令退出码为 0。若公网 registry 失败，按本机内网 Nexus 地址重试同一命令，不改变依赖集合。

- [ ] **Step 5：提交初始化结果**

```bash
git add .gitignore package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml docs
git commit -m "初始化阶段0验证工作区"
```

Expected: 创建首个提交，当前分支仍为 `feat/phase-0-validation-gates`。

## Task 2：用 TDD 建立统一指标与结果契约

**Files:**
- Create: `packages/gate-contracts/package.json`
- Create: `packages/gate-contracts/tsconfig.json`
- Create: `packages/gate-contracts/src/metrics.ts`
- Create: `packages/gate-contracts/src/schemas.ts`
- Create: `packages/gate-contracts/src/index.ts`
- Test: `packages/gate-contracts/test/metrics.test.ts`

- [ ] **Step 1：创建包定义并安装唯一运行依赖**

```json
{
  "name": "@ai-scholar/gate-contracts",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^4.0.0"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

以上两段分别写入该包的 `package.json` 和 `tsconfig.json`。

Run:

```bash
pnpm add --filter @ai-scholar/gate-contracts zod
```

Expected: 命令退出码 0，lockfile 记录 Zod。

- [ ] **Step 2：先写百分位和门禁汇总失败测试**

```ts
// packages/gate-contracts/test/metrics.test.ts
import { describe, expect, it } from "vitest";
import { summarizeSamples } from "../src/metrics.js";

describe("summarizeSamples", () => {
  it("使用 nearest-rank 计算 P50/P95 并统计成功率", () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    const result = summarizeSamples(
      values.map((elapsedMs, index) => ({ elapsedMs, success: index !== 19 })),
    );

    expect(result).toEqual({
      count: 20,
      successCount: 19,
      successRate: 0.95,
      p50Ms: 10,
      p95Ms: 19,
      maxMs: 20,
    });
  });

  it("拒绝空样本", () => {
    expect(() => summarizeSamples([])).toThrow("至少需要一个样本");
  });
});
```

- [ ] **Step 3：运行测试确认失败**

Run:

```bash
pnpm vitest run packages/gate-contracts/test/metrics.test.ts
```

Expected: FAIL，提示无法找到 `../src/metrics.js`。

- [ ] **Step 4：实现最小百分位函数**

```ts
// packages/gate-contracts/src/metrics.ts
export interface TimedSample {
  elapsedMs: number;
  success: boolean;
}

export interface SampleSummary {
  count: number;
  successCount: number;
  successRate: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

function nearestRank(values: number[], percentile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index]!;
}

export function summarizeSamples(samples: TimedSample[]): SampleSummary {
  if (samples.length === 0) throw new Error("至少需要一个样本");
  const values = samples.map((sample) => sample.elapsedMs);
  const successCount = samples.filter((sample) => sample.success).length;
  return {
    count: samples.length,
    successCount,
    successRate: successCount / samples.length,
    p50Ms: nearestRank(values, 0.5),
    p95Ms: nearestRank(values, 0.95),
    maxMs: Math.max(...values),
  };
}
```

- [ ] **Step 5：定义三类结果的 Zod 契约**

`schemas.ts` 必须定义并导出：

```ts
import { z } from "zod";

export const gateStatusSchema = z.enum(["PASS", "FAIL", "BLOCKED"]);
export const hintLevelSchema = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
]);

export const wizardSessionSchema = z.object({
  sessionId: z.string().min(1),
  occurredAt: z.string().datetime(),
  challenge: z.string().min(1),
  transferChallenge: z.string().min(1),
  firstRepresentation: z.string().min(1),
  timeToFirstProductiveActionMs: z.number().int().nonnegative(),
  maxHintLevel: hintLevelSchema,
  productivePrompt: z.string().min(1),
  explainBackEvidence: z.string().min(1),
  transferIndependent: z.boolean(),
  childRequestedPause: z.boolean(),
  childContestedInterpretation: z.boolean(),
  childWillingToContinue: z.boolean(),
  parentNotes: z.string(),
});

export const wizardRunSchema = z.object({
  runId: z.string().min(1),
  sessions: z.array(wizardSessionSchema).min(1),
});

export const metricSampleSchema = z.object({
  metric: z.enum([
    "pen_render_ms",
    "local_interrupt_ms",
    "lan_ack_ms",
    "first_audio_ms",
    "remote_canvas_ms",
    "reconnect_ms",
  ]),
  elapsedMs: z.number().nonnegative(),
  success: z.boolean(),
  occurredAt: z.string().datetime(),
});

export const deviceRunSchema = z.object({
  runId: z.string().min(1),
  device: z.string().min(1),
  browser: z.string().min(1),
  secureContext: z.boolean(),
  microphonePermission: z.enum(["granted", "prompt", "denied"]),
  samples: z.array(metricSampleSchema).min(1),
});

export const codexRunSchema = z.object({
  runId: z.string().min(1),
  codexVersion: z.string().min(1),
  schemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
  accountType: z.enum(["chatgpt", "apiKey", "unknown"]),
  planType: z.string(),
  openAiApiKeyPresent: z.boolean(),
  beforeRateLimits: z.unknown(),
  afterRateLimits: z.unknown(),
  sessionsAttempted: z.number().int().positive(),
  sessionsSucceeded: z.number().int().nonnegative(),
  firstAudioSamplesMs: z.array(z.number().nonnegative()),
  transcriptSamples: z.array(z.string()),
  realtimeAvailable: z.boolean(),
  usageAttribution: z.enum(["codex", "api", "unknown"]),
  usageConfirmedAt: z.string().datetime().nullable(),
  apiUsageObserved: z.boolean().nullable(),
  errors: z.array(z.string()),
});
```

`index.ts` 只重新导出 `metrics.ts` 与 `schemas.ts`。包名固定为 `@ai-scholar/gate-contracts`，`type` 固定为 `module`。

- [ ] **Step 6：运行测试和类型检查**

Run:

```bash
pnpm vitest run packages/gate-contracts/test/metrics.test.ts
pnpm typecheck
```

Expected: 两条命令均退出码 0，测试显示 `2 passed`。

- [ ] **Step 7：提交契约**

```bash
git add packages package.json pnpm-lock.yaml
git commit -m "新增阶段0门禁指标契约"
```

## Task 3：准备 Wizard-of-Oz 真实家庭试用材料

**Files:**
- Create: `validation/README.md`
- Create: `validation/results/.gitkeep`
- Create: `validation/wizard-of-oz/session-guide.md`
- Create: `validation/wizard-of-oz/session-template.json`

- [ ] **Step 1：写儿童知情开场和 L0–L4 提示卡**

`session-guide.md` 必须逐字包含以下可执行脚本：

```markdown
# Wizard-of-Oz 家庭试用

## 开场

“今天不是测试你，是我们一起测试一种学习方法。你可以随时说‘我卡住了’、‘我想休息’或‘你理解错了’。”

## 原挑战

“2.4 × 0.3 大约是多少？先不要急着列竖式，用画图、语言或你自己的方式说明。”

## 提示卡

- L0：安静观察 30 秒；只要孩子仍有新产出就继续等待。
- L1：“你现在已经确定了什么？”
- L2：“0.3 还能换成什么说法？”
- L3：画一个分成 10 份的空长条，不填数，让孩子继续。
- L4：演示 2 × 0.3 后擦掉结果，请孩子重新建立 2.4 × 0.3。

孩子一旦产生新的实质性尝试，立即停止提示。

## 讲回

“为什么结果应该比 2.4 小？请用你自己的话或图说明。”

## 无提示迁移

“现在独立试试 3.5 × 0.4，仍然先说明关系，再计算。”

## 结束

“今天哪一部分让你觉得有帮助？哪一部分让你不舒服或不想继续？”
```

- [ ] **Step 2：写可验证的空白记录模板**

```json
{
  "sessionId": "wizard-2026-09-01-01",
  "occurredAt": "2026-09-01T19:00:00+08:00",
  "challenge": "2.4 × 0.3",
  "transferChallenge": "3.5 × 0.4",
  "firstRepresentation": "尚未执行，执行后替换为观察事实",
  "timeToFirstProductiveActionMs": 0,
  "maxHintLevel": 0,
  "productivePrompt": "尚未执行，执行后替换为实际话术",
  "explainBackEvidence": "尚未执行，执行后替换为孩子原话摘要",
  "transferIndependent": false,
  "childRequestedPause": false,
  "childContestedInterpretation": false,
  "childWillingToContinue": false,
  "parentNotes": "这是空白模板，不是验证结果"
}
```

这里的“尚未执行”只存在于空白模板，不得复制到最终结果；最终记录必须写可观察事实，不能写“粗心”“没天赋”“注意力差”等人格判断。

- [ ] **Step 3：在 `validation/README.md` 定义通过、失败和复测规则**

规则必须是：

- 单次试用用于发现明显不适配，不能证明长期有效；
- 一周内完成 3 次同根因、不同表面挑战后，最高提示级别不升且出现至少 1 次无提示迁移，才把教学门禁标为 `PASS`；
- 孩子明显抗拒、只能复述家长、或必须连续提示才能行动，标为 `FAIL` 并修改教学闭环；
- 孩子选择停止、家庭时间不足或记录不完整，标为 `BLOCKED`，不得算作孩子失败。

- [ ] **Step 4：校验模板符合契约**

Run:

```bash
pnpm tsx -e 'import {readFileSync} from "node:fs"; import {wizardSessionSchema} from "./packages/gate-contracts/src/index.ts"; wizardSessionSchema.parse(JSON.parse(readFileSync("validation/wizard-of-oz/session-template.json", "utf8"))); console.log("wizard schema ok")'
```

Expected: 输出 `wizard schema ok`。

- [ ] **Step 5：提交家庭试用材料**

```bash
git add validation
git commit -m "新增家庭教学闭环验证材料"
```

## Task 4：用 TDD 实现局域网探针服务

**Files:**
- Create: `apps/gate-server/package.json`
- Create: `apps/gate-server/tsconfig.json`
- Create: `apps/gate-server/src/probe-protocol.ts`
- Create: `apps/gate-server/src/result-store.ts`
- Create: `apps/gate-server/src/server.ts`
- Test: `apps/gate-server/test/probe-protocol.test.ts`

- [ ] **Step 1：创建服务包并安装依赖**

包名固定为 `@ai-scholar/gate-server`，`type` 为 `module`，脚本为 `"dev": "tsx src/server.ts"`、`"typecheck": "tsc --noEmit"`。依赖只包含 `@ai-scholar/gate-contracts`、`fastify`、`@fastify/static`、`@fastify/websocket` 和 `zod`。

`tsconfig.json` 继承 `../../tsconfig.base.json`，设置 `"types": ["node"]`，包含 `src/**/*.ts` 与 `test/**/*.ts`。

Run:

```bash
pnpm add --filter @ai-scholar/gate-server @ai-scholar/gate-contracts@workspace:* fastify @fastify/static @fastify/websocket zod
```

Expected: 命令退出码 0。

- [ ] **Step 2：先写协议失败测试**

```ts
// apps/gate-server/test/probe-protocol.test.ts
import { describe, expect, it } from "vitest";
import { handleProbeMessage } from "../src/probe-protocol.js";

describe("handleProbeMessage", () => {
  it("确认平板事件并原样返回序号", () => {
    expect(handleProbeMessage({ type: "ping", id: "p-7", clientSeq: 7 }, 1234)).toEqual({
      type: "ack",
      id: "p-7",
      clientSeq: 7,
      serverReceivedAt: 1234,
    });
  });

  it("为远端画布探针返回安全语义动作", () => {
    expect(handleProbeMessage({ type: "canvas-probe", id: "c-1", clientSeq: 8 }, 1250)).toMatchObject({
      type: "canvas-action",
      id: "c-1",
      action: { kind: "circle", x: 0.5, y: 0.5, radius: 0.1 },
    });
  });
});
```

- [ ] **Step 3：运行测试确认失败**

Run:

```bash
pnpm vitest run apps/gate-server/test/probe-protocol.test.ts
```

Expected: FAIL，提示找不到 `probe-protocol.js`。

- [ ] **Step 4：实现纯函数协议处理器**

```ts
// apps/gate-server/src/probe-protocol.ts
export type ProbeMessage =
  | { type: "ping"; id: string; clientSeq: number }
  | { type: "canvas-probe"; id: string; clientSeq: number };

export function handleProbeMessage(message: ProbeMessage, serverReceivedAt = Date.now()) {
  if (message.type === "ping") {
    return { type: "ack" as const, id: message.id, clientSeq: message.clientSeq, serverReceivedAt };
  }
  return {
    type: "canvas-action" as const,
    id: message.id,
    clientSeq: message.clientSeq,
    serverReceivedAt,
    action: { kind: "circle" as const, x: 0.5, y: 0.5, radius: 0.1 },
  };
}
```

- [ ] **Step 5：实现 HTTPS、WebSocket 和结果落盘**

`server.ts` 必须：

- 只读取 `GATE_TLS_CERT`、`GATE_TLS_KEY`、`GATE_RESULT_DIR` 和 `GATE_PORT`；
- 在 `0.0.0.0` 上提供 HTTPS，但不开放公网端口或配置路由器映射；
- `GET /health` 返回 `{ "ok": true }`；
- WebSocket `/probe` 使用 `handleProbeMessage`；
- `POST /api/device-runs` 使用 `deviceRunSchema` 校验后，以 `runId.json` 原子写入 `validation/results/device/`；
- 同名 `runId` 已存在时返回 HTTP 409，禁止覆盖真实测量。

`result-store.ts` 使用“临时文件写入后 rename”的方式完成原子写入；路径必须由校验后的 `runId` 生成，并再次限制为字母、数字、点、下划线和短横线。

- [ ] **Step 6：运行测试与类型检查**

Run:

```bash
pnpm vitest run apps/gate-server/test/probe-protocol.test.ts
pnpm typecheck
```

Expected: 测试 `2 passed`，类型检查退出码 0。

- [ ] **Step 7：提交局域网服务**

```bash
git add apps/gate-server package.json pnpm-lock.yaml
git commit -m "实现局域网设备探针服务"
```

## Task 5：实现触控笔、局域网和远端画布探针

**Files:**
- Create: `apps/tablet-probe/package.json`
- Create: `apps/tablet-probe/tsconfig.json`
- Create: `apps/tablet-probe/index.html`
- Create: `apps/tablet-probe/src/canvas-probe.ts`
- Create: `apps/tablet-probe/src/probe-client.ts`
- Create: `apps/tablet-probe/src/main.ts`
- Create: `apps/tablet-probe/src/style.css`
- Test: `apps/tablet-probe/test/probe-client.test.ts`

- [ ] **Step 1：创建 Vite Vanilla TypeScript 包**

包名固定为 `@ai-scholar/tablet-probe`，`type` 为 `module`，脚本为 `"dev": "vite"`、`"build": "vite build"`、`"typecheck": "tsc --noEmit"`。运行依赖只包含 `@ai-scholar/gate-contracts`，开发依赖增加 `vite`。

`tsconfig.json` 继承 `../../tsconfig.base.json`，设置 `"lib": ["ES2022", "DOM", "DOM.Iterable"]`，包含 `src/**/*.ts` 与 `test/**/*.ts`。

Run:

```bash
pnpm add --filter @ai-scholar/tablet-probe @ai-scholar/gate-contracts@workspace:*
pnpm add -D --filter @ai-scholar/tablet-probe vite
```

Expected: 两条命令退出码均为 0。

- [ ] **Step 2：先写重连退避与确认匹配失败测试**

```ts
// apps/tablet-probe/test/probe-client.test.ts
import { describe, expect, it } from "vitest";
import { reconnectDelayMs, resolveAck } from "../src/probe-client.js";

describe("probe client", () => {
  it("退避不超过 1000ms，满足 5 秒恢复预算", () => {
    expect([0, 1, 2, 3, 4].map(reconnectDelayMs)).toEqual([100, 200, 400, 800, 1000]);
  });

  it("只用相同 id 的确认完成测量", () => {
    const pending = new Map([["p-1", 100]]);
    expect(resolveAck(pending, { id: "p-2" }, 150)).toBeNull();
    expect(resolveAck(pending, { id: "p-1" }, 175)).toEqual({ elapsedMs: 75, success: true });
  });
});
```

- [ ] **Step 3：运行测试确认失败**

Run:

```bash
pnpm vitest run apps/tablet-probe/test/probe-client.test.ts
```

Expected: FAIL，提示找不到 `probe-client.js`。

- [ ] **Step 4：实现可测试的确认和重连核心**

```ts
// apps/tablet-probe/src/probe-client.ts
export function reconnectDelayMs(attempt: number): number {
  return Math.min(1000, 100 * 2 ** attempt);
}

export function resolveAck(
  pending: Map<string, number>,
  message: { id: string },
  now = performance.now(),
) {
  const startedAt = pending.get(message.id);
  if (startedAt === undefined) return null;
  pending.delete(message.id);
  return { elapsedMs: now - startedAt, success: true };
}
```

- [ ] **Step 5：实现触控笔延迟采样**

`canvas-probe.ts` 必须使用 Pointer Events，并同时满足：

- `touch-action: none`，防止页面滚动吞掉笔迹；
- 保存 `pointerType`，报告中可区分 `pen` 和 `touch`；
- 每个 `pointermove` 先将线段写入画布，再在下一次 `requestAnimationFrame` 记录 `performance.now() - event.timeStamp`；
- 至少收集 100 个 `pen_render_ms` 样本；
- Agent 返回的圆只绘制在独立 overlay canvas，不得改写儿童笔迹 canvas。

核心采样函数固定为：

```ts
export function measureNextPaint(eventTimeStamp: number): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve(Math.max(0, performance.now() - eventTimeStamp)));
  });
}
```

- [ ] **Step 6：实现 100 次局域网确认与 20 次远端画布测量**

`main.ts` 中两个按钮必须分别执行：

- 顺序发送 100 次 `ping`，每次收到相同 `id` 的确认后才发送下一次；
- 顺序发送 20 次 `canvas-probe`，收到动作并完成下一帧绘制后记录总耗时；
- 页面实时显示样本数、P50、P95、最大值和是否达到阈值；
- 不能把失败样本从统计中删除，超时按失败记录。

- [ ] **Step 7：运行测试、构建和类型检查**

Run:

```bash
pnpm vitest run apps/tablet-probe/test/probe-client.test.ts
pnpm build:tablet
pnpm typecheck
```

Expected: 测试 `2 passed`；Vite 构建生成 `apps/tablet-probe/dist/index.html`；类型检查退出码 0。

- [ ] **Step 8：提交触控与网络探针**

```bash
git add apps/tablet-probe package.json pnpm-lock.yaml
git commit -m "实现平板触控与局域网探针"
```

## Task 6：实现录音、播放和本地语音打断探针

**Files:**
- Create: `apps/tablet-probe/src/audio-probe.ts`
- Modify: `apps/tablet-probe/src/main.ts`
- Modify: `apps/tablet-probe/src/style.css`
- Test: `apps/tablet-probe/test/audio-probe.test.ts`

- [ ] **Step 1：先写 RMS 与打断判据失败测试**

```ts
// apps/tablet-probe/test/audio-probe.test.ts
import { describe, expect, it } from "vitest";
import { calculateRms, shouldInterrupt } from "../src/audio-probe.js";

describe("audio probe", () => {
  it("计算标准化 PCM 的 RMS", () => {
    expect(calculateRms(new Float32Array([1, -1, 1, -1]))).toBe(1);
  });

  it("只有连续三帧超过阈值才打断", () => {
    expect(shouldInterrupt([0.02, 0.08, 0.09], 0.05)).toBe(false);
    expect(shouldInterrupt([0.08, 0.09, 0.07], 0.05)).toBe(true);
  });
});
```

- [ ] **Step 2：运行测试确认失败**

Run:

```bash
pnpm vitest run apps/tablet-probe/test/audio-probe.test.ts
```

Expected: FAIL，提示找不到 `audio-probe.js`。

- [ ] **Step 3：实现最小音频判据**

```ts
// apps/tablet-probe/src/audio-probe.ts
export function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  const sum = samples.reduce((total, value) => total + value * value, 0);
  return Math.sqrt(sum / samples.length);
}

export function shouldInterrupt(frames: number[], threshold: number): boolean {
  return frames.length >= 3 && frames.slice(-3).every((value) => value >= threshold);
}
```

- [ ] **Step 4：接入浏览器音频能力**

实现必须遵守：

- 只有孩子点击“开始录音”后才调用 `getUserMedia`；
- 录制 5 秒后停止并立即提供本地回放，连续完成 10 次；
- 原始录音只保存在页面内存，不上传、不写入 Mac mini；
- 使用 Web Audio `AnalyserNode` 计算最近三帧 RMS；
- 通过 AudioBufferSourceNode 播放本地测试音；检测到连续三帧超过阈值时立即在平板调用 `source.stop()`；
- 记录“第一次超过阈值的帧”到 `stop()` 调用的耗时，至少 20 次；
- 页面明确提示：这个数测量本地处理链；再用手机慢动作录像抽查 5 次真实说话起点到声音停止的物理延迟。

- [ ] **Step 5：加入锁屏与恢复人工检查项**

页面提供 5 次勾选记录：每次锁屏/唤醒后，重新点击一次“恢复音频”，确认 `AudioContext.state === "running"`，再录制和回放。任何一次无法恢复都作为失败样本，不能只写在备注中。

- [ ] **Step 6：运行测试和构建**

Run:

```bash
pnpm vitest run apps/tablet-probe/test/audio-probe.test.ts
pnpm build:tablet
pnpm typecheck
```

Expected: 测试 `2 passed`；构建和类型检查退出码 0。

- [ ] **Step 7：提交音频探针**

```bash
git add apps/tablet-probe
git commit -m "实现平板录音与本地打断探针"
```

## Task 7：建立局域网 HTTPS 与真实设备运行脚本

**Files:**
- Create: `scripts/issue-local-cert.sh`
- Create: `scripts/run-device-gate.sh`
- Modify: `validation/README.md`

- [ ] **Step 1：写证书生成脚本**

脚本必须使用 `set -euo pipefail`，自动获取 Mac 的 `.local` 主机名和活动局域网 IP，输出到 `certs/lan.pem` 与 `certs/lan-key.pem`。若未安装 `mkcert`，脚本打印 `brew install mkcert` 后退出，不自动安装系统软件。

核心命令：

```bash
mkdir -p certs
device_host="$(scutil --get LocalHostName).local"
device_ip="$(ipconfig getifaddr en0 || ipconfig getifaddr en1)"
mkcert -install
mkcert -cert-file certs/lan.pem -key-file certs/lan-key.pem "$device_host" "$device_ip" localhost 127.0.0.1
cp "$(mkcert -CAROOT)/rootCA.pem" certs/mkcert-root-ca.cer
```

脚本必须在 `device_ip` 为空时退出，禁止生成只含 localhost 的证书并宣称平板可用。

- [ ] **Step 2：写一键启动脚本**

`run-device-gate.sh` 必须依次：

1. 检查证书存在；
2. 构建 tablet probe；
3. 设置 `GATE_TLS_CERT`、`GATE_TLS_KEY`、`GATE_RESULT_DIR`、`GATE_PORT=8443`；
4. 启动 gate-server；
5. 打印由脚本检测出的具体局域网地址，例如 `https://192.168.1.20:8443/`，不打印 localhost 作为平板地址。

- [ ] **Step 3：记录 iPad 手工信任步骤**

`validation/README.md` 加入：

1. 将 `certs/mkcert-root-ca.cer` AirDrop 到家长控制的 iPad；
2. 在“设置 → 通用 → VPN与设备管理”安装描述文件；
3. 在“设置 → 通用 → 关于本机 → 证书信任设置”打开对该根证书的完全信任；
4. 用 Safari 打开脚本打印的 HTTPS 地址；
5. 页面必须显示 `window.isSecureContext === true` 后才能申请麦克风；
6. 测试完成后，如不再使用该证书，从 iPad 删除描述文件。

- [ ] **Step 4：在 Mac 上做 HTTPS 冒烟测试**

Run:

```bash
bash scripts/issue-local-cert.sh
pnpm gate:device
```

另开终端运行：

```bash
curl --cacert certs/mkcert-root-ca.cer https://localhost:8443/health
```

Expected: 返回 `{"ok":true}`。完成后正常终止服务，不使用 `kill -9`。

- [ ] **Step 5：提交脚本和运行手册**

```bash
git add scripts validation/README.md
git commit -m "建立平板门禁的局域网HTTPS运行方式"
```

## Task 8：用假 app-server TDD 实现 Codex JSON-RPC 客户端

**Files:**
- Create: `tools/codex-realtime-probe/package.json`
- Create: `tools/codex-realtime-probe/tsconfig.json`
- Create: `tools/codex-realtime-probe/src/app-server-client.ts`
- Create: `tools/codex-realtime-probe/test/fixtures/fake-app-server.mjs`
- Test: `tools/codex-realtime-probe/test/app-server-client.test.ts`

- [ ] **Step 1：创建探针工具包**

包名固定为 `@ai-scholar/codex-realtime-probe`，`type` 为 `module`，脚本为 `"start": "tsx src/cli.ts"`、`"typecheck": "tsc --noEmit"`；依赖 `@ai-scholar/gate-contracts`。`tsconfig.json` 继承根配置，启用 Node 类型，包含 `src/**/*.ts` 与 `test/**/*.ts`。

Run:

```bash
pnpm add --filter @ai-scholar/codex-realtime-probe @ai-scholar/gate-contracts@workspace:*
```

Expected: 命令退出码 0。

- [ ] **Step 2：先写初始化、请求匹配和通知失败测试**

```ts
// tools/codex-realtime-probe/test/app-server-client.test.ts
import { describe, expect, it } from "vitest";
import { AppServerClient } from "../src/app-server-client.js";

describe("AppServerClient", () => {
  it("初始化后按 id 匹配响应，并保留实时通知", async () => {
    const client = await AppServerClient.spawn(process.execPath, [
      "test/fixtures/fake-app-server.mjs",
    ]);
    await client.initialize();
    const account = await client.request("account/read", { refreshToken: false });
    expect(account).toMatchObject({ account: { type: "chatgpt", planType: "pro" } });
    expect(await client.waitForNotification("thread/realtime/started", 1000)).toMatchObject({
      params: { threadId: "thread-1", version: "v1" },
    });
    await client.close();
  });
});
```

- [ ] **Step 3：实现固定响应的假 app-server**

假服务只读取逐行 JSON。收到 `initialize` 时返回协议版本；收到 `account/read` 时先发 `thread/realtime/started` 通知，再返回 ChatGPT Pro 假账号。假服务不得访问网络或读取真实 Codex 配置。

- [ ] **Step 4：运行测试确认客户端尚不存在**

Run:

```bash
pnpm vitest run tools/codex-realtime-probe/test/app-server-client.test.ts
```

Expected: FAIL，提示找不到 `app-server-client.js`。

- [ ] **Step 5：实现逐行 JSON-RPC 客户端**

客户端必须：

- 使用 `spawn`，参数数组传递，禁止 `shell: true`；
- 只向子进程 stdin 写 JSON-RPC，每条消息以换行结束；
- `initialize` 参数固定为 `clientInfo: { name: "ai-scholar-gate", title: "AI Scholar Gate", version: "0.1.0" }`；
- 初始化响应后发送 `{"method":"initialized"}`；
- 请求用单调递增整数 id；
- stderr 单独收集但不解析为协议；
- 每个请求和通知等待都有超时；
- 关闭时先关闭 stdin，等待正常退出，超时后只终止该子进程。

- [ ] **Step 6：运行测试与类型检查**

Run:

```bash
pnpm vitest run tools/codex-realtime-probe/test/app-server-client.test.ts
pnpm typecheck
```

Expected: 测试 `1 passed`；类型检查退出码 0。

- [ ] **Step 7：提交 JSON-RPC 客户端**

```bash
git add tools/codex-realtime-probe package.json pnpm-lock.yaml
git commit -m "实现Codex实时探针协议客户端"
```

## Task 9：实现 Codex 实时能力、身份和协议漂移探针

**Files:**
- Create: `scripts/snapshot-codex-schema.sh`
- Create: `tools/codex-realtime-probe/src/live-probe.ts`
- Create: `tools/codex-realtime-probe/src/cli.ts`
- Create: `apps/gate-server/src/codex-relay.ts`
- Create: `apps/tablet-probe/src/codex-audio-probe.ts`
- Modify: `apps/gate-server/src/server.ts`
- Modify: `apps/tablet-probe/src/main.ts`
- Test: `apps/gate-server/test/codex-relay.test.ts`
- Test: `apps/tablet-probe/test/codex-audio-probe.test.ts`
- Test: `tools/codex-realtime-probe/test/live-probe.test.ts`

- [ ] **Step 1：先写准入判定失败测试**

```ts
// tools/codex-realtime-probe/test/live-probe.test.ts
import { describe, expect, it } from "vitest";
import { assessCodexAdmission } from "../src/live-probe.js";

describe("assessCodexAdmission", () => {
  it("只允许 ChatGPT 身份且环境中没有 API key", () => {
    expect(assessCodexAdmission("chatgpt", false)).toEqual({ allowed: true, reasons: [] });
    expect(assessCodexAdmission("apiKey", true)).toEqual({
      allowed: false,
      reasons: ["当前是 API key 身份", "环境中存在 OPENAI_API_KEY"],
    });
  });
});
```

- [ ] **Step 2：运行测试确认失败**

Run:

```bash
pnpm vitest run tools/codex-realtime-probe/test/live-probe.test.ts
```

Expected: FAIL，提示找不到 `live-probe.js`。

- [ ] **Step 3：实现身份准入和 schema 快照脚本**

```ts
export function assessCodexAdmission(accountType: string, apiKeyPresent: boolean) {
  const reasons: string[] = [];
  if (accountType !== "chatgpt") reasons.push("当前是 API key 身份");
  if (apiKeyPresent) reasons.push("环境中存在 OPENAI_API_KEY");
  return { allowed: reasons.length === 0, reasons };
}
```

`snapshot-codex-schema.sh` 必须执行：

```bash
rm -rf work/codex-schema-current
mkdir -p work/codex-schema-current
codex app-server generate-json-schema --experimental --out work/codex-schema-current
shasum -a 256 work/codex-schema-current/ClientRequest.json work/codex-schema-current/ServerNotification.json > work/codex-schema-current/SHA256SUMS
codex --version > work/codex-schema-current/CODEX_VERSION
```

删除范围只能是明确的 `work/codex-schema-current`，不得使用变量、通配符或上级目录。

- [ ] **Step 4：实现真实会话探针**

`live-probe.ts` 严格按当前 `0.144.1` schema 发送：

1. 启动 `codex app-server --enable realtime_conversation --stdio`；
2. `initialize` 与 `initialized`；
3. `account/read`，确认 `account.type === "chatgpt"`；
4. `account/rateLimits/read`，保存前置快照；
5. `thread/start`，参数包含 `cwd`、`ephemeral: true`、`approvalPolicy: "never"`，从响应的 `thread.id` 取线程标识；
6. `thread/realtime/listVoices`；
7. `thread/realtime/start`，参数为 `{ threadId, outputModality: "audio", transport: { type: "websocket" }, includeStartupContext: false }`；
8. 等待 `thread/realtime/started`；
9. 发送 `thread/realtime/appendText`，文本固定为“请只说：你好，我们开始验证。”；
10. 以 `appendText` 发送时间为起点，以首个 `thread/realtime/outputAudio/delta` 为终点记录首音频延迟；
11. 收集 `thread/realtime/transcript/done` 与错误；
12. `thread/realtime/stop`；
13. 重复新建会话 20 次；
14. 再次读取 `account/rateLimits/read`；
15. 本轮固定写入 `validation/results/codex/codex-2026-09-01-01.json`。

真实运行开始前，程序只检查 `Boolean(process.env.OPENAI_API_KEY)`，不得打印 key 内容；存在时直接生成 `BLOCKED` 结果并退出，防止误走 API 计费路径。

初次写入时 `usageAttribution` 必须是 `unknown`，`usageConfirmedAt` 与 `apiUsageObserved` 必须是 `null`。CLI 还要提供本地 `annotate-usage` 子命令，只有家长查看 Codex Usage 与 API Usage 后，才能把这些字段更新为实际值；子命令要求显式填写 `--api-usage-observed true|false`，并在结果中追加确认时间。报告器遇到未确认字段必须返回 `BLOCKED`。

- [ ] **Step 5：加入真实音频输入的独立人工步骤**

文本输入成功只能验证会话和输出音频，不能证明儿童语音转写。CLI 增加 `--pcm-file`，只接受 16 位 little-endian 单声道 PCM；按 100 ms 分块调用：

```ts
await client.request("thread/realtime/appendAudio", {
  threadId,
  audio: {
    data: chunk.toString("base64"),
    sampleRate: 24000,
    numChannels: 1,
    samplesPerChannel: chunk.length / 2,
  },
});
```

音频文件由家长在设备探针中现场录制一句“二点四乘零点三”，只用于本轮内存/临时文件验证，运行结束立即由家长确认删除；不得把儿童原始录音加入 Git 或长期结果目录。

- [ ] **Step 6：实现平板到 Codex 再回平板的最小实时中继**

`codex-relay.ts` 只在 `ENABLE_CODEX_RELAY=1` 时注册 `/codex-realtime-probe` WebSocket。每个连接创建一个临时 Codex thread；它只接受三类消息：

```ts
type TabletRealtimeMessage =
  | { type: "audio"; data: string; sampleRate: 24000; numChannels: 1; samplesPerChannel: number }
  | { type: "utterance-end"; clientEndedAt: number }
  | { type: "stop" };
```

- `audio` 原样映射为 `thread/realtime/appendAudio`，不落盘；
- 收到 `utterance-end` 后补发 800 ms 的 24 kHz 单声道静音，让服务端 VAD 获得明确尾部；
- 首个 `thread/realtime/outputAudio/delta` 原样转发为 `{ type: "output-audio", audio }`；
- `stop` 立即停止本地转发和播放，再调用 `thread/realtime/stop`；
- WebSocket 关闭时销毁临时 thread 客户端和内存音频，不保存连续原始录音。

`codex-audio-probe.ts` 使用 AudioWorklet 将麦克风 Float32 数据重采样为 24 kHz PCM16；孩子松开“按住说话”按钮时记录 `performance.now()` 并发送 `utterance-end`。收到首个 `output-audio` 时记录 `first_audio_ms`，随后用 AudioContext 顺序播放 PCM 块。连续做 20 次后生成端到端 P50/P95；不能用 Mac 端首包时间冒充平板端首音频时间。

- [ ] **Step 7：为中继添加确定性映射测试**

测试不连接真实 Codex，只验证：

- 24 kHz 单声道 PCM 消息被完整映射；
- 48 kHz 输入重采样后的样本数为原来一半；
- `utterance-end` 生成 19,200 个静音样本，即 800 ms × 24,000；
- `stop` 先触发本地停止回调，再调用远端停止；
- 音频内容不传给结果存储器。

- [ ] **Step 8：运行单元测试和只读预检**

Run:

```bash
pnpm vitest run tools/codex-realtime-probe/test/live-probe.test.ts
bash scripts/snapshot-codex-schema.sh
codex features list | rg '^realtime_conversation\s+under development\s+false$'
```

Expected: 测试 `1 passed`；schema 目录存在并有哈希；功能行明确显示 `under development false`，证明必须由探针显式启用，不能写成稳定能力。

- [ ] **Step 9：提交探针代码，不提交真实结果和生成 schema**

```bash
git add scripts/snapshot-codex-schema.sh tools/codex-realtime-probe
git commit -m "实现Codex订阅实时能力探针"
```

## Task 10：用 TDD 实现统一门禁报告器

**Files:**
- Create: `tools/gate-report/package.json`
- Create: `tools/gate-report/tsconfig.json`
- Create: `tools/gate-report/src/evaluate.ts`
- Create: `tools/gate-report/src/cli.ts`
- Test: `tools/gate-report/test/evaluate.test.ts`

- [ ] **Step 1：创建报告工具包**

包名固定为 `@ai-scholar/gate-report`，`type` 为 `module`，脚本为 `"start": "tsx src/cli.ts"`、`"typecheck": "tsc --noEmit"`；依赖 `@ai-scholar/gate-contracts`。`tsconfig.json` 继承根配置，启用 Node 类型，包含 `src/**/*.ts` 与 `test/**/*.ts`。

Run:

```bash
pnpm add --filter @ai-scholar/gate-report @ai-scholar/gate-contracts@workspace:*
```

Expected: 命令退出码 0。

- [ ] **Step 2：先写阈值和停止策略失败测试**

```ts
// tools/gate-report/test/evaluate.test.ts
import { describe, expect, it } from "vitest";
import { evaluateDevice, evaluateCodex } from "../src/evaluate.js";

describe("gate evaluation", () => {
  it("任何关键设备指标超标都失败", () => {
    expect(evaluateDevice({
      penP95: 49,
      interruptP95: 201,
      lanP95: 140,
      firstAudioP50: 1200,
      firstAudioP95: 2500,
      remoteCanvasP95: 250,
      reconnectMax: 4000,
    }).status).toBe("FAIL");
  });

  it("Codex 不能是 API key 身份", () => {
    expect(evaluateCodex({
      accountType: "apiKey",
      apiKeyPresent: true,
      attempted: 20,
      succeeded: 20,
      firstAudioP50: 1000,
      firstAudioP95: 2000,
    }).status).toBe("BLOCKED");
  });
});
```

- [ ] **Step 3：运行测试确认失败**

Run:

```bash
pnpm vitest run tools/gate-report/test/evaluate.test.ts
```

Expected: FAIL，提示找不到 `evaluate.js`。

- [ ] **Step 4：实现纯函数判定器**

`evaluate.ts` 必须使用第 0 节固定阈值，不允许从模型输出或环境变量动态修改。Codex 为 `apiKey`、存在 `OPENAI_API_KEY`、功能不可用或用量归属不明时返回 `BLOCKED`；会话成功率或延迟不达标时返回 `FAIL`。

- [ ] **Step 5：实现 Markdown 报告输出**

`cli.ts` 接收三个显式文件参数：

```bash
pnpm gate:report -- \
  --wizard validation/results/wizard/wizard-run-2026-09-07.json \
  --device validation/results/device/device-2026-09-01-01.json \
  --codex validation/results/codex/codex-2026-09-01-01.json
```

本轮报告固定写到 `validation/results/gate-report-2026-09-07.md`，包含：

- 每项原始样本数、P50、P95、最大值和成功率；
- Wizard 观察事实与最高提示等级，不作人格推断；
- Codex 版本、schema 哈希、身份类型、前后额度快照和错误摘要；
- 三项独立状态；
- 总状态使用最严格规则：有 `BLOCKED` 则总状态 `BLOCKED`，否则有 `FAIL` 则 `FAIL`，全部通过才 `PASS`；
- `FAIL` 或 `BLOCKED` 时明确写“停止，不进入单挑战机器原型”。

- [ ] **Step 6：运行全部确定性测试**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: 所有测试通过，类型检查退出码 0。

- [ ] **Step 7：提交报告器**

```bash
git add tools/gate-report package.json pnpm-lock.yaml
git commit -m "实现阶段0统一门禁报告"
```

## Task 11：执行三项真实门禁并作出 Go/No-Go 决策

**Files:**
- Create locally, do not commit: `validation/results/wizard/wizard-run-2026-09-07.json`
- Create locally, do not commit: `validation/results/device/device-2026-09-01-01.json`
- Create locally, do not commit: `validation/results/codex/codex-2026-09-01-01.json`
- Create locally, do not commit: `validation/results/gate-report-2026-09-07.md`

- [ ] **Step 1：先执行一次 Wizard-of-Oz，随后安排一周内两次复测**

严格照 `session-guide.md`；孩子可随时停止。把模板复制到结果目录后，只填写真实观察，不保存未经同意的音频、照片或逐字转写。

三次记录最终合并为 `validation/results/wizard/wizard-run-2026-09-07.json`，结构为：

```json
{
  "runId": "wizard-run-2026-09-07",
  "sessions": [
    { "sessionId": "wizard-2026-09-01-01" },
    { "sessionId": "wizard-2026-09-04-02" },
    { "sessionId": "wizard-2026-09-07-03" }
  ]
}
```

上面只展示聚合结构；三个 session 对象必须各自包含 `wizardSessionSchema` 的全部字段，不能只保留 `sessionId`。

- [ ] **Step 2：在最终目标平板上完成全部设备测量**

Run on Mac mini:

```bash
pnpm gate:device
```

在 iPad 上完成：100 次局域网确认、100 个 Apple Pencil 样本、20 次本地打断、20 次远端画布、10 次录音回放、5 次断线恢复和 5 次锁屏恢复。设备型号、iPadOS/Safari 版本必须写入结果。

- [ ] **Step 3：执行 Codex 20 轮实时探针**

先在 Codex Settings → Usage 和当前 Codex 会话 `/status` 留下不含敏感信息的前置记录，再运行：

```bash
env -u OPENAI_API_KEY pnpm gate:codex
```

运行后再次查看 Usage。若必须提供 API key 才能继续，停止并记录 `BLOCKED`；不得转向公开 Realtime API，也不得购买 API 额度。

- [ ] **Step 4：复核用量归属**

至少保存以下证据摘要：

- `account/read` 返回的身份类型和套餐类型；
- `account/rateLimits/read` 前后快照；
- Codex Usage 页面是否出现相应变化；
- API 平台是否没有产生这次测试的用量；
- 页面数据尚未刷新时标为 `BLOCKED`，不要根据“看起来没扣费”推断免费或订阅可用。

确认 Codex Usage 有对应变化且 API Usage 无对应调用后，运行：

```bash
pnpm --filter @ai-scholar/codex-realtime-probe start -- \
  annotate-usage \
  --run validation/results/codex/codex-2026-09-01-01.json \
  --usage-attribution codex \
  --api-usage-observed false
```

若证据不是这个结论，必须使用实际值；不能为了让门禁变绿而照抄命令。

- [ ] **Step 5：生成最终门禁报告**

Run:

```bash
pnpm gate:report -- \
  --wizard validation/results/wizard/wizard-run-2026-09-07.json \
  --device validation/results/device/device-2026-09-01-01.json \
  --codex validation/results/codex/codex-2026-09-01-01.json
```

Expected: 生成一份总状态明确的 Markdown 报告；缺失任一输入时命令失败，不能生成“部分通过”的绿色报告。

- [ ] **Step 6：执行停止规则**

- 总状态 `PASS`：为“单挑战机器原型”另写计划，范围只包含 `2.4 × 0.3`、`ParentCoachBridge`、`ScriptedReplayBridge`、本地画布和事件落盘。
- 设备 `FAIL`：先决定修正 PWA 传输/缓冲，或改用原生 iPad 壳，再复测同一门禁。
- 教学 `FAIL`：回到设计规范第 5 章修改介入窗口、提示卡或讲回方式，再重新做家庭试用。
- Codex `FAIL/BLOCKED`：停在桥接层向用户报告；不接第三方模型，不用 API key 替代订阅路径。

- [ ] **Step 7：提交代码状态，保留家庭数据在本地未跟踪目录**

Run:

```bash
git status --short
pnpm test
pnpm typecheck
```

Expected: 代码和计划没有未提交改动；`validation/results/` 内容被 `.gitignore` 排除；测试和类型检查均通过。真实家庭结果不提交 Git。

## 自检映射

| 设计要求 | 实施任务 |
|---|---|
| 家长扮演 Agent，L0–L4，讲回与迁移 | Task 3、Task 11 |
| 儿童可暂停、可异议、非评判性记录 | Task 3 |
| Apple Pencil 跟手与独立画布层 | Task 5 |
| 录音、回放、本地 200ms 打断 | Task 6 |
| 局域网确认、远端画布、断线恢复 | Task 4、Task 5、Task 11 |
| 本地 HTTPS 与安全上下文 | Task 7 |
| Codex ChatGPT 身份，不使用 API key | Task 8、Task 9、Task 11 |
| 实验特性和 schema 漂移证据 | Task 9 |
| 20 次会话、首音频 P50/P95 | Task 9、Task 11 |
| 三项结果不能互相掩盖 | Task 10 |
| 任一失败即停止，不偷换模型 | Task 10、Task 11 |
