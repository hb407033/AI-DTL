# AI 学科心智学习系统阶段 1 单挑战机器原型（Mac 侧内核）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Mac 侧用 TypeScript 建成通用学习内核、数学插件薄切片、脚本回放与家长接管两种桥接和本地落盘，使 `2.4 × 0.3` 一条主路径能在无 iPad、无 Codex 的条件下被确定性测试和家长端驱动跑通。

**Architecture:** 通用内核（状态机、事件日志、提示预算、提案校验、桥接接口、插件契约）与数学插件分包，内核源码不得出现学科字面量；`apps/agent-host` 是 Mac mini 宿主，提供儿童端 WebSocket 网关、家长控制台与 SQLite 落盘。状态机直接实现设计稿 v0.4 第 5.0 节完整转换表，阶段 1 只有部分转换可达；`MEMORY_PENDING`、`CONTESTED` 的记忆路径与断线自动恢复留给阶段 2。

**Tech Stack:** Node.js 22（内置 `node:sqlite`，不新增依赖）、pnpm 11、TypeScript 7（`strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`）、zod 4、Fastify 5 + @fastify/websocket、vitest 5、tsx。

**Spec:** `docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md`（v0.4）。执行者必须同时读第 5、9.1.1、10、13、14.6、15.1–15.3 节。

## Global Constraints

- 阶段 1 范围（设计稿 14.6 第 2 条）：只实现 `2.4 × 0.3` 一条主路径、`ParentCoachBridge`/`ScriptedReplayBridge`、事件落盘；直接使用 5.0 完整状态表；暂不生成长期假设，不承诺断线自动恢复。**iPad 儿童端界面不在本计划内**（另立计划，等设备就绪）。
- 通用内核源码（`packages/learning-kernel/src`）出现 `math`、`literature`、`decimal`、`数学`、`文学`、`小数` 字面量即视为契约测试失败（设计稿 14.5）；数学内容只能在 `packages/plugin-math` 与测试夹具里。
- 未列出的教学转换默认拒绝并记录策略错误；`HELP_REQUEST`、`PAUSE_REQUEST`、`CONTEST` 在任何活动状态必须被接受（5.0 元规则）。
- 提示预算由内核强制：软预算 2 次升级、硬预算 4 级 / 4 次升级；每次只能升一级；升级前必须有孩子新产出；4 级前必须有过实质性尝试（5.4）。
- `assisted_round` 为真时禁止任何记忆候选（5.6、10.7）。
- 转写 `unconfirmed` 的语音只能作临时原始事件，不参与证据计数（13）。
- 同一 `event_id` 重放只返回原结果；`client_seq` 缺口要求从 `last_confirmed_seq + 1` 重放（10.2）。
- 只有 `GrowthLedgerService` 能写长期记录；阶段 1 不实现它，因此任何提案的 `memoryCandidate` 只记录、不落成长表。
- Codex 协议字段不得出现在内核、插件和契约包里（4.3）；本计划不含 `CodexRealtimeBridge`（门禁 BLOCKED，待用户裁决）。
- 家庭局域网明文 `http/ws`，无 TLS、配对、令牌；宿主监听 `0.0.0.0:8788`（与阶段 0 网关 8787 并存）。
- 本地数据目录默认 `~/.ai-scholar/`（环境变量 `AI_SCHOLAR_DATA_DIR` 覆盖），不入库；测试用内存库或临时目录。
- TypeScript 细节：所有可选字段声明为 `?: T | undefined`（`exactOptionalPropertyTypes`）；数组取值先判空（`noUncheckedIndexedAccess`）；包内相对导入带 `.js` 后缀。
- 一律中文注释与 commit message；每个 commit 结尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`；只在 `feat/phase-0-native-ipad-gates` 分支提交（用户未要求换分支）。

---

## 0. 文件结构

```text
packages/
├── session-contracts/            # 儿童端 ⇄ 宿主 会话协议与教学提案契约（zod + JSON 夹具，将来 Swift 端共用）
│   ├── package.json  tsconfig.json
│   ├── src/index.ts
│   ├── src/evidence-event.ts     # EvidenceEvent 与 15 种事件负载
│   ├── src/teaching-proposal.ts  # TeachingProposal、语义对象、画布动作
│   ├── src/child-protocol.ts     # WebSocket 帧：client event / ack / nack / outbound
│   ├── fixtures/session-protocol-v1.json
│   └── test/contracts.test.ts
├── learning-kernel/              # 通用学习内核（无学科字面量）
│   ├── package.json  tsconfig.json
│   ├── src/index.ts
│   ├── src/session-state.ts      # 状态、信号、上下文、5.0 转换表
│   ├── src/hint-budget.ts        # 软/硬预算与升级裁定
│   ├── src/event-log.ts          # 幂等事件日志与内容哈希
│   ├── src/challenge.ts          # LearningChallenge、DisciplineEvidence、ChallengeInput
│   ├── src/plugin.ts             # DisciplinePlugin 接口与注册表
│   ├── src/proposal-validator.ts # 本地校验器
│   ├── src/bridge.ts             # RealtimeBridge 接口与 TurnContext
│   ├── src/bridges/scripted-replay-bridge.ts
│   ├── src/bridges/parent-coach-bridge.ts
│   ├── src/store.ts              # SessionStore 接口、内存实现、快照策略
│   ├── src/sqlite-store.ts       # node:sqlite 实现
│   ├── src/orchestrator.ts       # 会话编排器
│   ├── src/testing/plugin-contract.ts  # 插件契约检查（所有插件共用）
│   └── test/*.test.ts
├── plugin-math/                  # 数学心智插件：小数乘法薄切片
│   ├── package.json  tsconfig.json
│   ├── src/index.ts
│   ├── src/decimal-multiplication.ts
│   └── test/plugin-math.test.ts
apps/
└── agent-host/                   # Mac mini 宿主
    ├── package.json  tsconfig.json
    ├── src/session-gateway.ts    # ws 帧 → 事件；ack/nack 纯函数
    ├── src/server.ts             # Fastify：/healthz /session /parent/*
    ├── src/parent-console.html   # 家长控制台（单文件，无构建）
    ├── src/replay-cli.ts         # 脚本回放命令行
    ├── fixtures/scripted-happy-path.json
    └── test/*.test.ts
```

`pnpm-workspace.yaml` 的 `packages` 增加 `apps/agent-host`（`packages/*` 已覆盖三个新包）。

---

## Task 1：会话契约包

**Files:**
- Create: `packages/session-contracts/package.json`
- Create: `packages/session-contracts/tsconfig.json`
- Create: `packages/session-contracts/src/index.ts`
- Create: `packages/session-contracts/src/evidence-event.ts`
- Create: `packages/session-contracts/src/teaching-proposal.ts`
- Create: `packages/session-contracts/src/child-protocol.ts`
- Create: `packages/session-contracts/fixtures/session-protocol-v1.json`
- Test: `packages/session-contracts/test/contracts.test.ts`

**Interfaces:**
- Produces: `EvidenceEvent`、`EventPayload`、`EventType`、`TeachingProposal`、`CanvasAction`、`SemanticObject`、`ChildOutbound`、`ClientFrame`、`ServerFrame`，以及同名 zod schema（`evidenceEventSchema`、`teachingProposalSchema`、`childOutboundSchema`、`clientFrameSchema`、`serverFrameSchema`）。

- [ ] **Step 1：写失败的契约测试**

```ts
// packages/session-contracts/test/contracts.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  childOutboundSchema, clientFrameSchema, evidenceEventSchema, serverFrameSchema, teachingProposalSchema,
} from "../src/index.js";

// 夹具是儿童端（将来 Swift）与宿主共用的协议样例；两端都必须能原样解析
const fixture = JSON.parse(readFileSync(new URL("../fixtures/session-protocol-v1.json", import.meta.url), "utf8")) as {
  events: unknown[]; proposals: unknown[]; outbound: unknown[]; clientFrames: unknown[]; serverFrames: unknown[];
};

describe("会话契约夹具", () => {
  test("夹具覆盖全部 15 种事件类型且都能解析", () => {
    const types = new Set(fixture.events.map((e) => evidenceEventSchema.parse(e).payload.type));
    expect([...types].sort()).toEqual([
      "ANSWER", "CONFIRM_TRANSCRIPT", "CONTEST", "DONE", "DRAG", "ERASE", "EXPLAIN", "HELP_REQUEST",
      "MEMORY_ASSENT", "PAUSE_REQUEST", "RESUME_REQUEST", "SELECT", "SOFT_LANDING_CHOICE", "STROKE", "UTTERANCE",
    ]);
  });
  test("教学提案、儿童端出站消息、两向帧都能解析", () => {
    for (const p of fixture.proposals) expect(teachingProposalSchema.parse(p).proposalId).toBeTruthy();
    for (const m of fixture.outbound) expect(childOutboundSchema.parse(m).type).toBeTruthy();
    for (const f of fixture.clientFrames) expect(clientFrameSchema.parse(f).type).toBe("event");
    for (const f of fixture.serverFrames) expect(serverFrameSchema.parse(f).protocolVersion).toBe(1);
  });
  test("拒绝越界提示级别与非 agent 所有权的画布对象", () => {
    expect(() => teachingProposalSchema.parse({ proposalId: "p", spokenResponse: "", learnerTask: "t", hintLevel: 6 })).toThrowError();
    expect(() => teachingProposalSchema.parse({
      proposalId: "p", spokenResponse: "", learnerTask: "t", hintLevel: 1,
      canvasActions: [{ kind: "upsertObject", object: { id: "o", owner: "child", kind: "label" } }],
    })).toThrowError();
  });
  test("事件的 clientSeq 必须是正整数", () => {
    const bad = { ...(fixture.events[0] as object), clientSeq: 0 };
    expect(() => evidenceEventSchema.parse(bad)).toThrowError();
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/session-contracts test`
Expected: 失败，`Cannot find package` / 找不到 `../src/index.js`。

- [ ] **Step 3：写包清单与契约实现**

```json
// packages/session-contracts/package.json
{
  "name": "@ai-scholar/session-contracts",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^4.5.4" }
}
```

```json
// packages/session-contracts/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*.ts", "test/**/*.ts"] }
```

```ts
// packages/session-contracts/src/evidence-event.ts
// 证据事件契约（设计稿 10.2）：儿童端产生、宿主确认。payload 按 type 区分；
// quality 表示转写/识别的离散质量，只有 confirmed/corrected 才能参与证据计数。
import { z } from "zod";

export const SESSION_PROTOCOL_VERSION = 1 as const;

export const evidenceQualitySchema = z.enum(["unconfirmed", "confirmed", "corrected"]);
export const evidenceSourceSchema = z.enum(["child_touch", "child_voice", "child_button", "parent_button", "system"]);
const point = z.object({ x: z.number(), y: z.number() });

export const eventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("UTTERANCE"), text: z.string() }),
  // 高频触控点在客户端先聚合成一条语义笔画；contentHash 用于识别“擦掉后重画相同内容”
  z.object({
    type: z.literal("STROKE"), strokeId: z.string().min(1), contentHash: z.string().min(1),
    bounds: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }),
  }),
  z.object({ type: z.literal("SELECT"), objectId: z.string().min(1) }),
  z.object({ type: z.literal("DRAG"), objectId: z.string().min(1), to: point }),
  z.object({ type: z.literal("ERASE"), strokeId: z.string().min(1), contentHash: z.string().min(1) }),
  z.object({ type: z.literal("ANSWER"), text: z.string() }),
  z.object({ type: z.literal("EXPLAIN"), text: z.string() }),
  z.object({ type: z.literal("HELP_REQUEST") }),
  z.object({ type: z.literal("PAUSE_REQUEST"), by: z.enum(["child", "parent"]) }),
  z.object({ type: z.literal("RESUME_REQUEST") }),
  z.object({ type: z.literal("CONTEST"), targetId: z.string().optional() }),
  z.object({ type: z.literal("DONE") }),
  z.object({ type: z.literal("CONFIRM_TRANSCRIPT"), targetEventId: z.string().min(1), confirmed: z.boolean(), correctedText: z.string().optional() }),
  z.object({ type: z.literal("SOFT_LANDING_CHOICE"), choice: z.enum(["simpler", "hint", "stop"]) }),
  z.object({ type: z.literal("MEMORY_ASSENT"), choice: z.enum(["record", "unsure", "disagree"]) }),
]);

export const evidenceEventSchema = z.object({
  eventId: z.string().min(1),
  clientSessionId: z.string().min(1),
  deviceId: z.string().min(1),
  clientSeq: z.number().int().positive(),
  occurredAt: z.number().int().nonnegative(),
  quality: evidenceQualitySchema,
  source: evidenceSourceSchema,
  semanticObjectIds: z.array(z.string()).default([]),
  artifactVersion: z.string().optional(),
  payload: eventPayloadSchema,
});

export type EvidenceEvent = z.infer<typeof evidenceEventSchema>;
export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type EventType = EventPayload["type"];
export type EvidenceQuality = z.infer<typeof evidenceQualitySchema>;
```

```ts
// packages/session-contracts/src/teaching-proposal.ts
// 教学提案契约（设计稿 10.3）：三种桥接实现都只能输出这一种结构；本地校验器通过后才会呈现给孩子。
import { z } from "zod";

const point = z.object({ x: z.number(), y: z.number() });

// 语义对象的 kind 由学科插件定义，内核只认 id 与 owner；Agent 只能创建 owner 为 agent 的对象
export const semanticObjectSchema = z.object({
  id: z.string().min(1),
  owner: z.literal("agent"),
  kind: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
});

export const canvasActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsertObject"), object: semanticObjectSchema }),
  z.object({ kind: z.literal("highlight"), objectId: z.string().min(1) }),
  z.object({ kind: z.literal("point"), at: point }),
  z.object({ kind: z.literal("removeObject"), objectId: z.string().min(1) }),
]);

export const hintLevelSchema = z.number().int().min(0).max(5);

export const teachingProposalSchema = z.object({
  proposalId: z.string().min(1),
  spokenResponse: z.string(),
  canvasActions: z.array(canvasActionSchema).default([]),
  learnerTask: z.string().min(1),
  expectedEvidence: z.array(z.string()).default([]),
  hintLevel: hintLevelSchema,
  memoryCandidate: z.object({ description: z.string().min(1), evidenceEventIds: z.array(z.string()) }).optional(),
});

export type SemanticObject = z.infer<typeof semanticObjectSchema>;
export type CanvasAction = z.infer<typeof canvasActionSchema>;
export type TeachingProposal = z.infer<typeof teachingProposalSchema>;
```

```ts
// packages/session-contracts/src/child-protocol.ts
// 儿童端 ⇄ 宿主 的 WebSocket 帧。客户端帧携带幂等 id 与会话内单调 clientSeq（沿用阶段 0 探针协议语义）；
// 宿主对每帧回 ack 或 nack，教学输出以 outbound 帧推送。儿童端只会看到这些字段，绝不包含模型内部信息。
import { z } from "zod";
import { SESSION_PROTOCOL_VERSION, evidenceEventSchema } from "./evidence-event.js";
import { canvasActionSchema, hintLevelSchema } from "./teaching-proposal.js";

const envelope = { protocolVersion: z.literal(SESSION_PROTOCOL_VERSION) };

export const clientFrameSchema = z.object({
  ...envelope,
  type: z.literal("event"),
  id: z.string().min(1),
  clientSeq: z.number().int().positive(),
  sessionId: z.string().min(1),
  sentAt: z.number().int().nonnegative(),
  event: evidenceEventSchema,
});

export const childOutboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("speak"), id: z.string().min(1), text: z.string(), hintLevel: hintLevelSchema, interruptible: z.literal(true) }),
  z.object({ type: z.literal("canvasAction"), id: z.string().min(1), action: canvasActionSchema }),
  z.object({ type: z.literal("learnerTask"), id: z.string().min(1), text: z.string().min(1) }),
  z.object({ type: z.literal("stateChanged"), id: z.string().min(1), state: z.string().min(1), hintLevel: hintLevelSchema, presence: z.enum(["listening", "waiting", "paused"]) }),
  z.object({ type: z.literal("confirmTranscript"), id: z.string().min(1), targetEventId: z.string().min(1), text: z.string() }),
  z.object({ type: z.literal("softLanding"), id: z.string().min(1), message: z.string(), options: z.array(z.enum(["simpler", "hint", "stop"])) }),
  z.object({ type: z.literal("notice"), id: z.string().min(1), text: z.string() }),
]);

export const serverFrameSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("ack"), id: z.string().min(1), clientSeq: z.number().int().positive(), serverReceivedAt: z.number().int().nonnegative() }),
  z.object({ ...envelope, type: z.literal("nack"), reason: z.enum(["seqGap", "payloadConflict"]), expectedSeq: z.number().int().positive() }),
  z.object({ ...envelope, type: z.literal("outbound"), message: childOutboundSchema }),
  z.object({ ...envelope, type: z.literal("error"), reason: z.string().min(1), id: z.string().optional() }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;
export type ChildOutbound = z.infer<typeof childOutboundSchema>;
export type ServerFrame = z.infer<typeof serverFrameSchema>;
```

```ts
// packages/session-contracts/src/index.ts
// 会话契约包出口：证据事件、教学提案、儿童端协议。iPad 端 Swift 将按 fixtures 同步这些形状。
export * from "./evidence-event.js";
export * from "./teaching-proposal.js";
export * from "./child-protocol.js";
```

- [ ] **Step 4：写夹具**

```json
// packages/session-contracts/fixtures/session-protocol-v1.json
{
  "schemaVersion": 1,
  "events": [
    { "eventId": "e-1", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 1, "occurredAt": 1757200000000, "quality": "confirmed", "source": "child_voice", "payload": { "type": "UTTERANCE", "text": "我觉得会比 2.4 小" } },
    { "eventId": "e-2", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 2, "occurredAt": 1757200001000, "quality": "confirmed", "source": "child_touch", "payload": { "type": "STROKE", "strokeId": "st-1", "contentHash": "h1", "bounds": { "x": 10, "y": 10, "width": 100, "height": 40 } } },
    { "eventId": "e-3", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 3, "occurredAt": 1757200002000, "quality": "confirmed", "source": "child_touch", "payload": { "type": "SELECT", "objectId": "bar-1" } },
    { "eventId": "e-4", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 4, "occurredAt": 1757200003000, "quality": "confirmed", "source": "child_touch", "payload": { "type": "DRAG", "objectId": "label-1", "to": { "x": 50, "y": 60 } } },
    { "eventId": "e-5", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 5, "occurredAt": 1757200004000, "quality": "confirmed", "source": "child_touch", "payload": { "type": "ERASE", "strokeId": "st-1", "contentHash": "h1" } },
    { "eventId": "e-6", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 6, "occurredAt": 1757200005000, "quality": "confirmed", "source": "child_voice", "payload": { "type": "ANSWER", "text": "0.72" } },
    { "eventId": "e-7", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 7, "occurredAt": 1757200006000, "quality": "corrected", "source": "child_voice", "payload": { "type": "EXPLAIN", "text": "0.3 是十分之三，所以结果比 2.4 小" } },
    { "eventId": "e-8", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 8, "occurredAt": 1757200007000, "quality": "confirmed", "source": "child_button", "payload": { "type": "HELP_REQUEST" } },
    { "eventId": "e-9", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 9, "occurredAt": 1757200008000, "quality": "confirmed", "source": "child_button", "payload": { "type": "PAUSE_REQUEST", "by": "child" } },
    { "eventId": "e-10", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 10, "occurredAt": 1757200009000, "quality": "confirmed", "source": "child_button", "payload": { "type": "RESUME_REQUEST" } },
    { "eventId": "e-11", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 11, "occurredAt": 1757200010000, "quality": "confirmed", "source": "child_button", "payload": { "type": "CONTEST", "targetId": "p-3" } },
    { "eventId": "e-12", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 12, "occurredAt": 1757200011000, "quality": "confirmed", "source": "child_button", "payload": { "type": "DONE" } },
    { "eventId": "e-13", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 13, "occurredAt": 1757200012000, "quality": "confirmed", "source": "child_button", "payload": { "type": "CONFIRM_TRANSCRIPT", "targetEventId": "e-1", "confirmed": true } },
    { "eventId": "e-14", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 14, "occurredAt": 1757200013000, "quality": "confirmed", "source": "child_button", "payload": { "type": "SOFT_LANDING_CHOICE", "choice": "simpler" } },
    { "eventId": "e-15", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 15, "occurredAt": 1757200014000, "quality": "confirmed", "source": "child_button", "payload": { "type": "MEMORY_ASSENT", "choice": "unsure" } }
  ],
  "proposals": [
    { "proposalId": "p-1", "spokenResponse": "你现在已经确定了什么？", "learnerTask": "说说你确定的部分", "hintLevel": 1 },
    { "proposalId": "p-2", "spokenResponse": "这是一个空的十等份长条。", "learnerTask": "在长条上标出 0.3", "hintLevel": 3, "expectedEvidence": ["tenths_meaning"], "canvasActions": [ { "kind": "upsertObject", "object": { "id": "bar-1", "owner": "agent", "kind": "tenthsBar", "props": { "filled": 0 } } } ] }
  ],
  "outbound": [
    { "type": "speak", "id": "o-1", "text": "你现在已经确定了什么？", "hintLevel": 1, "interruptible": true },
    { "type": "canvasAction", "id": "o-2", "action": { "kind": "highlight", "objectId": "bar-1" } },
    { "type": "learnerTask", "id": "o-3", "text": "在长条上标出 0.3" },
    { "type": "stateChanged", "id": "o-4", "state": "INDEPENDENT", "hintLevel": 0, "presence": "listening" },
    { "type": "confirmTranscript", "id": "o-5", "targetEventId": "e-1", "text": "我觉得会比 2.4 小" },
    { "type": "softLanding", "id": "o-6", "message": "这是在试，不是考试。", "options": ["simpler", "hint", "stop"] },
    { "type": "notice", "id": "o-7", "text": "等我一下。" }
  ],
  "clientFrames": [
    { "protocolVersion": 1, "type": "event", "id": "f-1", "clientSeq": 1, "sessionId": "s-1", "sentAt": 1757200000000, "event": { "eventId": "e-1", "clientSessionId": "s-1", "deviceId": "ipad-1", "clientSeq": 1, "occurredAt": 1757200000000, "quality": "confirmed", "source": "child_button", "payload": { "type": "DONE" } } }
  ],
  "serverFrames": [
    { "protocolVersion": 1, "type": "ack", "id": "f-1", "clientSeq": 1, "serverReceivedAt": 1757200000050 },
    { "protocolVersion": 1, "type": "nack", "reason": "seqGap", "expectedSeq": 2 },
    { "protocolVersion": 1, "type": "outbound", "message": { "type": "notice", "id": "o-7", "text": "等我一下。" } },
    { "protocolVersion": 1, "type": "error", "reason": "invalidJson" }
  ]
}
```

- [ ] **Step 5：安装并跑测试**

Run: `pnpm install && pnpm --filter @ai-scholar/session-contracts test && pnpm --filter @ai-scholar/session-contracts typecheck`
Expected: 4 个测试 PASS，typecheck 无错误。

- [ ] **Step 6：提交**

```bash
git add packages/session-contracts pnpm-lock.yaml
git commit -m "建立儿童端会话契约包：证据事件、教学提案与协议帧

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 2：内核骨架与 5.0 状态转换表

**Files:**
- Create: `packages/learning-kernel/package.json`
- Create: `packages/learning-kernel/tsconfig.json`
- Create: `packages/learning-kernel/src/index.ts`
- Create: `packages/learning-kernel/src/session-state.ts`
- Test: `packages/learning-kernel/test/session-state.test.ts`

**Interfaces:**
- Produces: `SessionState`、`ACTIVE_STATES`、`Signal`、`SessionContext`、`KernelAction`、`PolicyError`、`createSessionContext()`、`transition(ctx, signal): TransitionResult`。
- 约定：进入 `WAITING_CONFIRMATION`、`PAUSED_TECH`、`PAUSED_CHILD` 时把当前状态存进 `priorState`；回到“原活动状态”即回到 `priorState`。

- [ ] **Step 1：写失败的转换表测试**

```ts
// packages/learning-kernel/test/session-state.test.ts
import { describe, expect, test } from "vitest";
import { ACTIVE_STATES, createSessionContext, transition, type SessionState, type Signal } from "../src/session-state.js";

function at(state: SessionState, patch: Partial<ReturnType<typeof createSessionContext>> = {}) {
  return { ...createSessionContext(), state, ...patch };
}

// 设计稿 5.0 表逐行对照：[起始状态, 信号, 目标状态]
const legal: Array<[SessionState, Signal, SessionState]> = [
  ["PREPARING", { kind: "challengeValidated" }, "INDEPENDENT"],
  ["PREPARING", { kind: "curriculumInsufficient" }, "WAITING_PARENT"],
  ["INDEPENDENT", { kind: "childOutput", isNewStrategy: true }, "INDEPENDENT"],
  ["INDEPENDENT", { kind: "windowExpired" }, "ASSESSING"],
  ["INDEPENDENT", { kind: "childDone" }, "EXPLAIN_BACK"],
  ["INDEPENDENT", { kind: "hardCapReached" }, "ASSESSING"],
  ["ASSESSING", { kind: "assessedRecoverable" }, "INTERVENING"],
  ["ASSESSING", { kind: "assessedIndependentSolution" }, "EXPLAIN_BACK"],
  ["ASSESSING", { kind: "assessedBudgetExhausted" }, "SOFT_LANDING"],
  ["INTERVENING", { kind: "childOutput", isNewStrategy: true }, "INDEPENDENT"],
  ["INTERVENING", { kind: "noNewOutputWillingToContinue" }, "ASSESSING"],
  ["INTERVENING", { kind: "demoIssued" }, "RECONSTRUCT"],
  ["INTERVENING", { kind: "budgetExhausted" }, "SOFT_LANDING"],
  ["RECONSTRUCT", { kind: "reconstructDone" }, "EXPLAIN_BACK"],
  ["RECONSTRUCT", { kind: "reconstructStuck" }, "SOFT_LANDING"],
  ["EXPLAIN_BACK", { kind: "explainBackPassed" }, "TRANSFER"],
  ["EXPLAIN_BACK", { kind: "explainBackRevealedGap" }, "ASSESSING"],
  ["TRANSFER", { kind: "transferSucceeded", hasMemoryCandidate: true }, "MEMORY_PENDING"],
  ["TRANSFER", { kind: "transferSucceeded", hasMemoryCandidate: false }, "COMPLETED"],
  ["TRANSFER", { kind: "transferFailed" }, "SOFT_LANDING"],
  ["MEMORY_PENDING", { kind: "memoryAssent", choice: "record" }, "COMPLETED"],
  ["MEMORY_PENDING", { kind: "memoryAssent", choice: "unsure" }, "COMPLETED"],
  ["MEMORY_PENDING", { kind: "memoryAssent", choice: "disagree" }, "CONTESTED"],
  ["SOFT_LANDING", { kind: "softLandingChoice", choice: "simpler" }, "PREPARING"],
  ["SOFT_LANDING", { kind: "softLandingChoice", choice: "hint" }, "INTERVENING"],
  ["SOFT_LANDING", { kind: "softLandingChoice", choice: "stop" }, "COMPLETED"],
  ["WAITING_PARENT", { kind: "parentConfirmedMaterial" }, "PREPARING"],
  ["CONTESTED", { kind: "contestNewTask" }, "PREPARING"],
  ["CONTESTED", { kind: "contestVerificationDone", hasCandidate: true }, "MEMORY_PENDING"],
  ["CONTESTED", { kind: "contestVerificationDone", hasCandidate: false }, "COMPLETED"],
  ["COMPLETED", { kind: "nextChallenge" }, "PREPARING"],
];

describe("5.0 转换表：合法转换", () => {
  for (const [from, signal, to] of legal) {
    test(`${from} + ${signal.kind} → ${to}`, () => {
      const r = transition(at(from, { substantiveAttempts: 1 }), signal);
      expect(r.ok).toBe(true);
      expect(r.context.state).toBe(to);
    });
  }

  test("PREPARING → INDEPENDENT 创建检查点并把提示级别归零", () => {
    const r = transition(at("PREPARING", { hintLevel: 3 }), { kind: "challengeValidated" });
    expect(r.actions).toEqual(["createCheckpoint", "resetHintLevel"]);
    expect(r.context.hintLevel).toBe(0);
  });

  test("INTERVENING 收到新产出：撤去提示，级别回 0，但历史最高级别保留", () => {
    const r = transition(at("INTERVENING", { hintLevel: 2, maxHintLevelUsed: 2 }), { kind: "childOutput", isNewStrategy: true });
    expect(r.context).toMatchObject({ state: "INDEPENDENT", hintLevel: 0, maxHintLevelUsed: 2, newOutputSinceLastHint: true, substantiveAttempts: 1 });
    expect(r.actions).toContain("withdrawHint");
  });

  test("INDEPENDENT 的非新策略产出留在原状态且不产生动作", () => {
    const r = transition(at("INDEPENDENT"), { kind: "childOutput", isNewStrategy: false });
    expect(r.ok).toBe(true);
    expect(r.context.state).toBe("INDEPENDENT");
    expect(r.actions).toEqual([]);
  });

  test("软着陆出口置位 assisted_round，COMPLETED → PREPARING 清零", () => {
    const soft = transition(at("SOFT_LANDING"), { kind: "softLandingChoice", choice: "simpler" });
    expect(soft.context.assistedRound).toBe(true);
    const next = transition(at("COMPLETED", { assistedRound: true, hintLevel: 2 }), { kind: "nextChallenge" });
    expect(next.context).toMatchObject({ assistedRound: false, hintLevel: 0 });
  });

  test("硬预算耗尽进入 SOFT_LANDING 同样置位 assisted_round", () => {
    const r = transition(at("INTERVENING"), { kind: "budgetExhausted" });
    expect(r.context).toMatchObject({ state: "SOFT_LANDING", assistedRound: true });
  });
});

describe("5.0 元规则：儿童控制权事件在任意活动状态必须被接受", () => {
  for (const state of ACTIVE_STATES) {
    test(`${state} 接受 pauseRequest / helpRequest / contest`, () => {
      const paused = transition(at(state), { kind: "pauseRequest" });
      expect(paused.ok).toBe(true);
      expect(paused.context).toMatchObject({ state: "PAUSED_CHILD", priorState: state });

      const help = transition(at(state), { kind: "helpRequest" });
      expect(help.ok).toBe(true);
      expect(help.context.state).toBe("ASSESSING");
      expect(help.context.helpRequestedSinceLastHint).toBe(true);

      const contest = transition(at(state), { kind: "contest", targetId: "p-9" });
      expect(contest.ok).toBe(true);
      expect(contest.context.state).toBe(state);
      expect(contest.context.frozenTargetIds).toEqual(["p-9"]);
      expect(contest.actions).toEqual(["stopDiagnosticQuestions", "freezeTeaching", "askWhereDiffers"]);
    });
  }

  test("暂停后继续回到原活动状态且不继承可见提示", () => {
    const paused = transition(at("EXPLAIN_BACK", { hintLevel: 2 }), { kind: "pauseRequest" });
    const resumed = transition(paused.context, { kind: "resume" });
    expect(resumed.context).toMatchObject({ state: "EXPLAIN_BACK", priorState: null, hintLevel: 0 });
    expect(resumed.actions).toEqual(["restoreContextNoHint"]);
  });

  test("转写不确定进入 WAITING_CONFIRMATION，确认或超时都回原状态", () => {
    const waiting = transition(at("INDEPENDENT"), { kind: "transcriptUncertain" });
    expect(waiting.context).toMatchObject({ state: "WAITING_CONFIRMATION", priorState: "INDEPENDENT" });
    expect(transition(waiting.context, { kind: "transcriptConfirmed" }).context.state).toBe("INDEPENDENT");
    const timeout = transition(waiting.context, { kind: "confirmationTimeout" });
    expect(timeout.context.state).toBe("INDEPENDENT");
    expect(timeout.actions).toEqual(["keepUnconfirmed"]);
  });

  test("技术中断：检查点一致回原状态，不一致回 PREPARING", () => {
    const paused = transition(at("TRANSFER"), { kind: "techInterrupted" });
    expect(paused.context.state).toBe("PAUSED_TECH");
    expect(transition(paused.context, { kind: "techRecovered", checkpointConsistent: true }).context.state).toBe("TRANSFER");
    const restart = transition(paused.context, { kind: "techRecovered", checkpointConsistent: false });
    expect(restart.context.state).toBe("PREPARING");
    expect(restart.actions).toEqual(["restartFromSnapshot"]);
  });
});

describe("未列出的转换默认拒绝并记录策略错误", () => {
  test("COMPLETED 收到孩子产出被拒绝，状态不变", () => {
    const r = transition(at("COMPLETED"), { kind: "childOutput", isNewStrategy: true });
    expect(r.ok).toBe(false);
    expect(r.context.state).toBe("COMPLETED");
    expect(r.context.policyErrors).toEqual([{ code: "unlistedTransition", from: "COMPLETED", signal: "childOutput" }]);
  });

  test("PAUSED_CHILD 不接受求助（非活动状态，先继续再说）", () => {
    const r = transition(at("PAUSED_CHILD", { priorState: "INDEPENDENT" }), { kind: "helpRequest" });
    expect(r.ok).toBe(false);
  });

  test("演示前必须有过实质性尝试", () => {
    const r = transition(at("INTERVENING", { substantiveAttempts: 0 }), { kind: "demoIssued" });
    expect(r.ok).toBe(false);
    expect(r.context.policyErrors[0]?.code).toBe("guardFailed");
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/learning-kernel test`
Expected: 失败，找不到 `../src/session-state.js`。

- [ ] **Step 3：写包清单与状态机实现**

```json
// packages/learning-kernel/package.json
{
  "name": "@ai-scholar/learning-kernel",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@ai-scholar/session-contracts": "workspace:*", "zod": "^4.5.4" }
}
```

```json
// packages/learning-kernel/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*.ts", "test/**/*.ts"] }
```

```ts
// packages/learning-kernel/src/session-state.ts
// 学习会话状态机：逐行实现设计稿 v0.4 第 5.0 节转换表。
// 元规则：教学转换未列出即拒绝并记策略错误；儿童控制权事件（求助/暂停/异议）在任何活动状态都必须被接受。
// 本文件只做状态与上下文的纯函数转换，不碰时钟、桥接和存储，便于把整张表当数据逐行测试。

export const SESSION_STATES = [
  "PREPARING", "INDEPENDENT", "ASSESSING", "INTERVENING", "RECONSTRUCT", "EXPLAIN_BACK", "TRANSFER",
  "MEMORY_PENDING", "COMPLETED", "SOFT_LANDING", "WAITING_PARENT", "WAITING_CONFIRMATION",
  "PAUSED_TECH", "PAUSED_CHILD", "CONTESTED",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** “活动状态”：儿童控制权事件在这些状态下不得被拒绝 */
export const ACTIVE_STATES: readonly SessionState[] = [
  "INDEPENDENT", "ASSESSING", "INTERVENING", "RECONSTRUCT", "EXPLAIN_BACK", "TRANSFER", "MEMORY_PENDING", "SOFT_LANDING", "CONTESTED",
];

export type Signal =
  | { kind: "challengeValidated" }
  | { kind: "curriculumInsufficient" }
  | { kind: "parentConfirmedMaterial" }
  | { kind: "childOutput"; isNewStrategy: boolean }
  | { kind: "childDone" }
  | { kind: "helpRequest" }
  | { kind: "pauseRequest" }
  | { kind: "resume" }
  | { kind: "contest"; targetId?: string | undefined }
  | { kind: "windowExpired" }
  | { kind: "hardCapReached" }
  | { kind: "assessedRecoverable" }
  | { kind: "assessedIndependentSolution" }
  | { kind: "assessedBudgetExhausted" }
  | { kind: "hintIssued"; level: number; liftsSoftBudget: boolean }
  | { kind: "demoIssued" }
  | { kind: "noNewOutputWillingToContinue" }
  | { kind: "budgetExhausted" }
  | { kind: "reconstructDone" }
  | { kind: "reconstructStuck" }
  | { kind: "explainBackPassed" }
  | { kind: "explainBackRevealedGap" }
  | { kind: "transferSucceeded"; hasMemoryCandidate: boolean }
  | { kind: "transferFailed" }
  | { kind: "memoryAssent"; choice: "record" | "unsure" | "disagree" }
  | { kind: "softLandingChoice"; choice: "simpler" | "hint" | "stop" }
  | { kind: "transcriptUncertain" }
  | { kind: "transcriptConfirmed" }
  | { kind: "confirmationTimeout" }
  | { kind: "techInterrupted" }
  | { kind: "techRecovered"; checkpointConsistent: boolean }
  | { kind: "contestNewTask" }
  | { kind: "contestVerificationDone"; hasCandidate: boolean }
  | { kind: "nextChallenge" };

export type KernelAction =
  | "createCheckpoint" | "resetHintLevel" | "freezeTeaching" | "summarizeEvidence" | "authorizeNextHint"
  | "requestExplainBack" | "withdrawHint" | "removeDemoRequireRebuild" | "enterAssistance" | "createTransferChallenge"
  | "previewMemory" | "saveArtifactOnly" | "commitGrowthRecord" | "keepCandidateTemporary" | "freezeAndPlanVerification"
  | "markAssistedHint" | "saveTempHypotheses" | "revalidateChallenge" | "holdUnconfirmedEvent" | "writeConfirmation"
  | "keepUnconfirmed" | "stopTimers" | "resumeFromCheckpoint" | "restartFromSnapshot" | "restoreContextNoHint"
  | "planDiscriminatingTask" | "stopDiagnosticQuestions" | "askWhereDiffers" | "clearAssisted" | "noInterventionEvidence"
  | "presenceOnly" | "checkUnderstanding";

export interface PolicyError {
  code: "unlistedTransition" | "guardFailed";
  from: SessionState;
  signal: Signal["kind"];
}

export interface SessionContext {
  state: SessionState;
  /** 进入等待/暂停类状态前的活动状态，用于“回到原活动状态” */
  priorState: SessionState | null;
  hintLevel: number;
  maxHintLevelUsed: number;
  escalationCount: number;
  /** 软着陆之后的辅助轮：为真时任何能力记录都不得提交 */
  assistedRound: boolean;
  /** 超过软预算继续升级后置为 false，本轮不再计作独立成功 */
  independentSuccess: boolean;
  newOutputSinceLastHint: boolean;
  helpRequestedSinceLastHint: boolean;
  /** 孩子侧实质性尝试次数；4 级演示前必须 ≥ 1 */
  substantiveAttempts: number;
  /** 被异议冻结的提案或假设 id */
  frozenTargetIds: string[];
  policyErrors: PolicyError[];
}

export function createSessionContext(): SessionContext {
  return {
    state: "PREPARING", priorState: null, hintLevel: 0, maxHintLevelUsed: 0, escalationCount: 0,
    assistedRound: false, independentSuccess: true, newOutputSinceLastHint: true, helpRequestedSinceLastHint: false,
    substantiveAttempts: 0, frozenTargetIds: [], policyErrors: [],
  };
}

export type TransitionResult =
  | { ok: true; context: SessionContext; actions: KernelAction[] }
  | { ok: false; context: SessionContext; actions: []; error: PolicyError };

type Target = SessionState | "SAME" | "PRIOR";

interface Rule {
  from: SessionState | "ANY_ACTIVE";
  signal: Signal["kind"];
  guard?: (ctx: SessionContext, signal: Signal) => boolean;
  to: Target | ((signal: Signal) => Target);
  actions: KernelAction[] | ((signal: Signal) => KernelAction[]);
  update?: (ctx: SessionContext, signal: Signal) => Partial<SessionContext>;
}

const childOutputUpdate = (ctx: SessionContext): Partial<SessionContext> => ({
  newOutputSinceLastHint: true,
  substantiveAttempts: ctx.substantiveAttempts + 1,
});

// 顺序即优先级：先匹配具体状态行，再匹配“任意活动状态”通配行
const RULES: Rule[] = [
  { from: "PREPARING", signal: "challengeValidated", to: "INDEPENDENT", actions: ["createCheckpoint", "resetHintLevel"], update: () => ({ hintLevel: 0, escalationCount: 0, newOutputSinceLastHint: true, helpRequestedSinceLastHint: false }) },
  { from: "PREPARING", signal: "curriculumInsufficient", to: "WAITING_PARENT", actions: ["freezeTeaching"] },
  { from: "INDEPENDENT", signal: "childOutput", to: "SAME", actions: (s) => (s.kind === "childOutput" && s.isNewStrategy ? ["presenceOnly"] : []), update: (ctx, s) => (s.kind === "childOutput" && s.isNewStrategy ? childOutputUpdate(ctx) : {}) },
  { from: "INDEPENDENT", signal: "windowExpired", to: "ASSESSING", actions: ["summarizeEvidence"] },
  { from: "INDEPENDENT", signal: "hardCapReached", to: "ASSESSING", actions: ["summarizeEvidence"] },
  { from: "INDEPENDENT", signal: "childDone", to: "EXPLAIN_BACK", actions: ["noInterventionEvidence", "requestExplainBack"] },
  { from: "ASSESSING", signal: "helpRequest", to: "SAME", actions: ["summarizeEvidence"], update: () => ({ helpRequestedSinceLastHint: true }) },
  { from: "ASSESSING", signal: "assessedRecoverable", to: "INTERVENING", actions: ["authorizeNextHint"] },
  { from: "ASSESSING", signal: "assessedIndependentSolution", to: "EXPLAIN_BACK", actions: ["requestExplainBack"] },
  { from: "ASSESSING", signal: "assessedBudgetExhausted", to: "SOFT_LANDING", actions: ["enterAssistance"], update: () => ({ assistedRound: true }) },
  // 只有“新尝试”才撤提示回 0 级；擦除或重画相同内容不算
  { from: "INTERVENING", signal: "childOutput", to: (s) => (s.kind === "childOutput" && s.isNewStrategy ? "INDEPENDENT" : "SAME"), actions: (s) => (s.kind === "childOutput" && s.isNewStrategy ? ["withdrawHint", "resetHintLevel"] : []), update: (ctx, s) => (s.kind === "childOutput" && s.isNewStrategy ? { ...childOutputUpdate(ctx), hintLevel: 0 } : {}) },
  { from: "INTERVENING", signal: "hintIssued", to: "SAME", actions: [], update: (ctx, s) => s.kind === "hintIssued" ? ({
      hintLevel: s.level, maxHintLevelUsed: Math.max(ctx.maxHintLevelUsed, s.level), escalationCount: ctx.escalationCount + 1,
      newOutputSinceLastHint: false, helpRequestedSinceLastHint: false, independentSuccess: ctx.independentSuccess && !s.liftsSoftBudget,
    }) : {} },
  { from: "INTERVENING", signal: "noNewOutputWillingToContinue", to: "ASSESSING", actions: ["summarizeEvidence"] },
  { from: "INTERVENING", signal: "demoIssued", guard: (ctx) => ctx.substantiveAttempts >= 1, to: "RECONSTRUCT", actions: ["removeDemoRequireRebuild"] },
  { from: "INTERVENING", signal: "budgetExhausted", to: "SOFT_LANDING", actions: ["enterAssistance"], update: () => ({ assistedRound: true }) },
  { from: "RECONSTRUCT", signal: "childOutput", to: "SAME", actions: [], update: (ctx) => childOutputUpdate(ctx) },
  { from: "RECONSTRUCT", signal: "reconstructDone", to: "EXPLAIN_BACK", actions: ["checkUnderstanding"] },
  { from: "RECONSTRUCT", signal: "reconstructStuck", to: "SOFT_LANDING", actions: ["enterAssistance"], update: () => ({ assistedRound: true }) },
  { from: "EXPLAIN_BACK", signal: "childOutput", to: "SAME", actions: [], update: (ctx) => childOutputUpdate(ctx) },
  { from: "EXPLAIN_BACK", signal: "explainBackPassed", to: "TRANSFER", actions: ["createTransferChallenge", "resetHintLevel"], update: () => ({ hintLevel: 0 }) },
  { from: "EXPLAIN_BACK", signal: "explainBackRevealedGap", to: "ASSESSING", actions: ["saveTempHypotheses"] },
  { from: "TRANSFER", signal: "childOutput", to: "SAME", actions: [], update: (ctx) => childOutputUpdate(ctx) },
  { from: "TRANSFER", signal: "transferSucceeded", to: (s) => (s.kind === "transferSucceeded" && s.hasMemoryCandidate ? "MEMORY_PENDING" : "COMPLETED"), actions: (s) => (s.kind === "transferSucceeded" && s.hasMemoryCandidate ? ["previewMemory"] : ["saveArtifactOnly"]) },
  { from: "TRANSFER", signal: "transferFailed", to: "SOFT_LANDING", actions: ["enterAssistance"], update: () => ({ assistedRound: true }) },
  { from: "MEMORY_PENDING", signal: "memoryAssent", to: (s) => (s.kind === "memoryAssent" && s.choice === "disagree" ? "CONTESTED" : "COMPLETED"), actions: (s) => {
      if (s.kind !== "memoryAssent") return [];
      return s.choice === "record" ? ["commitGrowthRecord"] : s.choice === "unsure" ? ["keepCandidateTemporary"] : ["freezeAndPlanVerification"];
    } },
  { from: "SOFT_LANDING", signal: "softLandingChoice", to: (s) => (s.kind !== "softLandingChoice" ? "SAME" : s.choice === "simpler" ? "PREPARING" : s.choice === "hint" ? "INTERVENING" : "COMPLETED"), actions: (s) => (s.kind !== "softLandingChoice" ? [] : s.choice === "simpler" ? ["revalidateChallenge"] : s.choice === "hint" ? ["markAssistedHint"] : ["saveTempHypotheses"]), update: () => ({ assistedRound: true }) },
  { from: "WAITING_PARENT", signal: "parentConfirmedMaterial", to: "PREPARING", actions: ["revalidateChallenge"] },
  { from: "WAITING_CONFIRMATION", signal: "transcriptConfirmed", to: "PRIOR", actions: ["writeConfirmation"] },
  { from: "WAITING_CONFIRMATION", signal: "confirmationTimeout", to: "PRIOR", actions: ["keepUnconfirmed"] },
  { from: "PAUSED_TECH", signal: "techRecovered", to: (s) => (s.kind === "techRecovered" && s.checkpointConsistent ? "PRIOR" : "PREPARING"), actions: (s) => (s.kind === "techRecovered" && s.checkpointConsistent ? ["resumeFromCheckpoint"] : ["restartFromSnapshot"]) },
  { from: "PAUSED_CHILD", signal: "resume", to: "PRIOR", actions: ["restoreContextNoHint"], update: () => ({ hintLevel: 0 }) },
  { from: "CONTESTED", signal: "contestNewTask", to: "PREPARING", actions: ["planDiscriminatingTask"] },
  { from: "CONTESTED", signal: "contestVerificationDone", to: (s) => (s.kind === "contestVerificationDone" && s.hasCandidate ? "MEMORY_PENDING" : "COMPLETED"), actions: [] },
  { from: "COMPLETED", signal: "nextChallenge", to: "PREPARING", actions: ["clearAssisted", "resetHintLevel"], update: () => ({ assistedRound: false, hintLevel: 0, escalationCount: 0, independentSuccess: true, maxHintLevelUsed: 0, substantiveAttempts: 0 }) },
  // 儿童控制权与中断类通配行
  { from: "ANY_ACTIVE", signal: "pauseRequest", to: "PAUSED_CHILD", actions: ["createCheckpoint"] },
  { from: "ANY_ACTIVE", signal: "helpRequest", to: "ASSESSING", actions: ["summarizeEvidence"], update: () => ({ helpRequestedSinceLastHint: true }) },
  { from: "ANY_ACTIVE", signal: "contest", to: "SAME", actions: ["stopDiagnosticQuestions", "freezeTeaching", "askWhereDiffers"], update: (ctx, s) => ({ frozenTargetIds: s.kind === "contest" && s.targetId && !ctx.frozenTargetIds.includes(s.targetId) ? [...ctx.frozenTargetIds, s.targetId] : ctx.frozenTargetIds }) },
  { from: "ANY_ACTIVE", signal: "transcriptUncertain", to: "WAITING_CONFIRMATION", actions: ["holdUnconfirmedEvent"] },
  { from: "ANY_ACTIVE", signal: "techInterrupted", to: "PAUSED_TECH", actions: ["createCheckpoint", "stopTimers"] },
];

const PARKING_STATES: readonly SessionState[] = ["WAITING_CONFIRMATION", "PAUSED_TECH", "PAUSED_CHILD"];

export function transition(ctx: SessionContext, signal: Signal): TransitionResult {
  const isActive = ACTIVE_STATES.includes(ctx.state);
  const rule = RULES.find((r) => r.signal === signal.kind && (r.from === ctx.state || (r.from === "ANY_ACTIVE" && isActive)));
  if (!rule) return reject(ctx, { code: "unlistedTransition", from: ctx.state, signal: signal.kind });
  if (rule.guard && !rule.guard(ctx, signal)) return reject(ctx, { code: "guardFailed", from: ctx.state, signal: signal.kind });

  const target = typeof rule.to === "function" ? rule.to(signal) : rule.to;
  let nextState: SessionState;
  let priorState = ctx.priorState;
  if (target === "SAME") nextState = ctx.state;
  else if (target === "PRIOR") { nextState = ctx.priorState ?? "PREPARING"; priorState = null; }
  else { nextState = target; if (PARKING_STATES.includes(target)) priorState = ctx.state; else priorState = null; }

  const actions = typeof rule.actions === "function" ? rule.actions(signal) : rule.actions;
  const patch = rule.update ? rule.update(ctx, signal) : {};
  return { ok: true, context: { ...ctx, ...patch, state: nextState, priorState }, actions: [...actions] };
}

function reject(ctx: SessionContext, error: PolicyError): TransitionResult {
  return { ok: false, context: { ...ctx, policyErrors: [...ctx.policyErrors, error] }, actions: [], error };
}
```

```ts
// packages/learning-kernel/src/index.ts
// 通用学习内核出口。本包源码不得出现任何学科字面量（由 test/kernel-purity.test.ts 机械检查）。
export * from "./session-state.js";
```

- [ ] **Step 4：安装并跑测试**

Run: `pnpm install && pnpm --filter @ai-scholar/learning-kernel test && pnpm --filter @ai-scholar/learning-kernel typecheck`
Expected: 全部 PASS（31 行合法转换 + 元规则 + 拒绝用例）。

- [ ] **Step 5：提交**

```bash
git add packages/learning-kernel pnpm-lock.yaml
git commit -m "实现学习会话状态机：设计稿 5.0 完整转换表与儿童控制权元规则

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 3：提示预算与升级裁定

**Files:**
- Create: `packages/learning-kernel/src/hint-budget.ts`
- Modify: `packages/learning-kernel/src/index.ts`（加一行 `export * from "./hint-budget.js";`）
- Test: `packages/learning-kernel/test/hint-budget.test.ts`

**Interfaces:**
- Consumes: `SessionContext`（Task 2）。
- Produces: `InterventionBudget`、`KERNEL_BUDGET_CEILING`、`clampBudget(requested)`、`evaluateEscalation(ctx, requestedLevel, budget, options?)`、`EscalationVerdict`。

- [ ] **Step 1：写失败测试**

```ts
// packages/learning-kernel/test/hint-budget.test.ts
import { describe, expect, test } from "vitest";
import { KERNEL_BUDGET_CEILING, clampBudget, evaluateEscalation, nextHintRung } from "../src/hint-budget.js";
import { createSessionContext } from "../src/session-state.js";

const base = () => ({ ...createSessionContext(), state: "ASSESSING" as const });

describe("预算钳制：插件与模型只能收紧，不能放松", () => {
  test("请求超过内核上限时按上限截断", () => {
    expect(clampBudget({ softEscalations: 5, hardEscalations: 9, maxHintLevel: 5 })).toEqual(KERNEL_BUDGET_CEILING);
  });
  test("更严的请求原样保留", () => {
    expect(clampBudget({ softEscalations: 1, maxHintLevel: 2 })).toEqual({ softEscalations: 1, hardEscalations: 4, maxHintLevel: 2 });
  });
});

describe("升级裁定（设计稿 5.4）", () => {
  test("从 0 级升到 1 级，且有新产出：允许", () => {
    expect(evaluateEscalation(base(), 1, KERNEL_BUDGET_CEILING)).toEqual({ allowed: true, liftsSoftBudget: false });
  });
  test("一次跳两级：拒绝", () => {
    expect(evaluateEscalation(base(), 2, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "notOneLevelUp" });
  });
  test("上次提示后没有新产出：拒绝，禁止连续自动升级", () => {
    const ctx = { ...base(), hintLevel: 1, escalationCount: 1, newOutputSinceLastHint: false };
    expect(evaluateEscalation(ctx, 2, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "noNewOutputSinceLastHint" });
  });
  test("软预算用完、有实质性尝试且再次求助：允许但标记解除软预算", () => {
    const ctx = { ...base(), hintLevel: 2, escalationCount: 2, substantiveAttempts: 2, helpRequestedSinceLastHint: true };
    expect(evaluateEscalation(ctx, 3, KERNEL_BUDGET_CEILING)).toEqual({ allowed: true, liftsSoftBudget: true });
  });
  test("软预算用完但没有再次求助：拒绝", () => {
    const ctx = { ...base(), hintLevel: 2, escalationCount: 2, substantiveAttempts: 2, helpRequestedSinceLastHint: false };
    expect(evaluateEscalation(ctx, 3, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "softBudgetNeedsAttemptAndHelp" });
  });
  test("4 级演示前必须有过实质性尝试", () => {
    const ctx = { ...base(), hintLevel: 3, escalationCount: 3, substantiveAttempts: 0, helpRequestedSinceLastHint: true };
    expect(evaluateEscalation(ctx, 4, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "demoNeedsPriorAttempt" });
  });
  test("硬预算耗尽：拒绝", () => {
    const ctx = { ...base(), hintLevel: 4, escalationCount: 4, substantiveAttempts: 3, helpRequestedSinceLastHint: true };
    expect(evaluateEscalation(ctx, 5, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "hardBudgetExhausted" });
  });
  test("插件把最高级别收紧到 2 时，请求 3 级被拒", () => {
    const ctx = { ...base(), hintLevel: 2, escalationCount: 1, substantiveAttempts: 1, helpRequestedSinceLastHint: true };
    expect(evaluateEscalation(ctx, 3, clampBudget({ maxHintLevel: 2 }))).toEqual({ allowed: false, reason: "aboveMaxHintLevel" });
  });
  test("可见提示撤回后阶梯不从头来：hintLevel 0 但用过 1 级时，下一级是 2", () => {
    const ctx = { ...base(), hintLevel: 0, maxHintLevelUsed: 1, escalationCount: 1 };
    expect(nextHintRung(ctx)).toBe(2);
    expect(evaluateEscalation(ctx, 1, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "notOneLevelUp" });
    expect(evaluateEscalation(ctx, 2, KERNEL_BUDGET_CEILING)).toEqual({ allowed: true, liftsSoftBudget: false });
  });
  test("辅助轮跳过软预算与新产出门禁，但仍只能升一级且不越硬预算", () => {
    const ctx = { ...base(), hintLevel: 2, escalationCount: 2, newOutputSinceLastHint: false, assistedRound: true };
    expect(evaluateEscalation(ctx, 3, KERNEL_BUDGET_CEILING)).toEqual({ allowed: true, liftsSoftBudget: false });
    expect(evaluateEscalation(ctx, 4, KERNEL_BUDGET_CEILING)).toEqual({ allowed: false, reason: "notOneLevelUp" });
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/learning-kernel test -- hint-budget`
Expected: 失败，找不到 `../src/hint-budget.js`。

- [ ] **Step 3：实现**

```ts
// packages/learning-kernel/src/hint-budget.ts
// 提示预算裁定（设计稿 5.4）：软预算 2 次升级、硬预算 4 级；每次只升一级；升级前必须有孩子新产出；
// 超软预算只有“有实质性尝试 + 再次明确求助”才能解除，并使本轮不再计作独立成功。预算上限由内核强制，插件与模型只能收紧。
import type { SessionContext } from "./session-state.js";

export interface InterventionBudget {
  softEscalations: number;
  hardEscalations: number;
  maxHintLevel: number;
}

export const KERNEL_BUDGET_CEILING: InterventionBudget = { softEscalations: 2, hardEscalations: 4, maxHintLevel: 4 };

export function clampBudget(requested: Partial<InterventionBudget>): InterventionBudget {
  return {
    softEscalations: Math.min(requested.softEscalations ?? KERNEL_BUDGET_CEILING.softEscalations, KERNEL_BUDGET_CEILING.softEscalations),
    hardEscalations: Math.min(requested.hardEscalations ?? KERNEL_BUDGET_CEILING.hardEscalations, KERNEL_BUDGET_CEILING.hardEscalations),
    maxHintLevel: Math.min(requested.maxHintLevel ?? KERNEL_BUDGET_CEILING.maxHintLevel, KERNEL_BUDGET_CEILING.maxHintLevel),
  };
}

export type EscalationVerdict =
  | { allowed: true; liftsSoftBudget: boolean }
  | { allowed: false; reason: "notOneLevelUp" | "aboveMaxHintLevel" | "hardBudgetExhausted" | "noNewOutputSinceLastHint" | "softBudgetNeedsAttemptAndHelp" | "demoNeedsPriorAttempt" };

type BudgetContext = Pick<SessionContext, "hintLevel" | "maxHintLevelUsed" | "escalationCount" | "newOutputSinceLastHint" | "substantiveAttempts" | "helpRequestedSinceLastHint" | "assistedRound">;

/** 阶梯的下一级：可见提示撤回后 hintLevel 归 0，但阶梯不从头来，以本挑战用过的最高级别为准 */
export function nextHintRung(ctx: Pick<SessionContext, "hintLevel" | "maxHintLevelUsed">): number {
  return Math.max(ctx.hintLevel, ctx.maxHintLevelUsed) + 1;
}

export function evaluateEscalation(ctx: BudgetContext, requestedLevel: number, budget: InterventionBudget): EscalationVerdict {
  if (requestedLevel !== nextHintRung(ctx)) return { allowed: false, reason: "notOneLevelUp" };
  if (ctx.escalationCount >= budget.hardEscalations) return { allowed: false, reason: "hardBudgetExhausted" };
  if (requestedLevel > budget.maxHintLevel) return { allowed: false, reason: "aboveMaxHintLevel" };
  if (requestedLevel === 4 && ctx.substantiveAttempts < 1) return { allowed: false, reason: "demoNeedsPriorAttempt" };
  // 辅助轮的提示明确“不计入验证”，不再受软预算与新产出门禁约束，但仍不能越硬预算
  if (ctx.assistedRound) return { allowed: true, liftsSoftBudget: false };
  if (!ctx.newOutputSinceLastHint) return { allowed: false, reason: "noNewOutputSinceLastHint" };
  if (ctx.escalationCount >= budget.softEscalations) {
    if (ctx.substantiveAttempts >= 1 && ctx.helpRequestedSinceLastHint) return { allowed: true, liftsSoftBudget: true };
    return { allowed: false, reason: "softBudgetNeedsAttemptAndHelp" };
  }
  return { allowed: true, liftsSoftBudget: false };
}
```

- [ ] **Step 4：跑测试**

Run: `pnpm --filter @ai-scholar/learning-kernel test && pnpm --filter @ai-scholar/learning-kernel typecheck`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/learning-kernel
git commit -m "实现提示预算裁定：软硬预算、一次一级与新产出门禁

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 4：幂等事件日志

**Files:**
- Create: `packages/learning-kernel/src/event-log.ts`
- Modify: `packages/learning-kernel/src/index.ts`（加 `export * from "./event-log.js";`）
- Test: `packages/learning-kernel/test/event-log.test.ts`

**Interfaces:**
- Consumes: `EvidenceEvent`（Task 1）。
- Produces: `StoredEvent`、`AppendResult`、`contentHashOf(event)`、`canonicalJson(value)`、`class EventLog { append(event, receivedAt); lastConfirmedSeq; all(); byId(eventId) }`。

- [ ] **Step 1：写失败测试**

```ts
// packages/learning-kernel/test/event-log.test.ts
import { describe, expect, test } from "vitest";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { EventLog, canonicalJson, contentHashOf } from "../src/event-log.js";

function ev(eventId: string, clientSeq: number, text = "hi"): EvidenceEvent {
  return { eventId, clientSessionId: "s-1", deviceId: "d-1", clientSeq, occurredAt: 1_757_200_000_000 + clientSeq, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload: { type: "UTTERANCE", text } };
}

describe("幂等事件日志（设计稿 10.2）", () => {
  test("规范化 JSON 与键顺序无关，哈希因此稳定", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
    expect(contentHashOf(ev("e-1", 1))).toBe(contentHashOf({ ...ev("e-1", 1), semanticObjectIds: [] }));
    expect(contentHashOf(ev("e-1", 1, "a"))).not.toBe(contentHashOf(ev("e-1", 1, "b")));
  });

  test("顺序追加得到递增 serverSeq 并推进 lastConfirmedSeq", () => {
    const log = new EventLog();
    const r1 = log.append(ev("e-1", 1), 1_000);
    const r2 = log.append(ev("e-2", 2), 1_001);
    expect(r1).toMatchObject({ kind: "appended", stored: { serverSeq: 1, receivedAt: 1_000 } });
    expect(r2).toMatchObject({ kind: "appended", stored: { serverSeq: 2 } });
    expect(log.lastConfirmedSeq).toBe(2);
  });

  test("同一 event_id 重放返回原记录，不重复计入", () => {
    const log = new EventLog();
    log.append(ev("e-1", 1), 1_000);
    const replay = log.append(ev("e-1", 1), 9_000);
    expect(replay).toMatchObject({ kind: "duplicate", stored: { receivedAt: 1_000 } });
    expect(log.all()).toHaveLength(1);
  });

  test("同一 event_id 但负载不同：冲突", () => {
    const log = new EventLog();
    log.append(ev("e-1", 1, "a"), 1_000);
    const r = log.append(ev("e-1", 1, "b"), 1_001);
    expect(r.kind).toBe("conflict");
  });

  test("序号缺口要求从 lastConfirmedSeq + 1 重放", () => {
    const log = new EventLog();
    log.append(ev("e-1", 1), 1_000);
    expect(log.append(ev("e-3", 3), 1_002)).toEqual({ kind: "seqGap", expectedSeq: 2 });
    expect(log.all()).toHaveLength(1);
  });

  test("可以从已落盘记录恢复", () => {
    const log = new EventLog();
    log.append(ev("e-1", 1), 1_000);
    const restored = new EventLog(log.all());
    expect(restored.lastConfirmedSeq).toBe(1);
    expect(restored.append(ev("e-1", 1), 5).kind).toBe("duplicate");
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/learning-kernel test -- event-log`
Expected: 失败，找不到模块。

- [ ] **Step 3：实现**

```ts
// packages/learning-kernel/src/event-log.ts
// 幂等事件日志（设计稿 10.2）：event_id 唯一；重放返回原记录；负载不同即冲突；client_seq 必须连续，缺口要求从 lastConfirmedSeq + 1 重放。
// 内容哈希基于键排序后的规范化 JSON，与客户端序列化的键顺序无关。
import { createHash } from "node:crypto";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";

export interface StoredEvent {
  event: EvidenceEvent;
  serverSeq: number;
  receivedAt: number;
  contentHash: string;
}

export type AppendResult =
  | { kind: "appended"; stored: StoredEvent }
  | { kind: "duplicate"; stored: StoredEvent }
  | { kind: "conflict"; existingHash: string; incomingHash: string }
  | { kind: "seqGap"; expectedSeq: number };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHashOf(event: EvidenceEvent): string {
  const { eventId, clientSeq, occurredAt, quality, payload, semanticObjectIds } = event;
  return createHash("sha256").update(canonicalJson({ eventId, clientSeq, occurredAt, quality, payload, semanticObjectIds })).digest("hex");
}

export class EventLog {
  private readonly events: StoredEvent[] = [];
  private readonly byEventId = new Map<string, StoredEvent>();

  constructor(initial: StoredEvent[] = []) {
    for (const stored of [...initial].sort((a, b) => a.serverSeq - b.serverSeq)) {
      this.events.push(stored);
      this.byEventId.set(stored.event.eventId, stored);
    }
  }

  get lastConfirmedSeq(): number {
    const last = this.events[this.events.length - 1];
    return last ? last.event.clientSeq : 0;
  }

  append(event: EvidenceEvent, receivedAt: number): AppendResult {
    const incomingHash = contentHashOf(event);
    const existing = this.byEventId.get(event.eventId);
    if (existing) {
      return existing.contentHash === incomingHash
        ? { kind: "duplicate", stored: existing }
        : { kind: "conflict", existingHash: existing.contentHash, incomingHash };
    }
    const expectedSeq = this.lastConfirmedSeq + 1;
    if (event.clientSeq !== expectedSeq) return { kind: "seqGap", expectedSeq };
    const stored: StoredEvent = { event, serverSeq: this.events.length + 1, receivedAt, contentHash: incomingHash };
    this.events.push(stored);
    this.byEventId.set(event.eventId, stored);
    return { kind: "appended", stored };
  }

  all(): StoredEvent[] { return [...this.events]; }
  byId(eventId: string): StoredEvent | undefined { return this.byEventId.get(eventId); }
}
```

- [ ] **Step 4：跑测试与类型检查**

Run: `pnpm --filter @ai-scholar/learning-kernel test && pnpm --filter @ai-scholar/learning-kernel typecheck`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/learning-kernel
git commit -m "实现幂等事件日志：内容哈希、重放去重与序号缺口

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 5：挑战、证据与插件契约

**Files:**
- Create: `packages/learning-kernel/src/challenge.ts`
- Create: `packages/learning-kernel/src/plugin.ts`
- Create: `packages/learning-kernel/src/testing/plugin-contract.ts`
- Modify: `packages/learning-kernel/src/index.ts`（加三行导出）
- Test: `packages/learning-kernel/test/plugin-registry.test.ts`
- Test: `packages/learning-kernel/test/kernel-purity.test.ts`

**Interfaces:**
- Consumes: `EvidenceEvent`、`CanvasAction`（Task 1）、`InterventionBudget`（Task 3）。
- Produces: `LearningChallenge`、`HintContent`、`ChallengeInput`、`DisciplineEvidence`、`HypothesisSupport`、`DiscriminatingProbe`、`ExplainBackVerdict`、`DisciplinePlugin`、`DisciplinePluginManifest`、`PluginRegistry`、`runPluginContract(plugin): ContractCheck[]`。

- [ ] **Step 1：写失败测试**

```ts
// packages/learning-kernel/test/plugin-registry.test.ts
import { describe, expect, test } from "vitest";
import { PluginRegistry, type DisciplinePlugin } from "../src/plugin.js";
import { runPluginContract } from "../src/testing/plugin-contract.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

describe("插件注册表", () => {
  test("按 id 注册与取回；重复 id 拒绝", () => {
    const registry = new PluginRegistry();
    registry.register(fakePlugin);
    expect(registry.get("fake")).toBe(fakePlugin);
    expect(() => registry.register(fakePlugin)).toThrowError(/已注册/);
    expect(() => registry.get("nope")).toThrowError(/未注册/);
  });

  test("契约检查对合规的假插件全部通过", () => {
    const checks = runPluginContract(fakePlugin);
    expect(checks.filter((c) => !c.pass)).toEqual([]);
    expect(checks.map((c) => c.name)).toContain("discriminatingProbesSeparateHypotheses");
  });

  test("契约检查能抓住不分辨假设的探针", () => {
    const broken: DisciplinePlugin = {
      ...fakePlugin,
      discriminatingProbes: () => [{ id: "p", question: "?", outcomes: { a: [{ hypothesisId: "h1", direction: "supports" }], b: [{ hypothesisId: "h1", direction: "supports" }] } }],
    };
    expect(runPluginContract(broken).find((c) => c.name === "discriminatingProbesSeparateHypotheses")?.pass).toBe(false);
  });
});
```

```ts
// packages/learning-kernel/test/helpers/fake-plugin.ts
// 测试用假插件：不含任何真实学科内容，只满足契约形状；内核测试全部用它，避免内核测试依赖数学插件。
import type { DisciplinePlugin, LearningChallenge } from "../../src/plugin.js";

const challenge: LearningChallenge = {
  challengeId: "c-fake-1", discipline: "fake", curriculumAnchor: "fake/unit-1", probeFamilyId: "fake-family", difficultyBand: "base",
  developmentGoal: "示例目标", learnerPrompt: "请在画布上表示这个问题。", availableTools: ["label"],
  independencePolicy: { initialWindowMs: 30_000, hardCapMs: 240_000 },
  interventionBudget: { softEscalations: 2, hardEscalations: 4, maxHintLevel: 4 },
  expectedEvidence: ["representation", "answer"],
  hintLadder: {
    1: { spokenResponse: "你现在已经确定了什么？", learnerTask: "说说你确定的部分", canvasActions: [] },
    2: { spokenResponse: "试试更简单的例子？", learnerTask: "换一个更小的数试试", canvasActions: [] },
    3: { spokenResponse: "这是一个空的表示。", learnerTask: "把它填完整", canvasActions: [{ kind: "upsertObject", object: { id: "agent-frame", owner: "agent", kind: "label", props: {} } }] },
    4: { spokenResponse: "我示范一遍。", learnerTask: "现在示范擦掉了，用你自己的方式重做", canvasActions: [{ kind: "upsertObject", object: { id: "agent-demo", owner: "agent", kind: "label", props: {} } }] },
  },
  explainBackSpec: { prompt: "说说为什么这样做成立。", requiredElements: ["why"] },
  transferSpec: { description: "换一个表面不同的情境", passCriteria: "答案正确" },
};

export const fakePlugin: DisciplinePlugin = {
  manifest: { id: "fake", displayName: "假插件", version: "0.0.1", semanticObjectKinds: ["label"], thinkingMoves: ["represent"], artifactTypes: ["canvas"], curriculumVersions: ["fake/unit-1"] },
  createChallenge: (input) => ({ ...challenge, difficultyBand: input.difficultyBand ?? "base", challengeId: `c-fake-${input.difficultyBand ?? "base"}` }),
  interpretEvent: (_c, event) => {
    const p = event.payload;
    if (p.type === "STROKE") return [{ evidenceId: `ev-${event.eventId}`, eventId: event.eventId, kind: "representation", summary: "画了表示", hypothesisSupport: [] }];
    if (p.type === "ANSWER") return [{ evidenceId: `ev-${event.eventId}`, eventId: event.eventId, kind: p.text === "42" ? "answer" : "wrong_answer", summary: p.text, hypothesisSupport: p.text === "42" ? [] : [{ hypothesisId: "h1", direction: "supports" }] }];
    if (p.type === "UTTERANCE" || p.type === "EXPLAIN") return [{ evidenceId: `ev-${event.eventId}`, eventId: event.eventId, kind: "utterance", summary: p.text, hypothesisSupport: [] }];
    return [];
  },
  isExpectedEvidenceMet: (c, evidence) => c.expectedEvidence.every((k) => evidence.some((e) => e.kind === k)),
  checkExplainBack: (_c, text) => (text.includes("因为") ? { passed: true, missing: [] } : { passed: false, missing: ["why"] }),
  createTransfer: (c) => ({ ...c, challengeId: `${c.challengeId}-transfer`, learnerPrompt: "换一个情境：请回答 43 减 1。", expectedEvidence: ["answer"] }),
  checkTransferAnswer: (_c, text) => text.trim() === "42",
  discriminatingProbes: () => [{ id: "probe-1", question: "答案会比 10 大还是小？", outcomes: { larger: [{ hypothesisId: "h1", direction: "supports" }, { hypothesisId: "h2", direction: "weakens" }], smaller: [{ hypothesisId: "h1", direction: "weakens" }, { hypothesisId: "h2", direction: "supports" }] } }],
};
```

```ts
// packages/learning-kernel/test/kernel-purity.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// 设计稿 14.5：通用内核源码出现学科标识符字面量即视为契约测试失败
// 区分大小写：`Math.max` 里的 Math 不是学科标识符
const FORBIDDEN = /\b(math|literature|decimal)\b|数学|文学|小数/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("内核纯净度", () => {
  test("packages/learning-kernel/src 不含学科字面量", () => {
    const offenders = walk(new URL("../src", import.meta.url).pathname)
      .filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")))
      .map((file) => file.split("/packages/")[1]);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/learning-kernel test -- plugin-registry`
Expected: 失败，找不到 `../src/plugin.js`。

- [ ] **Step 3：实现挑战与插件契约**

```ts
// packages/learning-kernel/src/challenge.ts
// 学科无关的挑战与证据结构（设计稿 10.1、9.1）。学科内容全部由插件填入，这里只定义形状。
import type { CanvasAction, EvidenceEvent } from "@ai-scholar/session-contracts";
import type { InterventionBudget } from "./hint-budget.js";

export interface HintContent {
  spokenResponse: string;
  learnerTask: string;
  canvasActions: CanvasAction[];
}

export interface LearningChallenge {
  challengeId: string;
  discipline: string;
  curriculumAnchor: string;
  probeFamilyId: string;
  difficultyBand: string;
  developmentGoal: string;
  learnerPrompt: string;
  availableTools: string[];
  independencePolicy: { initialWindowMs: number; hardCapMs: number };
  interventionBudget: InterventionBudget;
  expectedEvidence: string[];
  hintLadder: Record<1 | 2 | 3 | 4, HintContent>;
  explainBackSpec: { prompt: string; requiredElements: string[] };
  transferSpec: { description: string; passCriteria: string };
}

export interface ChallengeInput {
  curriculumAnchor: string;
  probeFamilyId?: string | undefined;
  difficultyBand?: string | undefined;
}

export interface HypothesisSupport {
  hypothesisId: string;
  direction: "supports" | "weakens";
}

/** 本轮证据：由插件对已确认事件赋予有限的学科含义 */
export interface DisciplineEvidence {
  evidenceId: string;
  eventId: string;
  kind: string;
  summary: string;
  hypothesisSupport: HypothesisSupport[];
}

export interface DiscriminatingProbe {
  id: string;
  question: string;
  /** 不同回答类别 → 对各假设的支持/反驳 */
  outcomes: Record<string, HypothesisSupport[]>;
}

export interface ExplainBackVerdict {
  passed: boolean;
  missing: string[];
}

export type { EvidenceEvent };
```

```ts
// packages/learning-kernel/src/plugin.ts
// 学科插件契约（设计稿 4.2、10.5）：插件回答“研究什么 → 怎样观察 → 怎样发问 → 怎样探索 → 什么算证据 → 怎样表达 → 怎样迁移”。
// 内核只通过这个接口与学科交互，不得出现任何学科字面量。
import type { ChallengeInput, DisciplineEvidence, DiscriminatingProbe, EvidenceEvent, ExplainBackVerdict, LearningChallenge } from "./challenge.js";

export interface DisciplinePluginManifest {
  id: string;
  displayName: string;
  version: string;
  semanticObjectKinds: string[];
  thinkingMoves: string[];
  artifactTypes: string[];
  curriculumVersions: string[];
}

export interface DisciplinePlugin {
  manifest: DisciplinePluginManifest;
  createChallenge(input: ChallengeInput): LearningChallenge;
  interpretEvent(challenge: LearningChallenge, event: EvidenceEvent, history: DisciplineEvidence[]): DisciplineEvidence[];
  isExpectedEvidenceMet(challenge: LearningChallenge, evidence: DisciplineEvidence[]): boolean;
  checkExplainBack(challenge: LearningChallenge, text: string): ExplainBackVerdict;
  createTransfer(challenge: LearningChallenge): LearningChallenge;
  checkTransferAnswer(transfer: LearningChallenge, text: string): boolean;
  discriminatingProbes(challenge: LearningChallenge): DiscriminatingProbe[];
}

export class PluginRegistry {
  private readonly plugins = new Map<string, DisciplinePlugin>();

  register(plugin: DisciplinePlugin): void {
    if (this.plugins.has(plugin.manifest.id)) throw new Error(`插件 ${plugin.manifest.id} 已注册`);
    this.plugins.set(plugin.manifest.id, plugin);
  }

  get(id: string): DisciplinePlugin {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`插件 ${id} 未注册`);
    return plugin;
  }

  ids(): string[] { return [...this.plugins.keys()]; }
}

export type { ChallengeInput, DisciplineEvidence, DiscriminatingProbe, ExplainBackVerdict, LearningChallenge };
```

```ts
// packages/learning-kernel/src/testing/plugin-contract.ts
// 插件契约检查（设计稿 15.2）：每个插件的测试都调用它并断言全部通过，所有学科插件共用同一套检查。
// 返回结构化结果而不是直接断言，避免内核源码依赖测试框架。
import { teachingProposalSchema } from "@ai-scholar/session-contracts";
import { KERNEL_BUDGET_CEILING } from "../hint-budget.js";
import type { DisciplinePlugin } from "../plugin.js";

export interface ContractCheck { name: string; pass: boolean; detail: string }

export function runPluginContract(plugin: DisciplinePlugin): ContractCheck[] {
  const checks: ContractCheck[] = [];
  const push = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

  const anchor = plugin.manifest.curriculumVersions[0] ?? "";
  const challenge = plugin.createChallenge({ curriculumAnchor: anchor });
  push("manifestHasKinds", plugin.manifest.semanticObjectKinds.length > 0, "语义对象种类不能为空");
  push("challengeHasVisibleTask", challenge.learnerPrompt.length > 0 && challenge.expectedEvidence.length > 0);
  push("challengeDisciplineMatchesManifest", challenge.discipline === plugin.manifest.id);
  push("budgetWithinKernelCeiling",
    challenge.interventionBudget.softEscalations <= KERNEL_BUDGET_CEILING.softEscalations &&
    challenge.interventionBudget.hardEscalations <= KERNEL_BUDGET_CEILING.hardEscalations &&
    challenge.interventionBudget.maxHintLevel <= KERNEL_BUDGET_CEILING.maxHintLevel, "插件预算只能比内核更严");

  for (const level of [1, 2, 3, 4] as const) {
    const hint = challenge.hintLadder[level];
    const proposal = teachingProposalSchema.safeParse({ proposalId: `contract-${level}`, spokenResponse: hint.spokenResponse, learnerTask: hint.learnerTask, canvasActions: hint.canvasActions, hintLevel: level });
    push(`hintLevel${level}IsValidProposal`, proposal.success, proposal.success ? "" : proposal.error.message);
    const kindsOk = hint.canvasActions.every((a) => a.kind !== "upsertObject" || plugin.manifest.semanticObjectKinds.includes(a.object.kind));
    push(`hintLevel${level}UsesDeclaredKinds`, kindsOk, "提示里的语义对象种类必须在清单中声明");
  }
  push("demoHintRequiresRebuild", challenge.hintLadder[4].learnerTask.length > 0, "4 级演示后必须给出重建任务");

  const transfer = plugin.createTransfer(challenge);
  push("transferKeepsStructureChangesSurface", transfer.challengeId !== challenge.challengeId && transfer.learnerPrompt !== challenge.learnerPrompt && transfer.probeFamilyId === challenge.probeFamilyId);
  push("explainBackRejectsEmpty", plugin.checkExplainBack(challenge, "").passed === false);
  push("transferRejectsEmpty", plugin.checkTransferAnswer(transfer, "") === false);

  const probes = plugin.discriminatingProbes(challenge);
  const separates = probes.length > 0 && probes.every((probe) => {
    const outcomes = Object.values(probe.outcomes);
    if (outcomes.length < 2) return false;
    const touched = new Set(outcomes.flat().map((s) => s.hypothesisId));
    if (touched.size < 2) return false;
    return [...touched].some((h) => new Set(outcomes.map((o) => o.find((s) => s.hypothesisId === h)?.direction ?? "none")).size > 1);
  });
  push("discriminatingProbesSeparateHypotheses", separates, "每个探针至少要对两个假设给出不同方向的证据");
  return checks;
}
```

`index.ts` 追加：

```ts
export * from "./challenge.js";
export * from "./plugin.js";
export * from "./testing/plugin-contract.js";
```

- [ ] **Step 4：跑测试与类型检查**

Run: `pnpm --filter @ai-scholar/learning-kernel test && pnpm --filter @ai-scholar/learning-kernel typecheck`
Expected: PASS，含纯净度检查。

- [ ] **Step 5：提交**

```bash
git add packages/learning-kernel
git commit -m "定义学科插件契约、注册表与共用契约检查

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 6：教学提案本地校验器

**Files:**
- Create: `packages/learning-kernel/src/proposal-validator.ts`
- Modify: `packages/learning-kernel/src/index.ts`（加 `export * from "./proposal-validator.js";`）
- Test: `packages/learning-kernel/test/proposal-validator.test.ts`

**Interfaces:**
- Consumes: `TeachingProposal`（Task 1）、`SessionContext`（Task 2）、`evaluateEscalation`/`InterventionBudget`（Task 3）、`DisciplinePlugin`（Task 5）。
- Produces: `validateProposal(input: ValidationInput): ValidationResult`，`ValidationInput = { proposal, context, budget, plugin, protectedObjectIds, maxSpokenChars? }`，`ValidationResult = { accepted: true; liftsSoftBudget: boolean } | { accepted: false; reasons: string[] }`。

- [ ] **Step 1：写失败测试**

```ts
// packages/learning-kernel/test/proposal-validator.test.ts
import { describe, expect, test } from "vitest";
import type { TeachingProposal } from "@ai-scholar/session-contracts";
import { KERNEL_BUDGET_CEILING } from "../src/hint-budget.js";
import { validateProposal } from "../src/proposal-validator.js";
import { createSessionContext, type SessionContext } from "../src/session-state.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

const ctx = (): SessionContext => ({ ...createSessionContext(), state: "INTERVENING", substantiveAttempts: 1 });
const proposal = (patch: Partial<TeachingProposal> = {}): TeachingProposal => ({
  proposalId: "p-1", spokenResponse: "你现在已经确定了什么？", canvasActions: [], learnerTask: "说说看", expectedEvidence: [], hintLevel: 1, ...patch,
});
const input = (p: TeachingProposal, c = ctx()) => ({ proposal: p, context: c, budget: KERNEL_BUDGET_CEILING, plugin: fakePlugin, protectedObjectIds: ["child-stroke-1"] });

describe("教学提案本地校验（设计稿 10.3、13）", () => {
  test("合规的一级提示通过", () => {
    expect(validateProposal(input(proposal()))).toEqual({ accepted: true, liftsSoftBudget: false });
  });
  test("越级提示被拒", () => {
    expect(validateProposal(input(proposal({ hintLevel: 3 })))).toEqual({ accepted: false, reasons: ["hint:notOneLevelUp"] });
  });
  test("上次提示后没有新产出时的升级被拒", () => {
    const r = validateProposal(input(proposal({ hintLevel: 2 }), { ...ctx(), hintLevel: 1, escalationCount: 1, newOutputSinceLastHint: false }));
    expect(r).toEqual({ accepted: false, reasons: ["hint:noNewOutputSinceLastHint"] });
  });
  test("超长语音与多个问题被拒", () => {
    const r = validateProposal(input(proposal({ spokenResponse: "先想一想？再说一说？" + "很长".repeat(80) })));
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.reasons).toEqual(["spoken:tooLong", "spoken:multipleQuestions"]);
  });
  test("未声明的语义对象种类与覆盖孩子层被拒", () => {
    const r = validateProposal(input(proposal({ canvasActions: [
      { kind: "upsertObject", object: { id: "x", owner: "agent", kind: "unknownKind", props: {} } },
      { kind: "removeObject", objectId: "child-stroke-1" },
    ] })));
    expect(r).toEqual({ accepted: false, reasons: ["canvas:unknownKind:unknownKind", "canvas:overwritesChildLayer:child-stroke-1"] });
  });
  test("辅助轮或非迁移阶段的记忆候选被拒", () => {
    const withMemory = proposal({ memoryCandidate: { description: "会了", evidenceEventIds: ["e-1"] } });
    expect(validateProposal(input(withMemory))).toEqual({ accepted: false, reasons: ["memory:notAfterTransfer"] });
    const assisted = { ...ctx(), state: "TRANSFER" as const, assistedRound: true };
    expect(validateProposal(input(proposal({ hintLevel: 0, memoryCandidate: { description: "会了", evidenceEventIds: ["e-1"] } }), assisted))).toEqual({ accepted: false, reasons: ["memory:assistedRound"] });
  });
  test("被异议冻结的提案 id 不能再次提出", () => {
    const r = validateProposal(input(proposal(), { ...ctx(), frozenTargetIds: ["p-1"] }));
    expect(r).toEqual({ accepted: false, reasons: ["proposal:frozen"] });
  });
  test("0 级提案（非提示发言）不做升级裁定", () => {
    expect(validateProposal(input(proposal({ hintLevel: 0 }), { ...ctx(), state: "EXPLAIN_BACK" }))).toEqual({ accepted: true, liftsSoftBudget: false });
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/learning-kernel test -- proposal-validator`
Expected: 失败，找不到模块。

- [ ] **Step 3：实现**

```ts
// packages/learning-kernel/src/proposal-validator.ts
// 教学提案本地校验器（设计稿 10.3、13“模型输出不合规”）：三种桥接的输出都必须过这一关。
// 校验项：提示级别与预算门禁、语音长度与单一动作、语义对象种类、不得覆盖孩子层、记忆候选时机、被异议冻结。
import type { TeachingProposal } from "@ai-scholar/session-contracts";
import { evaluateEscalation, type InterventionBudget } from "./hint-budget.js";
import type { DisciplinePlugin } from "./plugin.js";
import type { SessionContext } from "./session-state.js";

export interface ValidationInput {
  proposal: TeachingProposal;
  context: SessionContext;
  budget: InterventionBudget;
  plugin: DisciplinePlugin;
  /** 孩子层与原始材料层的对象 id，Agent 不得删除或覆盖 */
  protectedObjectIds: string[];
  maxSpokenChars?: number | undefined;
}

export type ValidationResult = { accepted: true; liftsSoftBudget: boolean } | { accepted: false; reasons: string[] };

const DEFAULT_MAX_SPOKEN_CHARS = 120;

export function validateProposal(input: ValidationInput): ValidationResult {
  const { proposal, context, budget, plugin, protectedObjectIds } = input;
  const reasons: string[] = [];
  let liftsSoftBudget = false;

  if (context.frozenTargetIds.includes(proposal.proposalId)) reasons.push("proposal:frozen");

  if (proposal.hintLevel > 0 && proposal.hintLevel !== context.hintLevel) {
    const verdict = evaluateEscalation(context, proposal.hintLevel, budget);
    if (!verdict.allowed) reasons.push(`hint:${verdict.reason}`);
    else liftsSoftBudget = verdict.liftsSoftBudget;
  }

  const maxChars = input.maxSpokenChars ?? DEFAULT_MAX_SPOKEN_CHARS;
  if (proposal.spokenResponse.length > maxChars) reasons.push("spoken:tooLong");
  // 每次发言只含一个教学动作：最多一个问句
  const questionMarks = (proposal.spokenResponse.match(/[?？]/g) ?? []).length;
  if (questionMarks > 1) reasons.push("spoken:multipleQuestions");

  for (const action of proposal.canvasActions) {
    if (action.kind === "upsertObject" && !plugin.manifest.semanticObjectKinds.includes(action.object.kind)) reasons.push(`canvas:unknownKind:${action.object.kind}`);
    if (action.kind === "upsertObject" && protectedObjectIds.includes(action.object.id)) reasons.push(`canvas:overwritesChildLayer:${action.object.id}`);
    if (action.kind === "removeObject" && protectedObjectIds.includes(action.objectId)) reasons.push(`canvas:overwritesChildLayer:${action.objectId}`);
  }

  if (proposal.memoryCandidate) {
    if (context.assistedRound) reasons.push("memory:assistedRound");
    else if (context.state !== "TRANSFER") reasons.push("memory:notAfterTransfer");
  }

  return reasons.length === 0 ? { accepted: true, liftsSoftBudget } : { accepted: false, reasons };
}
```

- [ ] **Step 4：跑测试与类型检查**

Run: `pnpm --filter @ai-scholar/learning-kernel test && pnpm --filter @ai-scholar/learning-kernel typecheck`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/learning-kernel
git commit -m "实现教学提案本地校验器：预算门禁、语音约束、画布合法性与记忆时机

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 7：数学插件：小数乘法薄切片

**Files:**
- Create: `packages/plugin-math/package.json`
- Create: `packages/plugin-math/tsconfig.json`
- Create: `packages/plugin-math/src/index.ts`
- Create: `packages/plugin-math/src/decimal-multiplication.ts`
- Test: `packages/plugin-math/test/plugin-math.test.ts`

**Interfaces:**
- Consumes: `DisciplinePlugin`、`LearningChallenge`、`DisciplineEvidence`、`runPluginContract`（Task 5）。
- Produces: `mathPlugin: DisciplinePlugin`（`manifest.id === "math"`）、`MATH_HYPOTHESES`、`parseNumbers(text)`。挑战 `2.4 × 0.3`（答案 0.72），迁移 `3.5 × 0.4`（答案 1.4），低难度带 `2 × 0.3`（答案 0.6）。

- [ ] **Step 1：写失败测试**

```ts
// packages/plugin-math/test/plugin-math.test.ts
import { describe, expect, test } from "vitest";
import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import { runPluginContract } from "@ai-scholar/learning-kernel";
import { MATH_HYPOTHESES, mathPlugin, parseNumbers } from "../src/index.js";

const challenge = mathPlugin.createChallenge({ curriculumAnchor: "人教版五上/小数乘法" });
let seq = 0;
function say(type: "UTTERANCE" | "ANSWER" | "EXPLAIN", text: string): EvidenceEvent {
  seq += 1;
  return { eventId: `e-${seq}`, clientSessionId: "s", deviceId: "d", clientSeq: seq, occurredAt: seq, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload: { type, text } };
}

describe("数学插件契约", () => {
  test("通过内核共用契约检查", () => {
    expect(runPluginContract(mathPlugin).filter((c) => !c.pass)).toEqual([]);
  });
  test("挑战是 2.4 × 0.3，迁移是 3.5 × 0.4，低难度带是 2 × 0.3", () => {
    expect(challenge.learnerPrompt).toContain("2.4 × 0.3");
    expect(mathPlugin.createTransfer(challenge).learnerPrompt).toContain("3.5 × 0.4");
    expect(mathPlugin.createChallenge({ curriculumAnchor: "x", difficultyBand: "lower" }).learnerPrompt).toContain("2 × 0.3");
  });
});

describe("证据解释（设计稿 6.2 区分性探针）", () => {
  test("说“比 2.4 小”削弱直觉断点；说“比 2.4 大”支持直觉断点", () => {
    const small = mathPlugin.interpretEvent(challenge, say("UTTERANCE", "我觉得会比 2.4 小"), []);
    expect(small[0]).toMatchObject({ kind: "magnitude_estimate", hypothesisSupport: [{ hypothesisId: "intuition_gap", direction: "weakens" }] });
    const big = mathPlugin.interpretEvent(challenge, say("UTTERANCE", "应该比 2.4 大吧"), []);
    expect(big[0]?.hypothesisSupport).toEqual([{ hypothesisId: "intuition_gap", direction: "supports" }]);
  });
  test("直觉正确却算出 7.2：支持严谨链条断点而不是直觉断点", () => {
    const history = mathPlugin.interpretEvent(challenge, say("UTTERANCE", "会比 2.4 小"), []);
    const wrong = mathPlugin.interpretEvent(challenge, say("ANSWER", "7.2"), history);
    expect(wrong[0]).toMatchObject({ kind: "wrong_answer", hypothesisSupport: [{ hypothesisId: "rigor_chain_gap", direction: "supports" }] });
  });
  test("没有大小判断就算出 7.2：同时支持直觉与严谨链条两个候选", () => {
    const wrong = mathPlugin.interpretEvent(challenge, say("ANSWER", "7.2"), []);
    expect(wrong[0]?.hypothesisSupport.map((s) => s.hypothesisId).sort()).toEqual(["intuition_gap", "rigor_chain_gap"]);
  });
  test("0.72 是正确答案；“十分之三”是意义证据", () => {
    expect(mathPlugin.interpretEvent(challenge, say("ANSWER", "0.72"), [])[0]?.kind).toBe("exact_answer");
    expect(mathPlugin.interpretEvent(challenge, say("UTTERANCE", "0.3 就是十分之三"), [])[0]?.kind).toBe("tenths_meaning");
  });
  test("期望证据齐全才算独立形成方案", () => {
    const evidence = [
      ...mathPlugin.interpretEvent(challenge, say("UTTERANCE", "比 2.4 小"), []),
      ...mathPlugin.interpretEvent(challenge, say("UTTERANCE", "0.3 是 3 个 0.1"), []),
    ];
    expect(mathPlugin.isExpectedEvidenceMet(challenge, evidence)).toBe(false);
    evidence.push(...mathPlugin.interpretEvent(challenge, say("ANSWER", "0.72"), evidence));
    expect(mathPlugin.isExpectedEvidenceMet(challenge, evidence)).toBe(true);
  });
});

describe("讲回与迁移", () => {
  test("讲回必须说明为什么变小和 0.3 的意义", () => {
    expect(mathPlugin.checkExplainBack(challenge, "因为 0.3 是十分之三，乘完只剩十分之三那么多，所以比 2.4 小").passed).toBe(true);
    expect(mathPlugin.checkExplainBack(challenge, "就是 24 乘 3 再点小数点").missing).toEqual(["why_smaller", "tenths_meaning"]);
  });
  test("迁移答案 1.4 通过，1.40 也通过，14 不通过", () => {
    const transfer = mathPlugin.createTransfer(challenge);
    expect(mathPlugin.checkTransferAnswer(transfer, "是 1.4")).toBe(true);
    expect(mathPlugin.checkTransferAnswer(transfer, "1.40")).toBe(true);
    expect(mathPlugin.checkTransferAnswer(transfer, "14")).toBe(false);
  });
  test("五类根因假设与数字解析", () => {
    expect(MATH_HYPOTHESES).toHaveLength(5);
    expect(parseNumbers("大概 0.7 或者 0.72 吧")).toEqual([0.7, 0.72]);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/plugin-math test`
Expected: 失败，包不存在。

- [ ] **Step 3：实现**

```json
// packages/plugin-math/package.json
{
  "name": "@ai-scholar/plugin-math",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@ai-scholar/learning-kernel": "workspace:*", "@ai-scholar/session-contracts": "workspace:*" }
}
```

```json
// packages/plugin-math/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*.ts", "test/**/*.ts"] }
```

```ts
// packages/plugin-math/src/decimal-multiplication.ts
// 数学心智插件的小数乘法薄切片（设计稿 6.2、6.3、14.1）：2.4 × 0.3 主路径、3.5 × 0.4 迁移、2 × 0.3 低难度带。
// 提示卡内容与家长 Wizard-of-Oz 指南（validation/wizard-of-oz/session-guide.md）保持一致。
// 不是固定题型分支：证据解释按“大小判断 / 意义 / 精确计算”三类证据工作，数字来自挑战对象而非写死。
import type { ChallengeInput, DisciplineEvidence, DisciplinePlugin, DiscriminatingProbe, EvidenceEvent, LearningChallenge } from "@ai-scholar/learning-kernel";

export const MATH_HYPOTHESES = ["representation_gap", "intuition_gap", "strategy_gap", "rigor_chain_gap", "verification_gap"] as const;

interface DecimalProduct { a: number; b: number; product: number; band: string }

const PRODUCTS: Record<string, DecimalProduct> = {
  base: { a: 2.4, b: 0.3, product: 0.72, band: "base" },
  lower: { a: 2, b: 0.3, product: 0.6, band: "lower" },
  transfer: { a: 3.5, b: 0.4, product: 1.4, band: "base" },
};

function fmt(n: number): string { return Number.isInteger(n) ? String(n) : String(n); }

export function parseNumbers(text: string): number[] {
  return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function buildChallenge(p: DecimalProduct, id: string, input: ChallengeInput): LearningChallenge {
  const expr = `${fmt(p.a)} × ${fmt(p.b)}`;
  const tenths = Math.round(p.b * 10);
  return {
    challengeId: id,
    discipline: "math",
    curriculumAnchor: input.curriculumAnchor,
    probeFamilyId: input.probeFamilyId ?? "decimal-times-tenths",
    difficultyBand: p.band,
    developmentGoal: "把小数乘法从规则变成大小直觉、位值意义与可校验的解释",
    learnerPrompt: `${expr}，结果大概是多少？先在画布上画出或说出你的想法。`,
    availableTools: ["tenthsBar", "numberLine", "label", "arrow", "highlight", "areaModel"],
    independencePolicy: { initialWindowMs: 30_000, hardCapMs: 240_000 },
    interventionBudget: { softEscalations: 2, hardEscalations: 4, maxHintLevel: 4 },
    expectedEvidence: ["magnitude_estimate", "tenths_meaning", "exact_answer"],
    hintLadder: {
      1: { spokenResponse: "你现在已经确定了什么？", learnerTask: "说说你已经确定的部分", canvasActions: [] },
      2: { spokenResponse: `${fmt(p.b)} 还能换成什么说法？`, learnerTask: `换一种说法说说 ${fmt(p.b)}`, canvasActions: [] },
      3: { spokenResponse: "这是一个空的十等份长条。", learnerTask: `在长条上标出 ${fmt(p.b)}`, canvasActions: [{ kind: "upsertObject", object: { id: "agent-tenths-bar", owner: "agent", kind: "tenthsBar", props: { segments: 10, filled: 0 } } }] },
      4: { spokenResponse: `我示范一遍 ${fmt(Math.floor(p.a))} × ${fmt(p.b)}：${fmt(p.b)} 是 ${tenths} 个 0.1，所以是 ${fmt(Math.floor(p.a) * p.b)}。`, learnerTask: `示范擦掉了，请你用自己的方式重新做 ${expr}`, canvasActions: [{ kind: "upsertObject", object: { id: "agent-demo", owner: "agent", kind: "areaModel", props: { a: Math.floor(p.a), b: p.b } } }] },
    },
    explainBackSpec: { prompt: `说说为什么 ${expr} 的结果比 ${fmt(p.a)} 小，${fmt(p.b)} 是什么意思？`, requiredElements: ["why_smaller", "tenths_meaning"] },
    transferSpec: { description: "换数字、保持“乘以十分之几”的结构，无提示完成", passCriteria: "精确答案正确" },
  };
}

function productOf(challenge: LearningChallenge): DecimalProduct {
  const nums = parseNumbers(challenge.learnerPrompt);
  const a = nums[0] ?? 0;
  const b = nums[1] ?? 0;
  return { a, b, product: Math.round(a * b * 1000) / 1000, band: challenge.difficultyBand };
}

function hasMagnitudeEvidence(history: DisciplineEvidence[]): boolean {
  return history.some((e) => e.kind === "magnitude_estimate" && e.hypothesisSupport.some((s) => s.hypothesisId === "intuition_gap" && s.direction === "weakens"));
}

function interpretText(challenge: LearningChallenge, event: EvidenceEvent, text: string, history: DisciplineEvidence[]): DisciplineEvidence[] {
  const p = productOf(challenge);
  const base = { evidenceId: `ev-${event.eventId}`, eventId: event.eventId };
  const tenths = Math.round(p.b * 10);
  const meaning = new RegExp(`十分之${["零","一","二","三","四","五","六","七","八","九"][tenths] ?? ""}|${tenths}\\s*个\\s*0\\.1|${tenths}/10`);
  if (meaning.test(text)) return [{ ...base, kind: "tenths_meaning", summary: `把 ${fmt(p.b)} 说成十分之几`, hypothesisSupport: [{ hypothesisId: "representation_gap", direction: "weakens" }] }];

  const smaller = /(比|比较|会|应该)?\s*(小|少|变小|小于)/.test(text) && !/大/.test(text);
  const larger = /(大|变大|大于|多)/.test(text) && !/小/.test(text);
  const nums = parseNumbers(text);
  const answer = nums.find((n) => n !== p.a && n !== p.b);

  if (answer !== undefined && event.payload.type !== "UTTERANCE") {
    if (Math.abs(answer - p.product) < 1e-9) return [{ ...base, kind: "exact_answer", summary: `算出 ${answer}`, hypothesisSupport: [{ hypothesisId: "rigor_chain_gap", direction: "weakens" }] }];
    // 错误答案的差异诊断：已知直觉正确 → 更支持严谨链条断点；否则两个候选并存
    const support = hasMagnitudeEvidence(history)
      ? [{ hypothesisId: "rigor_chain_gap" as const, direction: "supports" as const }]
      : [{ hypothesisId: "intuition_gap" as const, direction: "supports" as const }, { hypothesisId: "rigor_chain_gap" as const, direction: "supports" as const }];
    return [{ ...base, kind: "wrong_answer", summary: `算出 ${answer}`, hypothesisSupport: support }];
  }
  if (smaller) return [{ ...base, kind: "magnitude_estimate", summary: "判断结果会变小", hypothesisSupport: [{ hypothesisId: "intuition_gap", direction: "weakens" }] }];
  if (larger) return [{ ...base, kind: "magnitude_estimate", summary: "判断结果会变大", hypothesisSupport: [{ hypothesisId: "intuition_gap", direction: "supports" }] }];
  if (answer !== undefined) return [{ ...base, kind: Math.abs(answer - p.product) < 1e-9 ? "exact_answer" : "estimate", summary: `提到 ${answer}`, hypothesisSupport: [] }];
  return [{ ...base, kind: "utterance", summary: text.slice(0, 40), hypothesisSupport: [] }];
}

export const mathPlugin: DisciplinePlugin = {
  manifest: {
    id: "math",
    displayName: "数学心智插件",
    version: "0.1.0",
    semanticObjectKinds: ["tenthsBar", "numberLine", "label", "arrow", "highlight", "areaModel"],
    thinkingMoves: ["conjecture", "model", "experiment", "argue", "verify", "transfer"],
    artifactTypes: ["canvas", "explainBack"],
    curriculumVersions: ["人教版五上/小数乘法"],
  },
  createChallenge(input) {
    const band = input.difficultyBand === "lower" ? "lower" : "base";
    return buildChallenge(PRODUCTS[band] ?? PRODUCTS.base!, `math-decimal-${band}`, input);
  },
  interpretEvent(challenge, event, history) {
    const p = event.payload;
    if (p.type === "STROKE") return [{ evidenceId: `ev-${event.eventId}`, eventId: event.eventId, kind: "representation_attempt", summary: "画了表示", hypothesisSupport: [] }];
    if (p.type === "UTTERANCE" || p.type === "ANSWER" || p.type === "EXPLAIN") return interpretText(challenge, event, p.text, history);
    return [];
  },
  isExpectedEvidenceMet(challenge, evidence) {
    return challenge.expectedEvidence.every((k) => evidence.some((e) => e.kind === k && (k !== "magnitude_estimate" || e.hypothesisSupport.some((s) => s.direction === "weakens"))));
  },
  checkExplainBack(challenge, text) {
    const p = productOf(challenge);
    const missing: string[] = [];
    if (!/(小|少|变小|小于)/.test(text) || !/(因为|所以|才|只剩|只有)/.test(text)) missing.push("why_smaller");
    const tenths = Math.round(p.b * 10);
    if (!new RegExp(`十分之|${tenths}\\s*个\\s*0\\.1|0\\.1|位值`).test(text)) missing.push("tenths_meaning");
    return { passed: missing.length === 0, missing };
  },
  createTransfer(challenge) {
    const t = buildChallenge(PRODUCTS.transfer!, `${challenge.challengeId}-transfer`, { curriculumAnchor: challenge.curriculumAnchor, probeFamilyId: challenge.probeFamilyId });
    return { ...t, learnerPrompt: `换一个：${fmt(PRODUCTS.transfer!.a)} × ${fmt(PRODUCTS.transfer!.b)} 是多少？这次不给提示，直接说答案和你的想法。`, expectedEvidence: ["exact_answer"] };
  },
  checkTransferAnswer(transfer, text) {
    const p = productOf(transfer);
    return parseNumbers(text).some((n) => n !== p.a && n !== p.b && Math.abs(n - p.product) < 1e-9);
  },
  discriminatingProbes(challenge): DiscriminatingProbe[] {
    const p = productOf(challenge);
    return [
      { id: "magnitude-first", question: `算之前先说：结果会比 ${fmt(p.a)} 大还是小？`, outcomes: {
        smaller: [{ hypothesisId: "intuition_gap", direction: "weakens" }, { hypothesisId: "rigor_chain_gap", direction: "supports" }],
        larger: [{ hypothesisId: "intuition_gap", direction: "supports" }, { hypothesisId: "rigor_chain_gap", direction: "weakens" }],
      } },
      { id: "self-check", question: "你能自己检查一下这个结果吗？", outcomes: {
        selfCorrects: [{ hypothesisId: "verification_gap", direction: "weakens" }, { hypothesisId: "rigor_chain_gap", direction: "supports" }],
        noCheck: [{ hypothesisId: "verification_gap", direction: "supports" }, { hypothesisId: "rigor_chain_gap", direction: "weakens" }],
      } },
      { id: "no-decimal-point", question: `${fmt(Math.round(p.a * 10))} × ${fmt(Math.round(p.b * 10))} 呢？`, outcomes: {
        correct: [{ hypothesisId: "representation_gap", direction: "supports" }, { hypothesisId: "rigor_chain_gap", direction: "weakens" }],
        wrong: [{ hypothesisId: "representation_gap", direction: "weakens" }, { hypothesisId: "rigor_chain_gap", direction: "supports" }],
      } },
    ];
  },
};
```

```ts
// packages/plugin-math/src/index.ts
// 数学心智插件出口。
export { MATH_HYPOTHESES, mathPlugin, parseNumbers } from "./decimal-multiplication.js";
```

- [ ] **Step 4：安装并跑测试**

Run: `pnpm install && pnpm --filter @ai-scholar/plugin-math test && pnpm --filter @ai-scholar/plugin-math typecheck`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/plugin-math pnpm-lock.yaml
git commit -m "实现数学心智插件小数乘法薄切片与区分性探针

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 8：RealtimeBridge 接口、脚本回放桥接与家长接管桥接

**Files:**
- Create: `packages/learning-kernel/src/bridge.ts`
- Create: `packages/learning-kernel/src/bridges/scripted-replay-bridge.ts`
- Create: `packages/learning-kernel/src/bridges/parent-coach-bridge.ts`
- Modify: `packages/learning-kernel/src/index.ts`（加三行导出）
- Test: `packages/learning-kernel/test/bridges.test.ts`

**Interfaces:**
- Consumes: `TeachingProposal`（Task 1）、`LearningChallenge`、`DisciplineEvidence`（Task 5）、`SessionState`（Task 2）。
- Produces: `TurnPurpose`、`TurnContext`、`RealtimeBridge`、`ScriptedReplayBridge`、`ReplayScript`、`ParentCoachBridge`、`ParentInput`。

- [ ] **Step 1：写失败测试**

```ts
// packages/learning-kernel/test/bridges.test.ts
import { describe, expect, test } from "vitest";
import { ParentCoachBridge } from "../src/bridges/parent-coach-bridge.js";
import { ScriptedReplayBridge } from "../src/bridges/scripted-replay-bridge.js";
import type { TurnContext } from "../src/bridge.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

const challenge = fakePlugin.createChallenge({ curriculumAnchor: "fake/unit-1" });
const turn = (purpose: TurnContext["purpose"], allowedMaxHintLevel = 1): TurnContext => ({
  sessionId: "s-1", purpose, state: "INTERVENING", hintLevel: 0, allowedMaxHintLevel, challenge, recentEvidence: [], recentEvents: [], rejectionReasons: [],
});

describe("ScriptedReplayBridge", () => {
  test("按顺序返回脚本中的提案，purpose 不匹配时报错，脚本耗尽时报错", async () => {
    const bridge = new ScriptedReplayBridge({ scriptVersion: 1, turns: [
      { purpose: "hint", proposal: { proposalId: "p-1", spokenResponse: "一", learnerTask: "t", canvasActions: [], expectedEvidence: [], hintLevel: 1 } },
      { proposal: { proposalId: "p-2", spokenResponse: "二", learnerTask: "t", canvasActions: [], expectedEvidence: [], hintLevel: 2 } },
    ] });
    await bridge.start("s-1");
    expect((await bridge.requestProposal(turn("hint"))).proposalId).toBe("p-1");
    expect((await bridge.requestProposal(turn("explainBackPrompt"))).proposalId).toBe("p-2");
    await expect(bridge.requestProposal(turn("hint"))).rejects.toThrow(/脚本已耗尽/);
  });
  test("purpose 不匹配立即报错，不静默跳过", async () => {
    const bridge = new ScriptedReplayBridge({ scriptVersion: 1, turns: [{ purpose: "hint", proposal: { proposalId: "p-1", spokenResponse: "", learnerTask: "t", canvasActions: [], expectedEvidence: [], hintLevel: 1 } }] });
    await expect(bridge.requestProposal(turn("transferPrompt"))).rejects.toThrow(/purpose/);
  });
  test("kind 是 scripted，不冒充 codex", () => {
    expect(new ScriptedReplayBridge({ scriptVersion: 1, turns: [] }).kind).toBe("scripted");
  });
});

describe("ParentCoachBridge", () => {
  test("请求挂起直到家长提交；提交必须标注提示级别", async () => {
    const bridge = new ParentCoachBridge();
    const pending = bridge.requestProposal(turn("hint", 2));
    expect(bridge.pending()?.purpose).toBe("hint");
    expect(() => bridge.submit({ spokenResponse: "你确定了什么？", learnerTask: "说说", hintLevel: Number.NaN })).toThrow(/提示级别/);
    bridge.submit({ spokenResponse: "你确定了什么？", learnerTask: "说说", hintLevel: 1 });
    const proposal = await pending;
    expect(proposal).toMatchObject({ spokenResponse: "你确定了什么？", hintLevel: 1, canvasActions: [] });
    expect(proposal.proposalId).toMatch(/^parent-/);
    expect(bridge.pending()).toBeNull();
  });
  test("没有挂起请求时提交报错", () => {
    expect(() => new ParentCoachBridge().submit({ spokenResponse: "x", learnerTask: "y", hintLevel: 0 })).toThrow(/没有等待中的请求/);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/learning-kernel test -- bridges`
Expected: 失败，找不到模块。

- [ ] **Step 3：实现**

```ts
// packages/learning-kernel/src/bridge.ts
// RealtimeBridge（设计稿 10.8、11.3）：内核只认这个接口。三种实现输出同一个 TeachingProposal；
// 只有 codex 是 AI 模型路径，scripted 与 parent 不生成内容、不冒充在线。Codex 协议字段不得出现在这里。
import type { EvidenceEvent, TeachingProposal } from "@ai-scholar/session-contracts";
import type { DisciplineEvidence, LearningChallenge } from "./challenge.js";
import type { SessionState } from "./session-state.js";

export type TurnPurpose = "hint" | "explainBackPrompt" | "transferPrompt" | "softLanding" | "contestFollowUp";

export interface TurnContext {
  sessionId: string;
  purpose: TurnPurpose;
  state: SessionState;
  hintLevel: number;
  /** 本地内核授权的本轮最高提示级别；提案超过即被拒 */
  allowedMaxHintLevel: number;
  challenge: LearningChallenge;
  recentEvidence: DisciplineEvidence[];
  recentEvents: EvidenceEvent[];
  /** 上一次提案被拒的原因，供重述 */
  rejectionReasons: string[];
}

export interface RealtimeBridge {
  readonly kind: "codex" | "scripted" | "parent";
  start(sessionId: string): Promise<void>;
  requestProposal(turn: TurnContext): Promise<TeachingProposal>;
  stop(): Promise<void>;
}
```

```ts
// packages/learning-kernel/src/bridges/scripted-replay-bridge.ts
// 脚本回放桥接：按固定脚本逐轮返回提案，用于确定性测试（正常、越级、非法画布、转写错误等场景）。
// 脚本的 purpose 若与内核请求不一致立即报错，避免测试静默错位。
import type { TeachingProposal } from "@ai-scholar/session-contracts";
import type { RealtimeBridge, TurnContext, TurnPurpose } from "../bridge.js";

export interface ReplayScript {
  scriptVersion: 1;
  turns: Array<{ purpose?: TurnPurpose | undefined; proposal: TeachingProposal }>;
}

export class ScriptedReplayBridge implements RealtimeBridge {
  readonly kind = "scripted" as const;
  private cursor = 0;
  readonly requests: TurnContext[] = [];

  constructor(private readonly script: ReplayScript) {}

  async start(_sessionId: string): Promise<void> { this.cursor = 0; }

  async requestProposal(turn: TurnContext): Promise<TeachingProposal> {
    this.requests.push(turn);
    const entry = this.script.turns[this.cursor];
    if (!entry) throw new Error(`脚本已耗尽：第 ${this.cursor + 1} 轮没有提案（purpose=${turn.purpose}）`);
    if (entry.purpose && entry.purpose !== turn.purpose) throw new Error(`脚本第 ${this.cursor + 1} 轮 purpose 不匹配：期望 ${entry.purpose}，内核请求 ${turn.purpose}`);
    this.cursor += 1;
    return entry.proposal;
  }

  async stop(): Promise<void> {}
}
```

```ts
// packages/learning-kernel/src/bridges/parent-coach-bridge.ts
// 家长接管桥接：内核的提案请求挂起，家长在控制台输入一句话、一个动作与提示级别后才返回。
// 家长必须标注提示级别（设计稿 10.8），否则预算与退出趋势失真。
import type { CanvasAction, TeachingProposal } from "@ai-scholar/session-contracts";
import type { RealtimeBridge, TurnContext } from "../bridge.js";

export interface ParentInput {
  spokenResponse: string;
  learnerTask: string;
  hintLevel: number;
  canvasActions?: CanvasAction[] | undefined;
}

export class ParentCoachBridge implements RealtimeBridge {
  readonly kind = "parent" as const;
  private waiting: { turn: TurnContext; resolve: (p: TeachingProposal) => void } | null = null;
  private counter = 0;

  async start(_sessionId: string): Promise<void> {}

  requestProposal(turn: TurnContext): Promise<TeachingProposal> {
    if (this.waiting) throw new Error("上一轮家长输入尚未完成");
    return new Promise((resolve) => { this.waiting = { turn, resolve }; });
  }

  pending(): TurnContext | null { return this.waiting?.turn ?? null; }

  submit(input: ParentInput): TeachingProposal {
    if (!this.waiting) throw new Error("没有等待中的请求");
    if (!Number.isInteger(input.hintLevel) || input.hintLevel < 0 || input.hintLevel > 5) throw new Error("家长输入必须标注 0–5 的提示级别");
    this.counter += 1;
    const proposal: TeachingProposal = {
      proposalId: `parent-${this.counter}`, spokenResponse: input.spokenResponse, learnerTask: input.learnerTask,
      canvasActions: input.canvasActions ?? [], expectedEvidence: [], hintLevel: input.hintLevel,
    };
    const { resolve } = this.waiting;
    this.waiting = null;
    resolve(proposal);
    return proposal;
  }

  async stop(): Promise<void> { this.waiting = null; }
}
```

`index.ts` 追加：

```ts
export * from "./bridge.js";
export * from "./bridges/scripted-replay-bridge.js";
export * from "./bridges/parent-coach-bridge.js";
```

- [ ] **Step 4：跑测试与类型检查**

Run: `pnpm --filter @ai-scholar/learning-kernel test && pnpm --filter @ai-scholar/learning-kernel typecheck`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/learning-kernel
git commit -m "定义 RealtimeBridge 接口并实现脚本回放与家长接管桥接

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 9：会话存储（内存 + SQLite）与快照策略

**Files:**
- Create: `packages/learning-kernel/src/store.ts`
- Create: `packages/learning-kernel/src/sqlite-store.ts`
- Modify: `packages/learning-kernel/src/index.ts`（加两行导出）
- Test: `packages/learning-kernel/test/store.test.ts`

**Interfaces:**
- Consumes: `StoredEvent`（Task 4）、`SessionContext`（Task 2）、`LearningChallenge`（Task 5）、`ChildOutbound`、`TeachingProposal`（Task 1）。
- Produces: `SessionStore` 接口、`SessionSnapshot`、`ProposalRecord`、`InMemorySessionStore`、`SqliteSessionStore`（`node:sqlite`）、`shouldSnapshot(input)`。

- [ ] **Step 1：写失败测试（同一套用例跑两种实现）**

```ts
// packages/learning-kernel/test/store.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { createSessionContext } from "../src/session-state.js";
import { InMemorySessionStore, shouldSnapshot, type SessionStore } from "../src/store.js";
import { SqliteSessionStore } from "../src/sqlite-store.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

const dir = mkdtempSync(join(tmpdir(), "ai-scholar-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const challenge = fakePlugin.createChallenge({ curriculumAnchor: "fake/unit-1" });
const stored = (id: string, seq: number) => ({
  event: { eventId: id, clientSessionId: "s-1", deviceId: "d", clientSeq: seq, occurredAt: seq, quality: "confirmed" as const, source: "child_button" as const, semanticObjectIds: [], payload: { type: "DONE" as const } },
  serverSeq: seq, receivedAt: 1_000 + seq, contentHash: `h-${id}`,
});

const impls: Array<[string, () => SessionStore]> = [
  ["内存", () => new InMemorySessionStore()],
  ["SQLite", () => new SqliteSessionStore(join(dir, `${Math.random().toString(16).slice(2)}.sqlite`))],
];

for (const [name, make] of impls) {
  describe(`${name} 存储`, () => {
    test("会话、事件、出站消息、提案、快照都能写入并读回", () => {
      const store = make();
      store.createSession({ sessionId: "s-1", discipline: "fake", challenge, createdAt: 1 });
      store.appendEvent("s-1", stored("e-1", 1));
      store.appendEvent("s-1", stored("e-2", 2));
      expect(store.listEvents("s-1").map((e) => e.event.eventId)).toEqual(["e-1", "e-2"]);

      store.saveOutbound("s-1", "e-1", [{ type: "notice", id: "o-1", text: "hi" }]);
      expect(store.getOutbound("s-1", "e-1")).toEqual([{ type: "notice", id: "o-1", text: "hi" }]);
      expect(store.getOutbound("s-1", "e-9")).toBeNull();

      store.saveProposal("s-1", { proposalId: "p-1", accepted: false, reasons: ["hint:notOneLevelUp"], proposal: { proposalId: "p-1", spokenResponse: "", learnerTask: "t", canvasActions: [], expectedEvidence: [], hintLevel: 3 }, decidedAt: 5 });
      expect(store.listProposals("s-1")[0]).toMatchObject({ proposalId: "p-1", accepted: false });

      const ctx = { ...createSessionContext(), state: "INDEPENDENT" as const };
      store.saveSnapshot("s-1", { snapshotSeq: 1, context: ctx, lastConfirmedSeq: 2, challenge, transferChallenge: null, evidence: [], createdAt: 9 });
      expect(store.latestSnapshot("s-1")).toMatchObject({ snapshotSeq: 1, lastConfirmedSeq: 2, context: { state: "INDEPENDENT" } });
      expect(store.latestSnapshot("nope")).toBeNull();
    });

    test("同一 event_id 重复写入不报错也不重复", () => {
      const store = make();
      store.createSession({ sessionId: "s-1", discipline: "fake", challenge, createdAt: 1 });
      store.appendEvent("s-1", stored("e-1", 1));
      store.appendEvent("s-1", stored("e-1", 1));
      expect(store.listEvents("s-1")).toHaveLength(1);
    });
  });
}

describe("快照策略（设计稿 12）", () => {
  test("状态转换、100 条事件或 30 秒，先到者触发", () => {
    expect(shouldSnapshot({ stateChanged: true, eventsSinceSnapshot: 0, msSinceSnapshot: 0 })).toBe(true);
    expect(shouldSnapshot({ stateChanged: false, eventsSinceSnapshot: 100, msSinceSnapshot: 0 })).toBe(true);
    expect(shouldSnapshot({ stateChanged: false, eventsSinceSnapshot: 3, msSinceSnapshot: 30_000 })).toBe(true);
    expect(shouldSnapshot({ stateChanged: false, eventsSinceSnapshot: 99, msSinceSnapshot: 29_999 })).toBe(false);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/learning-kernel test -- store`
Expected: 失败，找不到模块。

- [ ] **Step 3：实现**

```ts
// packages/learning-kernel/src/store.ts
// 会话存储接口与内存实现。宿主用 SQLite 实现，测试用内存实现，两者跑同一套契约测试。
// 只存事件、出站消息（供重放幂等）、提案裁决与快照；长期成长记录不在这里（阶段 1 不实现 GrowthLedgerService）。
import type { ChildOutbound, TeachingProposal } from "@ai-scholar/session-contracts";
import type { DisciplineEvidence, LearningChallenge } from "./challenge.js";
import type { StoredEvent } from "./event-log.js";
import type { SessionContext } from "./session-state.js";

export interface SessionRecord { sessionId: string; discipline: string; challenge: LearningChallenge; createdAt: number }

export interface ProposalRecord {
  proposalId: string;
  accepted: boolean;
  reasons: string[];
  proposal: TeachingProposal;
  decidedAt: number;
}

export interface SessionSnapshot {
  snapshotSeq: number;
  context: SessionContext;
  lastConfirmedSeq: number;
  challenge: LearningChallenge;
  transferChallenge: LearningChallenge | null;
  evidence: DisciplineEvidence[];
  createdAt: number;
}

export interface SessionStore {
  createSession(record: SessionRecord): void;
  getSession(sessionId: string): SessionRecord | null;
  appendEvent(sessionId: string, stored: StoredEvent): void;
  listEvents(sessionId: string): StoredEvent[];
  saveOutbound(sessionId: string, eventId: string, messages: ChildOutbound[]): void;
  getOutbound(sessionId: string, eventId: string): ChildOutbound[] | null;
  saveProposal(sessionId: string, record: ProposalRecord): void;
  listProposals(sessionId: string): ProposalRecord[];
  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): void;
  latestSnapshot(sessionId: string): SessionSnapshot | null;
}

export const SNAPSHOT_EVERY_EVENTS = 100;
export const SNAPSHOT_EVERY_MS = 30_000;

export function shouldSnapshot(input: { stateChanged: boolean; eventsSinceSnapshot: number; msSinceSnapshot: number }): boolean {
  return input.stateChanged || input.eventsSinceSnapshot >= SNAPSHOT_EVERY_EVENTS || input.msSinceSnapshot >= SNAPSHOT_EVERY_MS;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly events = new Map<string, Map<string, StoredEvent>>();
  private readonly outbound = new Map<string, ChildOutbound[]>();
  private readonly proposals = new Map<string, ProposalRecord[]>();
  private readonly snapshots = new Map<string, SessionSnapshot[]>();

  createSession(record: SessionRecord): void { this.sessions.set(record.sessionId, record); }
  getSession(sessionId: string): SessionRecord | null { return this.sessions.get(sessionId) ?? null; }
  appendEvent(sessionId: string, stored: StoredEvent): void {
    const bucket = this.events.get(sessionId) ?? new Map<string, StoredEvent>();
    if (!bucket.has(stored.event.eventId)) bucket.set(stored.event.eventId, stored);
    this.events.set(sessionId, bucket);
  }
  listEvents(sessionId: string): StoredEvent[] { return [...(this.events.get(sessionId)?.values() ?? [])].sort((a, b) => a.serverSeq - b.serverSeq); }
  saveOutbound(sessionId: string, eventId: string, messages: ChildOutbound[]): void { this.outbound.set(`${sessionId}/${eventId}`, messages); }
  getOutbound(sessionId: string, eventId: string): ChildOutbound[] | null { return this.outbound.get(`${sessionId}/${eventId}`) ?? null; }
  saveProposal(sessionId: string, record: ProposalRecord): void { this.proposals.set(sessionId, [...(this.proposals.get(sessionId) ?? []), record]); }
  listProposals(sessionId: string): ProposalRecord[] { return [...(this.proposals.get(sessionId) ?? [])]; }
  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): void { this.snapshots.set(sessionId, [...(this.snapshots.get(sessionId) ?? []), snapshot]); }
  latestSnapshot(sessionId: string): SessionSnapshot | null { const list = this.snapshots.get(sessionId) ?? []; return list[list.length - 1] ?? null; }
}
```

```ts
// packages/learning-kernel/src/sqlite-store.ts
// SQLite 会话存储（Node 22 内置 node:sqlite，无外部依赖）。结构化元数据进表，JSON 列只放小对象；
// 大作品与附件将来走文件目录（设计稿 11.2），不塞进这里。
import { DatabaseSync } from "node:sqlite";
import type { ChildOutbound } from "@ai-scholar/session-contracts";
import type { StoredEvent } from "./event-log.js";
import type { ProposalRecord, SessionRecord, SessionSnapshot, SessionStore } from "./store.js";

export class SqliteSessionStore implements SessionStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, discipline TEXT NOT NULL, challenge_json TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, client_seq INTEGER NOT NULL, server_seq INTEGER NOT NULL,
        content_hash TEXT NOT NULL, quality TEXT NOT NULL, event_json TEXT NOT NULL, received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session ON events(session_id, server_seq);
      CREATE TABLE IF NOT EXISTS outbound (session_id TEXT NOT NULL, event_id TEXT NOT NULL, messages_json TEXT NOT NULL, PRIMARY KEY (session_id, event_id));
      CREATE TABLE IF NOT EXISTS proposals (session_id TEXT NOT NULL, proposal_id TEXT NOT NULL, accepted INTEGER NOT NULL, reasons_json TEXT NOT NULL, proposal_json TEXT NOT NULL, decided_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (session_id TEXT NOT NULL, snapshot_seq INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (session_id, snapshot_seq));
    `);
  }

  createSession(record: SessionRecord): void {
    this.db.prepare("INSERT OR REPLACE INTO sessions (session_id, discipline, challenge_json, created_at) VALUES (?, ?, ?, ?)")
      .run(record.sessionId, record.discipline, JSON.stringify(record.challenge), record.createdAt);
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db.prepare("SELECT session_id, discipline, challenge_json, created_at FROM sessions WHERE session_id = ?").get(sessionId) as
      { session_id: string; discipline: string; challenge_json: string; created_at: number } | undefined;
    return row ? { sessionId: row.session_id, discipline: row.discipline, challenge: JSON.parse(row.challenge_json), createdAt: row.created_at } : null;
  }

  appendEvent(sessionId: string, stored: StoredEvent): void {
    this.db.prepare("INSERT OR IGNORE INTO events (event_id, session_id, client_seq, server_seq, content_hash, quality, event_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(stored.event.eventId, sessionId, stored.event.clientSeq, stored.serverSeq, stored.contentHash, stored.event.quality, JSON.stringify(stored.event), stored.receivedAt);
  }

  listEvents(sessionId: string): StoredEvent[] {
    const rows = this.db.prepare("SELECT event_json, server_seq, received_at, content_hash FROM events WHERE session_id = ? ORDER BY server_seq").all(sessionId) as
      Array<{ event_json: string; server_seq: number; received_at: number; content_hash: string }>;
    return rows.map((r) => ({ event: JSON.parse(r.event_json), serverSeq: r.server_seq, receivedAt: r.received_at, contentHash: r.content_hash }));
  }

  saveOutbound(sessionId: string, eventId: string, messages: ChildOutbound[]): void {
    this.db.prepare("INSERT OR REPLACE INTO outbound (session_id, event_id, messages_json) VALUES (?, ?, ?)").run(sessionId, eventId, JSON.stringify(messages));
  }

  getOutbound(sessionId: string, eventId: string): ChildOutbound[] | null {
    const row = this.db.prepare("SELECT messages_json FROM outbound WHERE session_id = ? AND event_id = ?").get(sessionId, eventId) as { messages_json: string } | undefined;
    return row ? (JSON.parse(row.messages_json) as ChildOutbound[]) : null;
  }

  saveProposal(sessionId: string, record: ProposalRecord): void {
    this.db.prepare("INSERT INTO proposals (session_id, proposal_id, accepted, reasons_json, proposal_json, decided_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sessionId, record.proposalId, record.accepted ? 1 : 0, JSON.stringify(record.reasons), JSON.stringify(record.proposal), record.decidedAt);
  }

  listProposals(sessionId: string): ProposalRecord[] {
    const rows = this.db.prepare("SELECT proposal_id, accepted, reasons_json, proposal_json, decided_at FROM proposals WHERE session_id = ? ORDER BY rowid").all(sessionId) as
      Array<{ proposal_id: string; accepted: number; reasons_json: string; proposal_json: string; decided_at: number }>;
    return rows.map((r) => ({ proposalId: r.proposal_id, accepted: r.accepted === 1, reasons: JSON.parse(r.reasons_json), proposal: JSON.parse(r.proposal_json), decidedAt: r.decided_at }));
  }

  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): void {
    this.db.prepare("INSERT OR REPLACE INTO snapshots (session_id, snapshot_seq, snapshot_json, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, snapshot.snapshotSeq, JSON.stringify(snapshot), snapshot.createdAt);
  }

  latestSnapshot(sessionId: string): SessionSnapshot | null {
    const row = this.db.prepare("SELECT snapshot_json FROM snapshots WHERE session_id = ? ORDER BY snapshot_seq DESC LIMIT 1").get(sessionId) as { snapshot_json: string } | undefined;
    return row ? (JSON.parse(row.snapshot_json) as SessionSnapshot) : null;
  }

  close(): void { this.db.close(); }
}
```

`index.ts` 追加：

```ts
export * from "./store.js";
export * from "./sqlite-store.js";
```

- [ ] **Step 4：跑测试与类型检查**

Run: `pnpm --filter @ai-scholar/learning-kernel test && pnpm --filter @ai-scholar/learning-kernel typecheck`
Expected: PASS。Node 22 会打印 `ExperimentalWarning: SQLite`，不是错误。

- [ ] **Step 5：提交**

```bash
git add packages/learning-kernel
git commit -m "实现会话存储：内存与 SQLite 双实现及快照策略

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 10：会话编排器

**Files:**
- Create: `packages/learning-kernel/src/orchestrator.ts`
- Modify: `packages/learning-kernel/src/index.ts`（加 `export * from "./orchestrator.js";`）
- Test: `packages/learning-kernel/test/orchestrator.test.ts`

**Interfaces:**
- Consumes: 前面所有内核模块。
- Produces: `SessionOrchestrator`（`start()`、`acceptEvent(event): AppendResult` 同步落盘、`processAccepted(stored): Promise<ChildOutbound[]>` 异步教学、`handleEvent(event)` = 两者合一、`tick(nowMs)`、`context`、`challenge`、`evidence`、`snapshotNow()`）、`OrchestratorDeps`、`HandleResult`。网关用 accept/process 拆开，好让 ack 立即返回、教学输出稍后推送。

编排规则（写在代码注释里，也是测试依据）：
1. 事件先进 `EventLog` 与存储；重放返回原出站消息；序号缺口返回 `seqGap`，不进入教学逻辑。
2. `UTTERANCE` 且 `quality === "unconfirmed"` → `transcriptUncertain`，发 `confirmTranscript`；`CONFIRM_TRANSCRIPT` 确认后按 `corrected` 文本重新解释。
3. 已确认的 `STROKE/UTTERANCE/ANSWER/EXPLAIN/SELECT/DRAG` 先交插件解释成证据，再发 `childOutput` 信号；`STROKE` 的 `contentHash` 若在“已擦除哈希集合”里则 `isNewStrategy=false`。
4. `INDEPENDENT` 下证据满足 `expectedEvidence` 或收到 `DONE` → `childDone`。
5. `ASSESSING` 由本地判定：证据齐 → `EXPLAIN_BACK`；`evaluateEscalation` 允许 → `INTERVENING` 并向桥接要 `hint`；被硬预算或软预算拒绝 → `SOFT_LANDING`；只是缺新产出 → 停在 `ASSESSING` 等待。
6. 提案校验失败 → 记录并带原因重试一次；再失败 → 发 `notice("等我一下。")`，教学状态不变。
7. 提示被接受：发 `speak`、`canvasAction`、`learnerTask`，记录 Agent 对象 id；4 级 → `demoIssued`，随后立刻发 `removeObject` 撤掉示范。
8. `INTERVENING` 下孩子新产出 → 撤回 Agent 提示对象，回到 `INDEPENDENT`。
9. `EXPLAIN_BACK` 收到 `EXPLAIN` → 插件判定；通过 → `TRANSFER`（迁移挑战 `learnerTask`，提示归零）；否则 → `ASSESSING`。
10. `TRANSFER` 收到 `ANSWER` → 通过 → `COMPLETED`（阶段 1 无记忆候选）；失败 → `SOFT_LANDING` 并发 `softLanding`。
11. `SOFT_LANDING_CHOICE`：simpler → 低难度带新挑战并回 `INDEPENDENT`；hint → 辅助提示；stop → `COMPLETED`。
12. 儿童控制权事件：`HELP_REQUEST` → `ASSESSING`（走第 5 条）；`PAUSE_REQUEST`/`RESUME_REQUEST`；`CONTEST` → 冻结最近提案 id，发 `speak("哪里和你的想法不一样？")`（0 级，不计预算）。
13. `tick(now)`：`INDEPENDENT` 下距最近新策略 ≥ 初始窗口 → `windowExpired`；距窗口开始 ≥ 硬上限 → `hardCapReached`；`WAITING_CONFIRMATION` 超 60 秒 → `confirmationTimeout`。
14. 每次状态变化、100 条事件或 30 秒落一次快照。

- [ ] **Step 1：写失败测试（覆盖设计稿 15.3 的八个脚本场景）**

```ts
// packages/learning-kernel/test/orchestrator.test.ts
import { describe, expect, test } from "vitest";
import type { ChildOutbound, EvidenceEvent, TeachingProposal } from "@ai-scholar/session-contracts";
import { ScriptedReplayBridge, type ReplayScript } from "../src/bridges/scripted-replay-bridge.js";
import { SessionOrchestrator } from "../src/orchestrator.js";
import { InMemorySessionStore } from "../src/store.js";
import { fakePlugin } from "./helpers/fake-plugin.js";

// 用假插件：答案 42 正确，讲回含“因为”通过；提示阶梯来自挑战本身
const P = (id: string, hintLevel: number, patch: Partial<TeachingProposal> = {}): TeachingProposal => ({
  proposalId: id, spokenResponse: `提示${hintLevel}`, learnerTask: "试试看", canvasActions: [], expectedEvidence: [], hintLevel, ...patch,
});

function harness(turns: ReplayScript["turns"], now = { t: 0 }) {
  const bridge = new ScriptedReplayBridge({ scriptVersion: 1, turns });
  const store = new InMemorySessionStore();
  const orch = new SessionOrchestrator({ sessionId: "s-1", plugin: fakePlugin, bridge, store, clock: () => now.t, challengeInput: { curriculumAnchor: "fake/unit-1" } });
  let seq = 0;
  const send = (payload: EvidenceEvent["payload"], quality: EvidenceEvent["quality"] = "confirmed") => {
    seq += 1;
    return orch.handleEvent({ eventId: `e-${seq}`, clientSessionId: "s-1", deviceId: "d", clientSeq: seq, occurredAt: now.t, quality, source: "child_voice", semanticObjectIds: [], payload });
  };
  return { orch, bridge, store, send, now };
}

const types = (msgs: ChildOutbound[]) => msgs.map((m) => m.type);

describe("主路径：独立完成 → 讲回 → 迁移 → 完成", () => {
  test("孩子独立给出表示与答案，不经过评估直接讲回，迁移成功后 COMPLETED", async () => {
    const h = harness([]);
    const started = await h.orch.start();
    expect(h.orch.context.state).toBe("INDEPENDENT");
    expect(types(started)).toEqual(["stateChanged", "learnerTask"]);

    await h.send({ type: "STROKE", strokeId: "st-1", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    const done = await h.send({ type: "ANSWER", text: "42" });
    expect(h.orch.context.state).toBe("EXPLAIN_BACK");
    expect(done.outbound.find((m) => m.type === "learnerTask")).toMatchObject({ text: "说说为什么这样做成立。" });

    await h.send({ type: "EXPLAIN", text: "因为两边一样多" });
    expect(h.orch.context.state).toBe("TRANSFER");
    expect(h.orch.context.hintLevel).toBe(0);

    await h.send({ type: "ANSWER", text: "42" });
    expect(h.orch.context.state).toBe("COMPLETED");
    expect(h.orch.context.independentSuccess).toBe(true);
    expect(h.bridge.requests).toHaveLength(0);   // 全程没有请求过桥接
    expect(h.store.latestSnapshot("s-1")?.context.state).toBe("COMPLETED");
  });
});

describe("15.3 场景：答错但仍在有效探索", () => {
  test("错误本身不触发提示，孩子继续产出就一直 INDEPENDENT", async () => {
    const h = harness([]);
    await h.orch.start();
    await h.send({ type: "ANSWER", text: "41" });
    await h.send({ type: "STROKE", strokeId: "st-1", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    expect(h.orch.context.state).toBe("INDEPENDENT");
    expect(h.orch.evidence.map((e) => e.kind)).toEqual(["wrong_answer", "representation"]);
  });
});

describe("15.3 场景：沉默但正在画 / 窗口到期", () => {
  test("持续新笔迹延长窗口；擦掉后重画相同内容不算新策略；无新策略 30 秒后进入评估并给 1 级提示", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    h.now.t = 20_000;
    await h.send({ type: "STROKE", strokeId: "st-1", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    h.now.t = 45_000;
    expect(await h.orch.tick(45_000)).toEqual([]);           // 20s 时有新策略，窗口顺延到 50s
    await h.send({ type: "ERASE", strokeId: "st-1", contentHash: "h1" });
    await h.send({ type: "STROKE", strokeId: "st-2", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    h.now.t = 50_500;
    const out = await h.orch.tick(50_500);                    // 重画相同内容不延长
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 1, escalationCount: 1 });
    expect(types(out)).toEqual(["stateChanged", "stateChanged", "speak", "learnerTask"]);
    expect(h.bridge.requests[0]).toMatchObject({ purpose: "hint", allowedMaxHintLevel: 1 });
  });

  test("硬上限 240 秒即使一直有新笔迹也进入评估", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    for (let i = 1; i <= 9; i += 1) {
      h.now.t = i * 25_000;
      await h.send({ type: "STROKE", strokeId: `st-${i}`, contentHash: `h${i}`, bounds: { x: 0, y: 0, width: 1, height: 1 } });
    }
    await h.orch.tick(240_000);
    expect(h.orch.context.state).toBe("INTERVENING");
  });
});

describe("15.3 场景：主动求助与提示阶梯", () => {
  test("求助 → 1 级；新产出后撤回提示回到 0 级；再求助 → 2 级；第三次求助被软预算挡住直到有实质性尝试", async () => {
    const h = harness([
      { purpose: "hint", proposal: P("p-1", 1) },
      { purpose: "hint", proposal: P("p-2", 2, { canvasActions: [{ kind: "upsertObject", object: { id: "agent-frame", owner: "agent", kind: "label", props: {} } }] }) },
      { purpose: "hint", proposal: P("p-3", 3) },
    ]);
    await h.orch.start();
    await h.send({ type: "STROKE", strokeId: "st-0", contentHash: "h0", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 1 });

    const back = await h.send({ type: "STROKE", strokeId: "st-1", contentHash: "h1", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    expect(h.orch.context).toMatchObject({ state: "INDEPENDENT", hintLevel: 0, maxHintLevelUsed: 1 });
    expect(types(back.outbound)).toEqual(["stateChanged"]);

    const second = await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 2, escalationCount: 2 });
    expect(second.outbound.filter((m) => m.type === "canvasAction")).toHaveLength(1);

    // 撤回 2 级提示时要把 Agent 放上去的对象删掉
    const withdraw = await h.send({ type: "ANSWER", text: "40" });
    expect(withdraw.outbound.find((m) => m.type === "canvasAction")).toMatchObject({ action: { kind: "removeObject", objectId: "agent-frame" } });

    // 第三次求助：软预算已用完，但有实质性尝试且再次求助 → 允许并标记非独立成功
    await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 3, independentSuccess: false });
  });

  test("上次提示后没有新产出时再求助：停在 ASSESSING 等待，不连续升级", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    await h.send({ type: "HELP_REQUEST" });
    await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "ASSESSING", hintLevel: 1 });
    expect(h.bridge.requests).toHaveLength(1);
  });

  test("4 级演示后进入 RECONSTRUCT，示范对象被立即撤下，重建后讲回", async () => {
    const h = harness([
      { purpose: "hint", proposal: P("p-1", 1) }, { purpose: "hint", proposal: P("p-2", 2) }, { purpose: "hint", proposal: P("p-3", 3) },
      { purpose: "hint", proposal: P("p-4", 4, { canvasActions: [{ kind: "upsertObject", object: { id: "agent-demo", owner: "agent", kind: "label", props: {} } }] }) },
    ]);
    await h.orch.start();
    for (let i = 1; i <= 4; i += 1) {
      await h.send({ type: "ANSWER", text: `${i}` });
      await h.send({ type: "HELP_REQUEST" });
    }
    expect(h.orch.context).toMatchObject({ state: "RECONSTRUCT", hintLevel: 4, maxHintLevelUsed: 4 });
    const last = h.store.getOutbound("s-1", "e-8") ?? [];
    expect(last.filter((m) => m.type === "canvasAction").map((m) => (m as { action: { kind: string } }).action.kind)).toEqual(["upsertObject", "removeObject"]);
    await h.send({ type: "ANSWER", text: "42" });
    expect(h.orch.context.state).toBe("EXPLAIN_BACK");
  });
});

describe("15.3 场景：语音转写错误", () => {
  test("unconfirmed 转写先请求确认，不参与证据；确认并修正后按修正文本解释", async () => {
    const h = harness([]);
    await h.orch.start();
    const r = await h.send({ type: "UTTERANCE", text: "四十一" }, "unconfirmed");
    expect(h.orch.context.state).toBe("WAITING_CONFIRMATION");
    expect(r.outbound.find((m) => m.type === "confirmTranscript")).toMatchObject({ targetEventId: "e-1", text: "四十一" });
    expect(h.orch.evidence).toEqual([]);
    await h.send({ type: "CONFIRM_TRANSCRIPT", targetEventId: "e-1", confirmed: true, correctedText: "42" });
    expect(h.orch.context.state).toBe("INDEPENDENT");
    expect(h.orch.evidence.map((e) => e.kind)).toEqual(["utterance"]);
  });
  test("60 秒无回应：回原状态，转写永久 unconfirmed", async () => {
    const h = harness([]);
    await h.orch.start();
    await h.send({ type: "UTTERANCE", text: "嗯" }, "unconfirmed");
    await h.orch.tick(61_000);
    expect(h.orch.context.state).toBe("INDEPENDENT");
    expect(h.orch.evidence).toEqual([]);
  });
});

describe("15.3 场景：模型越级与非法画布对象", () => {
  test("越级提案被拒并带原因重试；重试合规则采用", async () => {
    const h = harness([{ purpose: "hint", proposal: P("bad", 3) }, { purpose: "hint", proposal: P("good", 1) }]);
    await h.orch.start();
    await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 1 });
    expect(h.bridge.requests[1]?.rejectionReasons).toEqual(["hint:notOneLevelUp"]);
    expect(h.store.listProposals("s-1").map((p) => [p.proposalId, p.accepted])).toEqual([["bad", false], ["good", true]]);
  });
  test("两次都不合规：发等待提示，教学状态不变，级别仍为 0", async () => {
    const illegal = P("x", 1, { canvasActions: [{ kind: "upsertObject", object: { id: "z", owner: "agent", kind: "notAKind", props: {} } }] });
    const h = harness([{ purpose: "hint", proposal: illegal }, { purpose: "hint", proposal: { ...illegal, proposalId: "y" } }]);
    await h.orch.start();
    const r = await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 0, escalationCount: 0 });
    expect(r.outbound.find((m) => m.type === "notice")).toMatchObject({ text: "等我一下。" });
  });
});

describe("15.3 场景：孩子反驳 Agent", () => {
  test("异议冻结最近提案，停止追问并问“哪里和你的想法不一样？”，状态不变、不计提示", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    await h.send({ type: "HELP_REQUEST" });
    const r = await h.send({ type: "CONTEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 1, frozenTargetIds: ["p-1"] });
    expect(r.outbound.find((m) => m.type === "speak")).toMatchObject({ text: "哪里和你的想法不一样？", hintLevel: 0 });
  });
});

describe("15.3 场景：迁移失败与软着陆", () => {
  test("迁移失败 → 软着陆三选项；选“换简单的”进入辅助轮，新挑战难度带 lower，提示归零", async () => {
    const h = harness([]);
    await h.orch.start();
    await h.send({ type: "STROKE", strokeId: "s", contentHash: "h", bounds: { x: 0, y: 0, width: 1, height: 1 } });
    await h.send({ type: "ANSWER", text: "42" });
    await h.send({ type: "EXPLAIN", text: "因为" });
    const failed = await h.send({ type: "ANSWER", text: "41" });
    expect(h.orch.context).toMatchObject({ state: "SOFT_LANDING", assistedRound: true });
    expect(failed.outbound.find((m) => m.type === "softLanding")).toMatchObject({ options: ["simpler", "hint", "stop"] });

    await h.send({ type: "SOFT_LANDING_CHOICE", choice: "simpler" });
    expect(h.orch.context).toMatchObject({ state: "INDEPENDENT", assistedRound: true, hintLevel: 0 });
    expect(h.orch.challenge.difficultyBand).toBe("lower");
  });
  test("辅助轮里迁移成功也只是 COMPLETED，且提案里的记忆候选会被拒", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1, { memoryCandidate: { description: "会了", evidenceEventIds: [] } }) }, { purpose: "hint", proposal: P("p-2", 1) }]);
    await h.orch.start();
    await h.send({ type: "ANSWER", text: "1" });
    await h.send({ type: "EXPLAIN", text: "因为" });     // INDEPENDENT 下 EXPLAIN 只是产出
    await h.send({ type: "DONE" });
    await h.send({ type: "EXPLAIN", text: "因为" });
    await h.send({ type: "ANSWER", text: "0" });          // 迁移失败
    await h.send({ type: "SOFT_LANDING_CHOICE", choice: "hint" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", assistedRound: true, hintLevel: 1 });
    expect(h.store.listProposals("s-1")[0]).toMatchObject({ proposalId: "p-1", accepted: false, reasons: ["memory:assistedRound"] });
  });
});

describe("暂停与恢复", () => {
  test("任何活动状态可暂停；继续后回原状态且不继承提示", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    await h.send({ type: "HELP_REQUEST" });
    const paused = await h.send({ type: "PAUSE_REQUEST", by: "child" });
    expect(h.orch.context).toMatchObject({ state: "PAUSED_CHILD", priorState: "INTERVENING" });
    expect(paused.outbound.find((m) => m.type === "stateChanged")).toMatchObject({ presence: "paused" });
    await h.send({ type: "RESUME_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 0 });
  });
});

describe("桥接不可用", () => {
  test("桥接抛错时不伪装正常：告诉孩子暂时没法提示，画布照常，教学状态不变", async () => {
    const h = harness([]);   // 空脚本 → 第一次请求即“脚本已耗尽”
    await h.orch.start();
    const r = await h.send({ type: "HELP_REQUEST" });
    expect(h.orch.context).toMatchObject({ state: "INTERVENING", hintLevel: 0 });
    expect(r.outbound.find((m) => m.type === "notice")).toMatchObject({ text: "现在没法给你提示，你可以先接着画。" });
  });
});

describe("幂等与序号", () => {
  test("重放同一事件返回同样的出站消息，不重复推进；序号缺口不进入教学逻辑", async () => {
    const h = harness([{ purpose: "hint", proposal: P("p-1", 1) }]);
    await h.orch.start();
    const first = await h.send({ type: "HELP_REQUEST" });
    const replay = await h.orch.handleEvent({ eventId: "e-1", clientSessionId: "s-1", deviceId: "d", clientSeq: 1, occurredAt: 0, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload: { type: "HELP_REQUEST" } });
    expect(replay.append.kind).toBe("duplicate");
    expect(replay.outbound).toEqual(first.outbound);
    const gap = await h.orch.handleEvent({ eventId: "e-9", clientSessionId: "s-1", deviceId: "d", clientSeq: 9, occurredAt: 0, quality: "confirmed", source: "child_voice", semanticObjectIds: [], payload: { type: "DONE" } });
    expect(gap.append).toEqual({ kind: "seqGap", expectedSeq: 2 });
    expect(h.orch.context.state).toBe("INTERVENING");
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/learning-kernel test -- orchestrator`
Expected: 失败，找不到模块。

- [ ] **Step 3：实现编排器**

```ts
// packages/learning-kernel/src/orchestrator.ts
// 会话编排器：把儿童端事件变成状态机信号，按 5.0 表推进，在需要教学动作时向 RealtimeBridge 要提案、
// 经本地校验后转成儿童端出站消息，并把事件、提案裁决与快照落盘。时钟注入，窗口与超时用 tick(now) 驱动，便于确定性测试。
import type { ChildOutbound, EvidenceEvent, TeachingProposal } from "@ai-scholar/session-contracts";
import type { RealtimeBridge, TurnContext, TurnPurpose } from "./bridge.js";
import type { ChallengeInput, DisciplineEvidence, LearningChallenge } from "./challenge.js";
import { EventLog, type AppendResult, type StoredEvent } from "./event-log.js";
import { clampBudget, evaluateEscalation, nextHintRung, type InterventionBudget } from "./hint-budget.js";
import type { DisciplinePlugin } from "./plugin.js";
import { validateProposal } from "./proposal-validator.js";
import { createSessionContext, transition, type SessionContext, type Signal } from "./session-state.js";
import { shouldSnapshot, type SessionStore } from "./store.js";

export interface OrchestratorDeps {
  sessionId: string;
  plugin: DisciplinePlugin;
  bridge: RealtimeBridge;
  store: SessionStore;
  clock: () => number;
  challengeInput: ChallengeInput;
  confirmationTimeoutMs?: number | undefined;
}

export interface HandleResult { append: AppendResult; outbound: ChildOutbound[] }

const CONFIRMATION_TIMEOUT_MS = 60_000;
const WAIT_NOTICE = "等我一下。";
const BRIDGE_DOWN_NOTICE = "现在没法给你提示，你可以先接着画。";

// 出站消息去掉 id 后的分配型联合（Omit 直接作用在联合上会丢掉各成员字段）
type OutboundBody = { [K in ChildOutbound["type"]]: Omit<Extract<ChildOutbound, { type: K }>, "id"> }[ChildOutbound["type"]];
const CONTEST_QUESTION = "哪里和你的想法不一样？";
const SOFT_LANDING_MESSAGE = "这是在试，不是考试。你想换一个更简单的、看看一个提示，还是今天先到这里？";

export class SessionOrchestrator {
  context: SessionContext = createSessionContext();
  challenge: LearningChallenge;
  transferChallenge: LearningChallenge | null = null;
  evidence: DisciplineEvidence[] = [];
  private budget: InterventionBudget;
  private readonly log = new EventLog();
  private readonly erasedHashes = new Set<string>();
  private readonly agentObjectIds: string[] = [];
  private readonly childObjectIds: string[] = [];
  private lastProposalId: string | null = null;
  private windowStartedAt = 0;
  private lastNewStrategyAt = 0;
  private confirmationAskedAt: number | null = null;
  private pendingUnconfirmed = new Map<string, EvidenceEvent>();
  private outboundCounter = 0;
  private snapshotSeq = 0;
  private eventsSinceSnapshot = 0;
  private lastSnapshotAt = 0;

  constructor(private readonly deps: OrchestratorDeps) {
    this.challenge = deps.plugin.createChallenge(deps.challengeInput);
    this.budget = clampBudget(this.challenge.interventionBudget);
  }

  async start(): Promise<ChildOutbound[]> {
    const now = this.deps.clock();
    this.deps.store.createSession({ sessionId: this.deps.sessionId, discipline: this.deps.plugin.manifest.id, challenge: this.challenge, createdAt: now });
    await this.deps.bridge.start(this.deps.sessionId);
    const out: ChildOutbound[] = [];
    this.apply({ kind: "challengeValidated" }, out);
    this.beginWindow(now);
    out.push(this.msg({ type: "learnerTask", text: this.challenge.learnerPrompt }));
    this.snapshotIfNeeded(true, now);
    return out;
  }

  /** 第一步：同步进日志与存储。重放/缺口/冲突在这里就能回答，不等教学逻辑 */
  acceptEvent(event: EvidenceEvent): AppendResult {
    const append = this.log.append(event, this.deps.clock());
    if (append.kind === "appended") {
      this.deps.store.appendEvent(this.deps.sessionId, append.stored);
      this.eventsSinceSnapshot += 1;
    }
    return append;
  }

  /** 第二步：对已落盘的新事件跑教学逻辑，产出儿童端消息并按事件 id 存起来供重放 */
  async processAccepted(stored: StoredEvent): Promise<ChildOutbound[]> {
    const now = this.deps.clock();
    const before = this.context.state;
    const out: ChildOutbound[] = [];
    await this.route(stored.event, out, now);
    this.deps.store.saveOutbound(this.deps.sessionId, stored.event.eventId, out);
    this.snapshotIfNeeded(before !== this.context.state, now);
    return out;
  }

  async handleEvent(event: EvidenceEvent): Promise<HandleResult> {
    const append = this.acceptEvent(event);
    if (append.kind === "duplicate") return { append, outbound: this.deps.store.getOutbound(this.deps.sessionId, event.eventId) ?? [] };
    if (append.kind !== "appended") return { append, outbound: [] };
    return { append, outbound: await this.processAccepted(append.stored) };
  }

  async tick(now: number): Promise<ChildOutbound[]> {
    const out: ChildOutbound[] = [];
    const before = this.context.state;
    if (this.context.state === "INDEPENDENT") {
      if (now - this.windowStartedAt >= this.challenge.independencePolicy.hardCapMs) {
        this.apply({ kind: "hardCapReached" }, out);
        await this.assess(out);
      } else if (now - this.lastNewStrategyAt >= this.challenge.independencePolicy.initialWindowMs) {
        this.apply({ kind: "windowExpired" }, out);
        await this.assess(out);
      }
    } else if (this.context.state === "INTERVENING" && now - this.lastNewStrategyAt >= this.challenge.independencePolicy.initialWindowMs && !this.context.newOutputSinceLastHint) {
      this.apply({ kind: "noNewOutputWillingToContinue" }, out);
      await this.assess(out);
    } else if (this.context.state === "WAITING_CONFIRMATION" && this.confirmationAskedAt !== null && now - this.confirmationAskedAt >= (this.deps.confirmationTimeoutMs ?? CONFIRMATION_TIMEOUT_MS)) {
      this.apply({ kind: "confirmationTimeout" }, out);
      this.confirmationAskedAt = null;
      this.pendingUnconfirmed.clear();
    }
    this.snapshotIfNeeded(before !== this.context.state, now);
    return out;
  }

  snapshotNow(): void { this.snapshotIfNeeded(true, this.deps.clock()); }

  // ---- 事件路由 ----
  private async route(event: EvidenceEvent, out: ChildOutbound[], now: number): Promise<void> {
    const p = event.payload;
    switch (p.type) {
      case "PAUSE_REQUEST": this.apply({ kind: "pauseRequest" }, out); return;
      case "RESUME_REQUEST": this.apply({ kind: "resume" }, out); return;
      case "CONTEST":
        if (this.apply({ kind: "contest", targetId: p.targetId ?? this.lastProposalId ?? undefined }, out)) {
          out.push(this.msg({ type: "speak", text: CONTEST_QUESTION, hintLevel: 0, interruptible: true }));
        }
        return;
      case "HELP_REQUEST":
        if (this.apply({ kind: "helpRequest" }, out)) await this.assess(out);
        return;
      case "DONE":
        if (this.context.state === "INDEPENDENT" && this.apply({ kind: "childDone" }, out)) this.enterExplainBack(out);
        return;
      case "CONFIRM_TRANSCRIPT": {
        const original = this.pendingUnconfirmed.get(p.targetEventId);
        if (this.apply({ kind: "transcriptConfirmed" }, out)) {
          this.confirmationAskedAt = null;
          this.pendingUnconfirmed.delete(p.targetEventId);
          if (p.confirmed && original && original.payload.type === "UTTERANCE") {
            const text = p.correctedText ?? original.payload.text;
            const confirmed: EvidenceEvent = { ...original, quality: p.correctedText ? "corrected" : "confirmed", payload: { type: "UTTERANCE", text } };
            await this.handleChildOutput(confirmed, out, now);
          }
        }
        return;
      }
      case "SOFT_LANDING_CHOICE": await this.handleSoftLandingChoice(p.choice, out, now); return;
      case "MEMORY_ASSENT": this.apply({ kind: "memoryAssent", choice: p.choice }, out); return;
      case "ERASE": this.erasedHashes.add(p.contentHash); this.apply({ kind: "childOutput", isNewStrategy: false }, out); return;
      case "UTTERANCE":
        if (event.quality === "unconfirmed") {
          if (this.apply({ kind: "transcriptUncertain" }, out)) {
            this.pendingUnconfirmed.set(event.eventId, event);
            this.confirmationAskedAt = now;
            out.push(this.msg({ type: "confirmTranscript", targetEventId: event.eventId, text: p.text }));
          }
          return;
        }
        await this.handleChildOutput(event, out, now);
        return;
      case "STROKE": case "ANSWER": case "EXPLAIN": case "SELECT": case "DRAG":
        if (p.type === "STROKE") this.childObjectIds.push(p.strokeId);
        await this.handleChildOutput(event, out, now);
        return;
    }
  }

  private async handleChildOutput(event: EvidenceEvent, out: ChildOutbound[], now: number): Promise<void> {
    const p = event.payload;
    const isNewStrategy = !(p.type === "STROKE" && this.erasedHashes.has(p.contentHash));
    const state = this.context.state;
    const current = state === "TRANSFER" && this.transferChallenge ? this.transferChallenge : this.challenge;
    const fresh = this.deps.plugin.interpretEvent(current, event, this.evidence);
    this.evidence.push(...fresh);
    if (isNewStrategy) this.lastNewStrategyAt = now;

    if (state === "EXPLAIN_BACK" && p.type === "EXPLAIN") {
      const verdict = this.deps.plugin.checkExplainBack(this.challenge, p.text);
      if (verdict.passed) { if (this.apply({ kind: "explainBackPassed" }, out)) this.enterTransfer(out, now); }
      else if (this.apply({ kind: "explainBackRevealedGap" }, out)) await this.assess(out);
      return;
    }
    if (state === "TRANSFER" && p.type === "ANSWER" && this.transferChallenge) {
      if (this.deps.plugin.checkTransferAnswer(this.transferChallenge, p.text)) this.apply({ kind: "transferSucceeded", hasMemoryCandidate: false }, out);
      else if (this.apply({ kind: "transferFailed" }, out)) out.push(this.msg({ type: "softLanding", message: SOFT_LANDING_MESSAGE, options: ["simpler", "hint", "stop"] }));
      return;
    }
    if (state === "RECONSTRUCT" && (p.type === "ANSWER" || p.type === "EXPLAIN")) {
      this.apply({ kind: "childOutput", isNewStrategy }, out);
      if (this.apply({ kind: "reconstructDone" }, out)) this.enterExplainBack(out);
      return;
    }

    const wasIntervening = state === "INTERVENING";
    if (!this.apply({ kind: "childOutput", isNewStrategy }, out)) return;
    if (wasIntervening && this.context.state === "INDEPENDENT") this.withdrawAgentObjects(out);
    if (this.context.state === "INDEPENDENT" && this.deps.plugin.isExpectedEvidenceMet(this.challenge, this.evidence)) {
      if (this.apply({ kind: "childDone" }, out)) this.enterExplainBack(out);
    }
  }

  // ---- 评估与提示 ----
  private async assess(out: ChildOutbound[]): Promise<void> {
    if (this.context.state !== "ASSESSING") return;
    if (this.deps.plugin.isExpectedEvidenceMet(this.challenge, this.evidence)) {
      if (this.apply({ kind: "assessedIndependentSolution" }, out)) this.enterExplainBack(out);
      return;
    }
    const rung = nextHintRung(this.context);
    const verdict = evaluateEscalation(this.context, rung, this.budget);
    if (verdict.allowed) {
      if (this.apply({ kind: "assessedRecoverable" }, out)) await this.requestHint(rung, out);
      return;
    }
    if (verdict.reason === "noNewOutputSinceLastHint") {
      out.push(this.msg({ type: "stateChanged", state: this.context.state, hintLevel: this.context.hintLevel, presence: "waiting" }));
      return;
    }
    if (this.apply({ kind: "assessedBudgetExhausted" }, out)) out.push(this.msg({ type: "softLanding", message: SOFT_LANDING_MESSAGE, options: ["simpler", "hint", "stop"] }));
  }

  private async requestHint(level: number, out: ChildOutbound[]): Promise<void> {
    const turn = this.turn("hint", level);
    let proposal: TeachingProposal;
    let result: ReturnType<SessionOrchestrator["validate"]>;
    try {
      proposal = await this.deps.bridge.requestProposal(turn);
      result = this.validate(proposal);
      if (!result.accepted) {
        proposal = await this.deps.bridge.requestProposal({ ...turn, rejectionReasons: result.reasons });
        result = this.validate(proposal);
      }
    } catch {
      // 设计稿 13：桥接不可用就明说，不伪装正常，也不换模型；画布照常
      out.push(this.msg({ type: "notice", text: BRIDGE_DOWN_NOTICE }));
      return;
    }
    if (!result.accepted) { out.push(this.msg({ type: "notice", text: WAIT_NOTICE })); return; }

    this.apply({ kind: "hintIssued", level: proposal.hintLevel, liftsSoftBudget: result.liftsSoftBudget }, out);
    this.lastProposalId = proposal.proposalId;
    // 提示发出后重新计等待窗口，避免下一秒就因“无新产出”回到评估
    this.lastNewStrategyAt = this.deps.clock();
    this.emitProposal(proposal, out);
    if (proposal.hintLevel === 4 && this.apply({ kind: "demoIssued" }, out)) {
      this.withdrawAgentObjects(out);
      out.push(this.msg({ type: "learnerTask", text: proposal.learnerTask }));
    }
  }

  private validate(proposal: TeachingProposal) {
    const result = validateProposal({ proposal, context: this.context, budget: this.budget, plugin: this.deps.plugin, protectedObjectIds: this.childObjectIds });
    this.deps.store.saveProposal(this.deps.sessionId, { proposalId: proposal.proposalId, accepted: result.accepted, reasons: result.accepted ? [] : result.reasons, proposal, decidedAt: this.deps.clock() });
    return result;
  }

  private emitProposal(proposal: TeachingProposal, out: ChildOutbound[]): void {
    out.push(this.msg({ type: "speak", text: proposal.spokenResponse, hintLevel: proposal.hintLevel, interruptible: true }));
    for (const action of proposal.canvasActions) {
      if (action.kind === "upsertObject") this.agentObjectIds.push(action.object.id);
      out.push(this.msg({ type: "canvasAction", action }));
    }
    out.push(this.msg({ type: "learnerTask", text: proposal.learnerTask }));
  }

  private withdrawAgentObjects(out: ChildOutbound[]): void {
    for (const objectId of this.agentObjectIds.splice(0)) out.push(this.msg({ type: "canvasAction", action: { kind: "removeObject", objectId } }));
  }

  private enterExplainBack(out: ChildOutbound[]): void {
    out.push(this.msg({ type: "learnerTask", text: this.challenge.explainBackSpec.prompt }));
  }

  private enterTransfer(out: ChildOutbound[], now: number): void {
    this.transferChallenge = this.deps.plugin.createTransfer(this.challenge);
    this.beginWindow(now);
    out.push(this.msg({ type: "learnerTask", text: this.transferChallenge.learnerPrompt }));
  }

  private async handleSoftLandingChoice(choice: "simpler" | "hint" | "stop", out: ChildOutbound[], now: number): Promise<void> {
    if (!this.apply({ kind: "softLandingChoice", choice }, out)) return;
    if (choice === "simpler") {
      this.challenge = this.deps.plugin.createChallenge({ ...this.deps.challengeInput, difficultyBand: "lower" });
      this.budget = clampBudget(this.challenge.interventionBudget);
      this.transferChallenge = null;
      this.evidence = [];
      this.apply({ kind: "challengeValidated" }, out);
      this.beginWindow(now);
      out.push(this.msg({ type: "learnerTask", text: this.challenge.learnerPrompt }));
    } else if (choice === "hint") {
      await this.requestHint(Math.min(nextHintRung(this.context), this.budget.maxHintLevel), out);
    }
  }

  // ---- 工具 ----
  private apply(signal: Signal, out: ChildOutbound[]): boolean {
    const before = this.context.state;
    const result = transition(this.context, signal);
    this.context = result.context;
    if (!result.ok) return false;
    if (this.context.state !== before) {
      const presence = this.context.state === "PAUSED_CHILD" || this.context.state === "PAUSED_TECH" ? "paused" : this.context.state === "WAITING_CONFIRMATION" ? "waiting" : "listening";
      out.push(this.msg({ type: "stateChanged", state: this.context.state, hintLevel: this.context.hintLevel, presence }));
    }
    return true;
  }

  private turn(purpose: TurnPurpose, allowedMaxHintLevel: number): TurnContext {
    return {
      sessionId: this.deps.sessionId, purpose, state: this.context.state, hintLevel: this.context.hintLevel, allowedMaxHintLevel,
      challenge: this.challenge, recentEvidence: this.evidence.slice(-10), recentEvents: this.log.all().slice(-10).map((s) => s.event), rejectionReasons: [],
    };
  }

  private beginWindow(now: number): void { this.windowStartedAt = now; this.lastNewStrategyAt = now; }

  private msg(body: OutboundBody): ChildOutbound {
    this.outboundCounter += 1;
    return { ...body, id: `o-${this.outboundCounter}` } as ChildOutbound;
  }

  private snapshotIfNeeded(stateChanged: boolean, now: number): void {
    if (!shouldSnapshot({ stateChanged, eventsSinceSnapshot: this.eventsSinceSnapshot, msSinceSnapshot: now - this.lastSnapshotAt })) return;
    this.snapshotSeq += 1;
    this.deps.store.saveSnapshot(this.deps.sessionId, {
      snapshotSeq: this.snapshotSeq, context: this.context, lastConfirmedSeq: this.log.lastConfirmedSeq,
      challenge: this.challenge, transferChallenge: this.transferChallenge, evidence: this.evidence, createdAt: now,
    });
    this.eventsSinceSnapshot = 0;
    this.lastSnapshotAt = now;
  }
}
```

- [ ] **Step 4：跑测试与类型检查，逐个修到全绿**

Run: `pnpm --filter @ai-scholar/learning-kernel test && pnpm --filter @ai-scholar/learning-kernel typecheck`
Expected: PASS。若某场景期望的出站消息顺序与实现不一致，以设计稿规则为准修实现，不改测试期望里的状态断言。

- [ ] **Step 5：提交**

```bash
git add packages/learning-kernel
git commit -m "实现会话编排器：事件路由、评估提示、讲回迁移与软着陆闭环

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 11：Mac mini 宿主：儿童端网关与家长控制台

**Files:**
- Create: `apps/agent-host/package.json`
- Create: `apps/agent-host/tsconfig.json`
- Create: `apps/agent-host/src/session-gateway.ts`
- Create: `apps/agent-host/src/server.ts`
- Create: `apps/agent-host/src/parent-console.html`
- Modify: `pnpm-workspace.yaml`（`packages` 加 `apps/agent-host`）
- Modify: `package.json`（scripts 加 `"host": "pnpm --filter @ai-scholar/agent-host start"`）
- Test: `apps/agent-host/test/session-gateway.test.ts`
- Test: `apps/agent-host/test/server.test.ts`

**Interfaces:**
- Consumes: `SessionOrchestrator`、`ParentCoachBridge`、`ScriptedReplayBridge`、`SqliteSessionStore`、`InMemorySessionStore`（内核）、`mathPlugin`、契约包 schema。
- Produces: `SessionHost`（`createSessionHost(options)`：管理会话 → 编排器映射；`open(sessionId)` 返回初始帧；`handleFrame(sessionId, raw, now)` **只返回 ack/nack/error**，教学输出经 `subscribe(sessionId, listener)` 异步推送；`idle(sessionId)` 等待该会话处理链空闲；`parentBridge(sessionId)`、`parentView`、`submitParentProposal`、`tick`、`sessionIds`）、`buildHostServer(options)`（Fastify 实例，`/healthz`、`GET /session`(ws)、`GET /parent`、`GET /parent/sessions`、`GET /parent/sessions/:id`、`POST /parent/sessions/:id/proposal`、`POST /parent/sessions/:id/tick`）。
- 事件在会话内串行处理（一条处理链），保证教学逻辑按 clientSeq 顺序执行。

- [ ] **Step 1：写失败测试**

```ts
// apps/agent-host/test/session-gateway.test.ts
import { describe, expect, test } from "vitest";
import { InMemorySessionStore, ScriptedReplayBridge } from "@ai-scholar/learning-kernel";
import { mathPlugin } from "@ai-scholar/plugin-math";
import type { ServerFrame } from "@ai-scholar/session-contracts";
import { createSessionHost } from "../src/session-gateway.js";

const frame = (id: string, clientSeq: number, payload: unknown) => JSON.stringify({
  protocolVersion: 1, type: "event", id, clientSeq, sessionId: "s-1", sentAt: 1,
  event: { eventId: id, clientSessionId: "s-1", deviceId: "ipad", clientSeq, occurredAt: 1, quality: "confirmed", source: "child_button", semanticObjectIds: [], payload },
});

const scripted = () => new ScriptedReplayBridge({ scriptVersion: 1, turns: [] });

describe("会话网关", () => {
  test("首次打开会话返回初始出站消息；事件帧立即 ack，教学输出随后经订阅推送；非法 JSON 与未知类型返回 error", async () => {
    const host = createSessionHost({ plugin: mathPlugin, store: new InMemorySessionStore(), makeBridge: scripted, clock: () => 5 });
    const opened = await host.open("s-1");
    expect(opened.map((f) => f.type)).toEqual(["outbound", "outbound"]);
    const pushed: ServerFrame[] = [];
    host.subscribe("s-1", (frames) => pushed.push(...frames));

    const replies = await host.handleFrame("s-1", frame("f-1", 1, { type: "DONE" }), 10);
    expect(replies).toEqual([{ protocolVersion: 1, type: "ack", id: "f-1", clientSeq: 1, serverReceivedAt: 10 }]);
    await host.idle("s-1");
    expect(pushed.map((f) => f.type)).toEqual(["outbound", "outbound"]);   // stateChanged + 讲回任务

    expect((await host.handleFrame("s-1", "{bad", 11))[0]).toMatchObject({ type: "error", reason: "invalidJson" });
    expect((await host.handleFrame("s-1", JSON.stringify({ protocolVersion: 1, type: "nope" }), 12))[0]).toMatchObject({ type: "error", reason: "invalidFrame" });
  });

  test("序号缺口回 nack；重放同一帧回原 ack 并补发当时的出站消息", async () => {
    const host = createSessionHost({ plugin: mathPlugin, store: new InMemorySessionStore(), makeBridge: scripted, clock: () => 5 });
    await host.open("s-1");
    const pushed: ServerFrame[] = [];
    host.subscribe("s-1", (frames) => pushed.push(...frames));
    const first = await host.handleFrame("s-1", frame("f-1", 1, { type: "PAUSE_REQUEST", by: "child" }), 10);
    await host.idle("s-1");
    expect(await host.handleFrame("s-1", frame("f-3", 3, { type: "RESUME_REQUEST" }), 11)).toEqual([{ protocolVersion: 1, type: "nack", reason: "seqGap", expectedSeq: 2 }]);
    const replay = await host.handleFrame("s-1", frame("f-1", 1, { type: "PAUSE_REQUEST", by: "child" }), 99);
    expect(replay[0]).toEqual(first[0]);            // serverReceivedAt 仍是 10
    expect(replay.slice(1)).toEqual(pushed);         // 补发当时推送过的出站消息
  });

  test("家长桥接：求助后 pending 可见，家长提交后教学输出推送出来", async () => {
    const host = createSessionHost({ plugin: mathPlugin, store: new InMemorySessionStore(), makeBridge: (id) => host.parentBridge(id), clock: () => 5 });
    await host.open("s-1");
    const pushed: ServerFrame[] = [];
    host.subscribe("s-1", (frames) => pushed.push(...frames));
    expect((await host.handleFrame("s-1", frame("f-1", 1, { type: "HELP_REQUEST" }), 10))[0]?.type).toBe("ack");
    await new Promise((r) => setTimeout(r, 0));
    expect(host.parentView("s-1")).toMatchObject({ state: "INTERVENING", pending: { purpose: "hint", allowedMaxHintLevel: 1 } });
    host.submitParentProposal("s-1", { spokenResponse: "你现在已经确定了什么？", learnerTask: "说说", hintLevel: 1 });
    await host.idle("s-1");
    expect(pushed.some((f) => f.type === "outbound" && f.message.type === "speak")).toBe(true);
    expect(host.parentView("s-1")).toMatchObject({ state: "INTERVENING", hintLevel: 1, pending: null });
  });
});
```

```ts
// apps/agent-host/test/server.test.ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { buildHostServer } from "../src/server.js";

let baseUrl = "";
let app: Awaited<ReturnType<typeof buildHostServer>>;

beforeAll(async () => {
  app = await buildHostServer({ bridge: "parent", dataDir: null });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (typeof address === "object" && address) baseUrl = `127.0.0.1:${address.port}`;
});
afterAll(async () => { await app.close(); });

describe("宿主 HTTP/WS", () => {
  test("/healthz 与家长控制台页面可达", async () => {
    expect(await (await fetch(`http://${baseUrl}/healthz`)).json()).toEqual({ status: "ok", bridge: "parent" });
    const html = await (await fetch(`http://${baseUrl}/parent`)).text();
    expect(html).toContain("家长控制台");
  });

  test("WebSocket 打开会话收到 outbound，发事件收到 ack，家长 API 能看到状态并提交提案", async () => {
    const ws = new WebSocket(`ws://${baseUrl}/session?sessionId=s-ws`);
    const received: Array<{ type: string; message?: { type: string } }> = [];
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    await new Promise((r) => setTimeout(r, 50));
    expect(received.map((f) => f.type)).toEqual(["outbound", "outbound"]);

    ws.send(JSON.stringify({ protocolVersion: 1, type: "event", id: "f-1", clientSeq: 1, sessionId: "s-ws", sentAt: 1,
      event: { eventId: "f-1", clientSessionId: "s-ws", deviceId: "d", clientSeq: 1, occurredAt: 1, quality: "confirmed", source: "child_button", semanticObjectIds: [], payload: { type: "HELP_REQUEST" } } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(received.some((f) => f.type === "ack")).toBe(true);

    const view = await (await fetch(`http://${baseUrl}/parent/sessions/s-ws`)).json() as { state: string; pending: { purpose: string } | null };
    expect(view.state).toBe("INTERVENING");
    expect(view.pending?.purpose).toBe("hint");

    const res = await fetch(`http://${baseUrl}/parent/sessions/s-ws/proposal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spokenResponse: "你确定了什么？", learnerTask: "说说", hintLevel: 1 }) });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(received.some((f) => f.type === "outbound" && f.message?.type === "speak")).toBe(true);
    ws.close();
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/agent-host test`
Expected: 失败，包不存在。

- [ ] **Step 3：实现**

```json
// apps/agent-host/package.json
{
  "name": "@ai-scholar/agent-host",
  "private": true,
  "type": "module",
  "scripts": { "start": "tsx src/server.ts", "replay": "tsx src/replay-cli.ts", "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@ai-scholar/learning-kernel": "workspace:*",
    "@ai-scholar/plugin-math": "workspace:*",
    "@ai-scholar/session-contracts": "workspace:*",
    "@fastify/websocket": "^11.3.0",
    "fastify": "^5.12.3",
    "zod": "^4.5.4"
  },
  "devDependencies": { "ws": "^8.18.0", "@types/ws": "^8.18.0" }
}
```

```json
// apps/agent-host/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*.ts", "test/**/*.ts"] }
```

```ts
// apps/agent-host/src/session-gateway.ts
// 会话网关的纯逻辑：把 WebSocket 文本帧变成编排器调用，把编排器输出包成 ServerFrame。
// 一个进程内可同时承载多个会话；每个会话一个编排器与一个桥接实例。不碰 socket，便于测试。
import {
  ParentCoachBridge, SessionOrchestrator, type DisciplinePlugin, type ParentInput, type RealtimeBridge, type SessionStore, type TurnContext,
} from "@ai-scholar/learning-kernel";
import { SESSION_PROTOCOL_VERSION, clientFrameSchema, type ChildOutbound, type ServerFrame } from "@ai-scholar/session-contracts";

export interface SessionHostOptions {
  plugin: DisciplinePlugin;
  store: SessionStore;
  makeBridge: (sessionId: string) => RealtimeBridge;
  clock: () => number;
  curriculumAnchor?: string | undefined;
}

export interface ParentView {
  sessionId: string;
  state: string;
  hintLevel: number;
  assistedRound: boolean;
  challengePrompt: string;
  pending: { purpose: TurnContext["purpose"]; allowedMaxHintLevel: number } | null;
  recentEvidence: Array<{ kind: string; summary: string }>;
  policyErrors: number;
}

interface Live { orchestrator: SessionOrchestrator; bridge: RealtimeBridge; chain: Promise<void> }

export function createSessionHost(options: SessionHostOptions) {
  const sessions = new Map<string, Live>();
  const parentBridges = new Map<string, ParentCoachBridge>();
  const listeners = new Map<string, Set<(frames: ServerFrame[]) => void>>();
  const v = SESSION_PROTOCOL_VERSION;
  const wrap = (messages: ChildOutbound[]): ServerFrame[] => messages.map((message) => ({ protocolVersion: v, type: "outbound", message }));

  function live(sessionId: string): Live {
    const found = sessions.get(sessionId);
    if (!found) throw new Error(`会话 ${sessionId} 未打开`);
    return found;
  }

  /** 会话内串行：教学逻辑按事件顺序跑，tick 也排进同一条链 */
  function enqueue(sessionId: string, job: () => Promise<ChildOutbound[]>): void {
    const session = live(sessionId);
    session.chain = session.chain.then(async () => {
      const frames = wrap(await job());
      if (frames.length > 0) host.broadcast(sessionId, frames);
    }).catch(() => undefined);
  }

  const host = {
    /** 家长桥接按会话懒创建；makeBridge 返回它就让该会话走家长接管 */
    parentBridge(sessionId: string): ParentCoachBridge {
      const bridge = parentBridges.get(sessionId) ?? new ParentCoachBridge();
      parentBridges.set(sessionId, bridge);
      return bridge;
    },

    async open(sessionId: string): Promise<ServerFrame[]> {
      const existing = sessions.get(sessionId);
      if (existing) return [];
      const bridge = options.makeBridge(sessionId);
      if (bridge instanceof ParentCoachBridge) parentBridges.set(sessionId, bridge);
      const orchestrator = new SessionOrchestrator({
        sessionId, plugin: options.plugin, bridge, store: options.store, clock: options.clock,
        challengeInput: { curriculumAnchor: options.curriculumAnchor ?? options.plugin.manifest.curriculumVersions[0] ?? "" },
      });
      sessions.set(sessionId, { orchestrator, bridge, chain: Promise.resolve() });
      return wrap(await orchestrator.start());
    },

    /** 只回 ack/nack/error；教学输出经 subscribe 推送。重放时把当时的出站消息一并补发 */
    async handleFrame(sessionId: string, raw: string, now: number): Promise<ServerFrame[]> {
      let json: unknown;
      try { json = JSON.parse(raw); } catch { return [{ protocolVersion: v, type: "error", reason: "invalidJson" }]; }
      const parsed = clientFrameSchema.safeParse(json);
      if (!parsed.success) return [{ protocolVersion: v, type: "error", reason: "invalidFrame" }];
      const frame = parsed.data;
      const { orchestrator } = live(sessionId);
      const append = orchestrator.acceptEvent(frame.event);
      if (append.kind === "seqGap") return [{ protocolVersion: v, type: "nack", reason: "seqGap", expectedSeq: append.expectedSeq }];
      if (append.kind === "conflict") return [{ protocolVersion: v, type: "nack", reason: "payloadConflict", expectedSeq: frame.clientSeq }];
      if (append.kind === "duplicate") {
        const ack: ServerFrame = { protocolVersion: v, type: "ack", id: frame.id, clientSeq: frame.clientSeq, serverReceivedAt: append.stored.receivedAt };
        return [ack, ...wrap(options.store.getOutbound(sessionId, frame.event.eventId) ?? [])];
      }
      const stored = append.stored;
      enqueue(sessionId, () => orchestrator.processAccepted(stored));
      return [{ protocolVersion: v, type: "ack", id: frame.id, clientSeq: frame.clientSeq, serverReceivedAt: now }];
    },

    async tick(sessionId: string, now: number): Promise<void> {
      enqueue(sessionId, () => live(sessionId).orchestrator.tick(now));
      await host.idle(sessionId);
    },

    /** 等该会话的处理链空闲（测试与家长 API 用） */
    async idle(sessionId: string): Promise<void> { await live(sessionId).chain; },

    parentView(sessionId: string): ParentView {
      const { orchestrator } = live(sessionId);
      const bridge = parentBridges.get(sessionId);
      const pending = bridge?.pending() ?? null;
      return {
        sessionId, state: orchestrator.context.state, hintLevel: orchestrator.context.hintLevel, assistedRound: orchestrator.context.assistedRound,
        challengePrompt: orchestrator.challenge.learnerPrompt,
        pending: pending ? { purpose: pending.purpose, allowedMaxHintLevel: pending.allowedMaxHintLevel } : null,
        recentEvidence: orchestrator.evidence.slice(-10).map((e) => ({ kind: e.kind, summary: e.summary })),
        policyErrors: orchestrator.context.policyErrors.length,
      };
    },

    submitParentProposal(sessionId: string, input: ParentInput): void {
      const bridge = parentBridges.get(sessionId);
      if (!bridge) throw new Error(`会话 ${sessionId} 不是家长接管模式`);
      bridge.submit(input);
    },

    /** 编排器在 handleFrame 之外产生的输出（tick 触发的提示）通过监听器推给 socket */
    subscribe(sessionId: string, listener: (frames: ServerFrame[]) => void): () => void {
      const set = listeners.get(sessionId) ?? new Set();
      set.add(listener);
      listeners.set(sessionId, set);
      return () => { set.delete(listener); };
    },
    broadcast(sessionId: string, frames: ServerFrame[]): void {
      for (const listener of listeners.get(sessionId) ?? []) listener(frames);
    },
    sessionIds(): string[] { return [...sessions.keys()]; },
  };
  return host;
}

export type SessionHost = ReturnType<typeof createSessionHost>;
```

```ts
// apps/agent-host/src/server.ts
// Mac mini 宿主：家庭局域网明文 HTTP + ws://（用户裁决，见设计稿 11.4）。
// /session 是儿童端通道；/parent/* 是家长控制台（只在 Mac 上看，不给孩子看）。每秒对所有会话 tick 一次驱动窗口与超时。
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { z } from "zod";
import { InMemorySessionStore, ScriptedReplayBridge, SqliteSessionStore, type ReplayScript, type SessionStore } from "@ai-scholar/learning-kernel";
import { mathPlugin } from "@ai-scholar/plugin-math";
import { canvasActionSchema } from "@ai-scholar/session-contracts";
import { createSessionHost } from "./session-gateway.js";

const PORT = 8788;

export interface HostServerOptions {
  bridge: "parent" | "scripted";
  script?: ReplayScript | undefined;
  /** null = 内存库（测试）；undefined = 默认 ~/.ai-scholar */
  dataDir?: string | null | undefined;
  tickIntervalMs?: number | undefined;
}

const parentInputSchema = z.object({
  spokenResponse: z.string(),
  learnerTask: z.string().min(1),
  hintLevel: z.number().int().min(0).max(5),
  canvasActions: z.array(canvasActionSchema).optional(),
});

function openStore(dataDir: string | null | undefined): SessionStore {
  if (dataDir === null) return new InMemorySessionStore();
  const dir = dataDir ?? process.env.AI_SCHOLAR_DATA_DIR ?? join(homedir(), ".ai-scholar");
  mkdirSync(dir, { recursive: true });
  return new SqliteSessionStore(join(dir, "agent-host.sqlite"));
}

export async function buildHostServer(options: HostServerOptions) {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(websocket);
  const store = openStore(options.dataDir);
  const host = createSessionHost({
    plugin: mathPlugin, store, clock: () => Date.now(),
    makeBridge: (sessionId) => (options.bridge === "parent" ? host.parentBridge(sessionId) : new ScriptedReplayBridge(options.script ?? { scriptVersion: 1, turns: [] })),
  });
  const consoleHtml = readFileSync(new URL("./parent-console.html", import.meta.url), "utf8");

  app.get("/healthz", async () => ({ status: "ok", bridge: options.bridge }));

  app.get("/session", { websocket: true }, async (socket, request) => {
    const sessionId = (request.query as { sessionId?: string }).sessionId ?? `session-${Date.now()}`;
    const send = (frames: unknown[]) => { for (const f of frames) socket.send(JSON.stringify(f)); };
    const unsubscribe = host.subscribe(sessionId, send);
    send(await host.open(sessionId));
    socket.on("message", async (raw: Buffer | string) => send(await host.handleFrame(sessionId, raw.toString(), Date.now())));
    socket.on("close", () => { unsubscribe(); request.log.info({ sessionId }, "儿童端断开"); });
  });

  app.get("/parent", async (_request, reply) => reply.type("text/html; charset=utf-8").send(consoleHtml));
  app.get("/parent/sessions", async () => ({ sessions: host.sessionIds() }));
  app.get("/parent/sessions/:id", async (request, reply) => {
    try { return host.parentView((request.params as { id: string }).id); } catch (error) { return reply.code(404).send({ error: String(error) }); }
  });
  app.post("/parent/sessions/:id/proposal", async (request, reply) => {
    const parsed = parentInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      host.submitParentProposal((request.params as { id: string }).id, parsed.data);
      return { ok: true };
    } catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  app.post("/parent/sessions/:id/tick", async (request) => { await host.tick((request.params as { id: string }).id, Date.now()); return { ok: true }; });

  const interval = setInterval(() => { for (const id of host.sessionIds()) void host.tick(id, Date.now()); }, options.tickIntervalMs ?? 1_000);
  app.addHook("onClose", async () => { clearInterval(interval); if (store instanceof SqliteSessionStore) store.close(); });
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const bridge = process.argv.includes("--scripted") ? "scripted" : "parent";
  const scriptIndex = process.argv.indexOf("--script");
  const script = scriptIndex >= 0 ? (JSON.parse(readFileSync(process.argv[scriptIndex + 1] ?? "", "utf8")) as ReplayScript) : undefined;
  const app = await buildHostServer({ bridge, script });
  await app.listen({ host: "0.0.0.0", port: PORT });
}
```

```html
<!-- apps/agent-host/src/parent-console.html -->
<!-- 家长控制台：只在 Mac 上打开。显示会话状态、最近证据与等待中的提案请求；家长输入一句话、任务与提示级别后提交。
     提示级别是必填项（设计稿 10.8），否则预算与退出趋势失真。 -->
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>家长控制台</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 2rem; max-width: 720px; }
  .state { font-size: 1.4rem; font-weight: 600; }
  .pending { background: #fff4d6; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
  label { display: block; margin-top: .6rem; }
  input, textarea, select { width: 100%; box-sizing: border-box; padding: .4rem; }
  ul { padding-left: 1.2rem; }
</style>
</head>
<body>
<h1>家长控制台</h1>
<p>会话：<select id="sessions"></select></p>
<p class="state" id="state">未连接</p>
<p id="challenge"></p>
<div id="pending" class="pending" hidden>
  <strong>等待你的回应</strong>（目的：<span id="purpose"></span>，最高允许级别：<span id="maxLevel"></span>）
  <label>说一句话 <textarea id="spoken" rows="2"></textarea></label>
  <label>给孩子一个动作 <input id="task" /></label>
  <label>提示级别（必填）
    <select id="level">
      <option value="0">0 安静观察 / 非提示发言</option><option value="1">1 元认知问句</option><option value="2">2 方向暗示</option>
      <option value="3">3 半成品表示</option><option value="4">4 完整演示（之后必须重建）</option>
    </select>
  </label>
  <button id="submit">提交</button>
  <p id="error" style="color:#b00"></p>
</div>
<h2>最近证据</h2>
<ul id="evidence"></ul>
<script>
  const $ = (id) => document.getElementById(id);
  let current = null;
  async function refreshSessions() {
    const { sessions } = await (await fetch("/parent/sessions")).json();
    const select = $("sessions");
    const before = select.value;
    select.innerHTML = sessions.map((s) => `<option>${s}</option>`).join("");
    if (sessions.includes(before)) select.value = before;
    current = select.value || null;
  }
  async function refresh() {
    if (!current) return;
    const view = await (await fetch(`/parent/sessions/${encodeURIComponent(current)}`)).json();
    $("state").textContent = `${view.state} · 提示级别 ${view.hintLevel}${view.assistedRound ? " · 辅助轮" : ""}`;
    $("challenge").textContent = view.challengePrompt;
    $("pending").hidden = !view.pending;
    if (view.pending) { $("purpose").textContent = view.pending.purpose; $("maxLevel").textContent = view.pending.allowedMaxHintLevel; }
    $("evidence").innerHTML = view.recentEvidence.map((e) => `<li>${e.kind}：${e.summary}</li>`).join("");
  }
  $("submit").onclick = async () => {
    const body = { spokenResponse: $("spoken").value, learnerTask: $("task").value, hintLevel: Number($("level").value) };
    const res = await fetch(`/parent/sessions/${encodeURIComponent(current)}/proposal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    $("error").textContent = res.ok ? "" : (await res.json()).error;
    if (res.ok) { $("spoken").value = ""; $("task").value = ""; }
    refresh();
  };
  $("sessions").onchange = () => { current = $("sessions").value; refresh(); };
  setInterval(async () => { await refreshSessions(); await refresh(); }, 1000);
  refreshSessions().then(refresh);
</script>
</body>
</html>
```

`pnpm-workspace.yaml` 的 `packages` 增加一行 `- apps/agent-host`；根 `package.json` scripts 增加 `"host": "pnpm --filter @ai-scholar/agent-host start"` 与 `"session:replay": "pnpm --filter @ai-scholar/agent-host replay"`。

- [ ] **Step 4：安装并跑测试**

Run: `pnpm install && pnpm --filter @ai-scholar/agent-host test && pnpm --filter @ai-scholar/agent-host typecheck`
Expected: PASS。`ws` 只是测试客户端依赖（Node 22 的全局 `WebSocket` 也可，但 `ws` 事件 API 更稳定）。

- [ ] **Step 5：手动冒烟**

Run: `pnpm host`（另一个终端）`curl -s http://localhost:8788/healthz` 与浏览器打开 `http://localhost:8788/parent`。
Expected: `{"status":"ok","bridge":"parent"}`；页面显示“家长控制台”。

- [ ] **Step 6：提交**

```bash
git add apps/agent-host pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "实现 Mac mini 宿主：儿童端会话网关与家长控制台

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 12：脚本回放命令行、端到端验收与方案回写

**Files:**
- Create: `apps/agent-host/src/replay-cli.ts`
- Create: `apps/agent-host/fixtures/scripted-happy-path.json`
- Create: `apps/agent-host/fixtures/child-events-help-path.json`
- Test: `apps/agent-host/test/replay-cli.test.ts`
- Modify: `docs/superpowers/plans/2026-09-06-ai-scholar-phase-1-single-challenge-prototype.md`（勾选与偏离记录）
- Modify: `docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md`（14.6 阶段 2 标注实现状态；21 版本记录）
- Modify: `docs/handoffs/2026-09-06-ai-scholar-phase-0-handoff.md`（§14 追加阶段 1 进展）

**Interfaces:**
- Produces: `runReplay({ script, childEvents, clock? }): Promise<ReplayTrace>`，`ReplayTrace = { finalState, hintLevels: number[], maxHintLevelUsed, independentSuccess, assistedRound, outbound: ChildOutbound[], policyErrors }`；命令行 `pnpm session:replay -- --script <path> --events <path>`，终态 `COMPLETED` 退出码 0，否则 2。

- [ ] **Step 1：写夹具与失败测试**

```json
// apps/agent-host/fixtures/scripted-happy-path.json
{
  "scriptVersion": 1,
  "turns": [
    { "purpose": "hint", "proposal": { "proposalId": "s-1", "spokenResponse": "你现在已经确定了什么？", "learnerTask": "说说你已经确定的部分", "canvasActions": [], "expectedEvidence": ["magnitude_estimate"], "hintLevel": 1 } },
    { "purpose": "hint", "proposal": { "proposalId": "s-2", "spokenResponse": "0.3 还能换成什么说法？", "learnerTask": "换一种说法说说 0.3", "canvasActions": [], "expectedEvidence": ["tenths_meaning"], "hintLevel": 2 } }
  ]
}
```

```json
// apps/agent-host/fixtures/child-events-help-path.json
{
  "schemaVersion": 1,
  "steps": [
    { "atMs": 5000, "payload": { "type": "ANSWER", "text": "7.2" } },
    { "atMs": 9000, "payload": { "type": "HELP_REQUEST" } },
    { "atMs": 20000, "payload": { "type": "UTTERANCE", "text": "我觉得结果应该比 2.4 小" } },
    { "atMs": 30000, "payload": { "type": "HELP_REQUEST" } },
    { "atMs": 45000, "payload": { "type": "UTTERANCE", "text": "0.3 就是十分之三" } },
    { "atMs": 60000, "payload": { "type": "ANSWER", "text": "0.72" } },
    { "atMs": 80000, "payload": { "type": "EXPLAIN", "text": "因为 0.3 是十分之三，乘完只剩十分之三那么多，所以比 2.4 小" } },
    { "atMs": 100000, "payload": { "type": "ANSWER", "text": "1.4" } }
  ]
}
```

```ts
// apps/agent-host/test/replay-cli.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { runReplay } from "../src/replay-cli.js";

const script = JSON.parse(readFileSync(new URL("../fixtures/scripted-happy-path.json", import.meta.url), "utf8"));
const childEvents = JSON.parse(readFileSync(new URL("../fixtures/child-events-help-path.json", import.meta.url), "utf8"));

describe("脚本回放", () => {
  test("求助两次 → 两级提示 → 独立算出 → 讲回 → 无提示迁移成功 → COMPLETED", async () => {
    const trace = await runReplay({ script, childEvents });
    expect(trace.finalState).toBe("COMPLETED");
    expect(trace.hintLevels).toEqual([1, 2]);
    expect(trace).toMatchObject({ maxHintLevelUsed: 2, independentSuccess: true, assistedRound: false, policyErrors: 0 });
    expect(trace.outbound.filter((m) => m.type === "speak").map((m) => (m as { text: string }).text)).toEqual(["你现在已经确定了什么？", "0.3 还能换成什么说法？"]);
  });
  test("迁移答错以 SOFT_LANDING 结束", async () => {
    const wrong = { ...childEvents, steps: [...childEvents.steps.slice(0, -1), { atMs: 100000, payload: { type: "ANSWER", text: "14" } }] };
    const trace = await runReplay({ script, childEvents: wrong });
    expect(trace.finalState).toBe("SOFT_LANDING");
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @ai-scholar/agent-host test -- replay`
Expected: 失败，找不到模块。

- [ ] **Step 3：实现回放**

```ts
// apps/agent-host/src/replay-cli.ts
// 脚本回放：用固定的孩子事件序列 + 固定的桥接脚本跑一遍编排器，打印轨迹。
// 用于 15.3 模型行为测试与家长先导试验前的自检；没有 iPad 也能验证整条教学闭环。
import { readFileSync } from "node:fs";
import { InMemorySessionStore, ScriptedReplayBridge, SessionOrchestrator, type ReplayScript } from "@ai-scholar/learning-kernel";
import { mathPlugin } from "@ai-scholar/plugin-math";
import type { ChildOutbound, EventPayload } from "@ai-scholar/session-contracts";

export interface ChildEventScript { schemaVersion: 1; steps: Array<{ atMs: number; payload: EventPayload; quality?: "unconfirmed" | "confirmed" | undefined }> }

export interface ReplayTrace {
  finalState: string;
  hintLevels: number[];
  maxHintLevelUsed: number;
  independentSuccess: boolean;
  assistedRound: boolean;
  outbound: ChildOutbound[];
  policyErrors: number;
}

export async function runReplay(input: { script: ReplayScript; childEvents: ChildEventScript }): Promise<ReplayTrace> {
  const now = { t: 0 };
  const bridge = new ScriptedReplayBridge(input.script);
  const store = new InMemorySessionStore();
  const orchestrator = new SessionOrchestrator({ sessionId: "replay", plugin: mathPlugin, bridge, store, clock: () => now.t, challengeInput: { curriculumAnchor: mathPlugin.manifest.curriculumVersions[0] ?? "" } });
  const outbound: ChildOutbound[] = [...(await orchestrator.start())];
  let seq = 0;
  for (const step of input.childEvents.steps) {
    // 每一步之前按秒推进时钟，让窗口与超时逻辑真实生效
    while (now.t + 1_000 <= step.atMs) { now.t += 1_000; outbound.push(...(await orchestrator.tick(now.t))); }
    now.t = step.atMs;
    seq += 1;
    const result = await orchestrator.handleEvent({ eventId: `r-${seq}`, clientSessionId: "replay", deviceId: "replay", clientSeq: seq, occurredAt: now.t, quality: step.quality ?? "confirmed", source: "child_voice", semanticObjectIds: [], payload: step.payload });
    outbound.push(...result.outbound);
  }
  const hintLevels = store.listProposals("replay").filter((p) => p.accepted && p.proposal.hintLevel > 0).map((p) => p.proposal.hintLevel);
  return {
    finalState: orchestrator.context.state, hintLevels, maxHintLevelUsed: orchestrator.context.maxHintLevelUsed,
    independentSuccess: orchestrator.context.independentSuccess, assistedRound: orchestrator.context.assistedRound,
    outbound, policyErrors: orchestrator.context.policyErrors.length,
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const scriptPath = arg("--script") ?? new URL("../fixtures/scripted-happy-path.json", import.meta.url).pathname;
  const eventsPath = arg("--events") ?? new URL("../fixtures/child-events-help-path.json", import.meta.url).pathname;
  const trace = await runReplay({ script: JSON.parse(readFileSync(scriptPath, "utf8")), childEvents: JSON.parse(readFileSync(eventsPath, "utf8")) });
  for (const m of trace.outbound) console.log(JSON.stringify(m));
  console.log(JSON.stringify({ finalState: trace.finalState, hintLevels: trace.hintLevels, maxHintLevelUsed: trace.maxHintLevelUsed, independentSuccess: trace.independentSuccess, assistedRound: trace.assistedRound, policyErrors: trace.policyErrors }));
  process.exit(trace.finalState === "COMPLETED" ? 0 : 2);
}
```

- [ ] **Step 4：跑全仓测试、类型检查与命令行**

Run: `pnpm test && pnpm typecheck && pnpm session:replay; echo "exit=$?"`
Expected: 全部 PASS；命令行最后一行 `finalState: "COMPLETED"`，`exit=0`。

- [ ] **Step 5：方案回写**

- 本计划每个 Task 逐步勾选；实现与计划不一致处在该 Task 末尾加「实现偏离」一行。
- 设计稿 14.6 第 2 条后追加：`2026-09-06 实现状态：Mac 侧内核、数学插件、两种桥接、SQLite 落盘与家长控制台已实现（见阶段 1 计划）；iPad 儿童端界面待设备就绪另立计划。` 版本记录加 `0.4.1`。
- 交接文档 §14 追加阶段 1 进展与下一步（iPad 儿童端会话界面计划、Codex 路线裁决仍待用户）。

- [ ] **Step 6：提交**

```bash
git add apps/agent-host docs
git commit -m "实现脚本回放命令行并回写阶段1计划与设计稿

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 自检映射（设计稿 → 任务）

| 设计稿要求 | 任务 |
|---|---|
| 5.0 全部合法转换、未列出拒绝、儿童控制权元规则 | Task 2 |
| 5.2 30 秒窗口、硬上限 240 秒、擦除重画不计新策略 | Task 10 |
| 5.4 软/硬预算、一次一级、新产出门禁、4 级前实质性尝试、预算由内核强制 | Task 3、6 |
| 5.6 assisted_round 禁止记忆候选 | Task 6、10 |
| 8.5 异议冻结与“哪里不一样” | Task 2、10 |
| 10.2 幂等、内容哈希、序号缺口 | Task 4、11 |
| 10.3 提案校验清单 | Task 6 |
| 10.5 插件清单与 15.2 契约测试 | Task 5、7 |
| 10.8 三种桥接同一契约、家长标注级别 | Task 8 |
| 12 快照策略 | Task 9、10 |
| 13 转写不确定、输出不合规 | Task 10 |
| 14.5 内核无学科字面量 | Task 5 |
| 15.3 八个脚本场景 | Task 10、12 |
| 11.4 家庭局域网明文 http/ws | Task 11 |

**本计划明确不做**：`CodexRealtimeBridge`（门禁 BLOCKED）、`GrowthLedgerService` 与长期假设、`MEMORY_PENDING/CONTESTED` 的记忆路径、断线自动恢复、删除级联、家长视图之外的三种视图、iPad 儿童端界面。
