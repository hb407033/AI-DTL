# 阶段 2 会话恢复（断线、重启、续接）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 儿童端断线、宿主重启、App 重开三种情况下，会话都回到最后确认的教学状态：不重复播放、不重复记证据、不因技术中断产生能力判断（设计稿 13「实时语音中断」「服务重启」、5.0 `PAUSED_TECH` 两行、14.5「服务重启后恢复最后确认状态」）。

**Architecture:** 会话状态 = 可重放事件 + 明确快照。快照除状态机上下文外再带一份编排器运行时（擦除哈希、Agent 层对象、最近一句话与任务、窗口计时），宿主重启后从最新快照重建编排器，再把快照之后的事件只灌回日志与证据（不触发桥接）。儿童端 socket 断开即 `techInterrupted` → `PAUSED_TECH`（停计时、停能力判断），重连即 `techRecovered` → 回原状态并重发一份“当前画面”给儿童端；儿童端把 sessionId 存本地，重开 App 也续接同一会话。

**Tech Stack:** 同阶段 1。

**Spec:** 设计稿 v0.4.2 第 5.0、12、13、14.5 节；阶段 1 两份计划。

## Global Constraints

- 恢复只能回到 5.0 表已有状态，不新增状态；`PAUSED_TECH` 出口两条都实现，但阶段 2 只在“快照之前事件已落盘”这一前提下判定检查点一致（不一致分支留给作品版本漂移场景，阶段 3）。
- 恢复不调用桥接、不重发已确认的提示；儿童端“当前画面”只由出站消息组成，仍不含内部信息。
- `PAUSED_TECH` 期间 tick 不推进窗口；恢复时窗口从恢复时刻重新计。
- 事件重放靠 `event_id` 幂等，宿主重启后同一 id 仍返回原确认。

## 文件结构

```text
packages/learning-kernel/src/store.ts          # SessionSnapshot 增加 runtime 字段
packages/learning-kernel/src/orchestrator.ts   # runtime 进快照；restore；techInterrupted/techRecovered；viewSnapshot
packages/learning-kernel/test/orchestrator-recovery.test.ts
apps/agent-host/src/session-gateway.ts         # open：已存在→续接；库里有→重建；socket 关闭→中断
apps/agent-host/test/session-gateway.test.ts   # 重启续接、断线暂停
apps/ipad/ScholarPad/ScholarPad/Session/SessionClient.swift   # sessionId 持久化；重连先清 Agent 层
apps/ipad/ScholarPad/ScholarPadTests/SessionViewStateTests.swift  # resetForResume
```

## Task 1：内核恢复

- [ ] Step 1：`orchestrator-recovery.test.ts`：
  - 跑到“求助 → 1 级提示（带一个 Agent 对象）”，`restoreOrchestrator(deps)` 得到新实例：`context`、`challenge`、`evidence`、`viewSnapshot()` 里的 Agent 对象与最近一句话都与原实例一致；重放旧事件 id 得 `duplicate`；新事件 `clientSeq` 接着原序号。
  - 快照后再来两条事件（不改状态）再重启：证据条数含这两条，序号连续。
  - `techInterrupted()` → `PAUSED_TECH`，`tick(+10 min)` 什么也不发；`techRecovered()` → 回 `INTERVENING`，窗口从恢复时刻重新计（再 `tick(+29 s)` 不触发评估）。
  - `viewSnapshot()` 顺序：`stateChanged` → `learnerTask`（TRANSFER 用迁移题、EXPLAIN_BACK 用讲回问句、其余用当前挑战）→ 每个 Agent 对象一条 `upsertObject` → 最近一句 `speak`（若有）。
- [ ] Step 2：实现：`SessionSnapshot.runtime?: OrchestratorRuntime`（`erasedHashes: string[]; agentObjects: SemanticObject[]; childObjectIds: string[]; lastProposalId: string | null; lastLearnerTask: string; lastSpoken: string | null; windowStartedAt; lastNewStrategyAt`）；`SessionOrchestrator` 用 `agentObjects` 替代 `agentObjectIds`，记录 `lastLearnerTask/lastSpoken`；`static restore(deps): SessionOrchestrator | null`；`techInterrupted()`、`techRecovered()`、`viewSnapshot()`。
- [ ] Step 3：全部内核测试通过；提交「实现会话快照恢复与技术中断暂停」。

## Task 2：宿主续接

- [ ] Step 1：网关测试：同一 store 建两个 host，第一个跑到 1 级提示后丢弃；第二个 `open("s-1")` 返回的帧含 `stateChanged INTERVENING`、任务、Agent 对象、最近一句；再发旧帧得原 ack；`onSocketClosed("s-1")` 后 `parentView.state === "PAUSED_TECH"`，再次 `open` 回 `INTERVENING`。
- [ ] Step 2：实现：`open` 三分支；`onSocketClosed(sessionId)`；`server.ts` 的 close 回调调用它。
- [ ] Step 3：测试通过；提交「宿主支持断线暂停与重启续接」。

## Task 3：儿童端续接

- [ ] Step 1：`SessionViewStateTests` 增 `resetForResume()`：清 Agent 层、高亮、指针、弹层，保留任务与最近一句。
- [ ] Step 2：`SessionClient`：sessionId 存 `UserDefaults`（键 `padSessionId`），重连 `handleOpen` 前先 `view.resetForResume()`；`ChildSessionView` 加一个不起眼的“换一题”入口（新 sessionId）。
- [ ] Step 3：单测与 UI 冒烟通过（宿主脚本模式）；回写三份文档；提交「儿童端续接同一会话」。
