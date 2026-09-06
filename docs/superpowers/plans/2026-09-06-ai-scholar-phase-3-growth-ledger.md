# 阶段 3 成长记忆层分批实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让「四级数据链 → 三档写入门禁 → 孩子同意 → 跨轮退出趋势 → 删除级联」在 Mac 侧真正跑通，使一次真实会话能按设计规范第 14.3 节走完第 7、8 步。

**Design:** `docs/superpowers/specs/2026-09-06-growth-ledger-design.md`（定稿，含全部类型、SQL、门禁规则与 206 条测试清单）。
**Spec:** `docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md` v0.5（已按定稿 §0.2 修订五处）。

**本计划不重复抄设计稿。** 每批只写：改哪些文件、依据设计稿哪一节、跑哪组测试、怎么验收。实现时对着设计稿写代码。

## 全局纪律

- 严格模式 TypeScript（`strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`）；可选字段 `?: T | undefined`；相对导入带 `.js`。
- 存储只用 Node 22 内置 `node:sqlite`，不加新依赖。时钟一律注入，`growth/` 源码不得出现 `Date.now`。
- `growth/` 全部源码含中文注释不得出现 `math` / `literature` / `decimal` / 数学 / 文学 / 小数；`kernel-purity.test.ts` 必须始终绿。
- 账本是可选依赖：`OrchestratorDeps.ledger` 省略时走 `NULL_LEDGER`，闭环照跑（规范 9.5「成长模型为空时系统仍必须能跑完整闭环」）。
- 账本里没有任何「由模型或家长自由撰写、又会被孩子看到」的文本列。
- 每批结束：`pnpm test` 与 `pnpm typecheck` 全绿，中文 commit，回写本计划与设计稿。

## 批次依赖

```
批1 地基 ──┬─→ 批2 证据与假设 ──┬─→ 批3 门禁与档2闭环 ──┬─→ 批4 探针
           │                    │                       ├─→ 批5 趋势与档3
           └────────────────────┴───────────────────────┼─→ 批6 儿童权利
                                                        └─→ 批7 删除与保留
```

---

## 批 1：同库同连接与三个纯函数地基

**为什么先做**：删除要做到原子就必须会话库与成长库同库同连接（MF-11），这会改 `SqliteSessionStore` 构造签名，越晚做返工面越大。三个纯函数（离散守卫、禁止标签、儿童版文案）是后面所有门禁的输入。

**文件**
- 新增 `packages/learning-kernel/src/growth/`：`database.ts`（设计稿 §7.1，全仓唯一 `new DatabaseSync`，含 `PRAGMA secure_delete = ON`）、`constants.ts`、`types.ts`（§2.1–2.3）、`discrete-guard.ts`（§2.5）、`forbidden-labels.ts`（§2.6）、`child-text.ts`（§2.7）
- 改 `sqlite-store.ts`：构造器接收注入的 `LearningDatabase`，不再自开库
- 改 `store.ts`：`SessionStore` 接口三处扩展（§0.3），`InMemorySessionStore` 同步实现
- 改 `apps/agent-host/src/server.ts`、`replay-cli.ts`：构造点补参数

**测试**：设计稿 §13 的 `growth/discrete-guard.test.ts`（1–7）、`growth/forbidden-labels.test.ts`（8–14）、`store.test.ts` 改动（162–164）

- [ ] Step 1：写 `discrete-guard.test.ts` 与 `forbidden-labels.test.ts`（设计稿测试 1–14），跑，确认红
- [ ] Step 2：实现 `constants.ts` / `types.ts` / `discrete-guard.ts` / `forbidden-labels.ts` / `child-text.ts`，跑到绿
- [ ] Step 3：写 `store.test.ts` 的三参数契约测试（162–164），确认红
- [ ] Step 4：实现 `database.ts`，改 `sqlite-store.ts` 接收注入 db，补 `SessionStore` 三处扩展与内存实现，改宿主构造点
- [ ] Step 5：`pnpm test` + `pnpm typecheck` 全绿；`kernel-purity` 绿
- [ ] Step 6：提交「建立成长记忆层地基：同库同连接与离散守卫、禁止标签、儿童版文案」

## 批 2：插件契约扩展、证据链接与假设生命周期

**文件**
- 改 `challenge.ts` / `plugin.ts`（设计稿 §1，扩 manifest 的 `difficultyBands` / `forbiddenClaimPatterns` / `hypothesisCatalog` / `developmentGoals`，扩 `LearningChallenge` 与 `ChallengeInput`，加 `classifyProbeOutcome`）
- 改 `testing/plugin-contract.ts`（§1.2 新增八项校验）
- 改 `plugin-math/src/decimal-multiplication.ts` 与 `test/helpers/fake-plugin.ts` 按新契约补齐
- 新增 `growth/evidence-fold.ts`（§4）、`growth/hypothesis.ts`（§5.1）、`growth/run-recorder.ts`（§10.3）
- 新增 `growth/store/growth-sqlite.ts` 建表（§9 的 26 张表）

**测试**：`growth/evidence-fold.test.ts`（19–24）、`growth/hypothesis-lifecycle.test.ts`（25–34）、`plugin-contract` 与 `plugin-math`（169–178）

- [ ] Step 1：先改插件契约与两个插件，跑 `plugin-contract` 与 `plugin-math` 到绿（此步不碰账本）
- [ ] Step 2：写 `evidence-fold.test.ts`（19–24），确认红；实现 `evidence-fold.ts` 到绿
- [ ] Step 3：写 `hypothesis-lifecycle.test.ts`（25–34），确认红；实现 `hypothesis.ts` 到绿
- [ ] Step 4：实现 `run-recorder.ts` 与 `growth-sqlite.ts` 建表；`RunRecorder` 的清零口径按 §10.3（`beginRun` 在每次 `challengeValidated` 调用，含软着陆路径）
- [ ] Step 5：全绿并提交「实现证据链接、离散摘要与假设生命周期」

## 批 3：三档门禁与档 2 闭环

**这批做完，孩子第一次能真正把一条成长记录记下来。**

**文件**
- 新增 `growth/gate-rules.ts`（§3，一份规则表、三个入口、两个阶段）、`growth/candidate.ts`（§10.5 两条来源与去重合并）、`growth/ports.ts`、`growth/null-ledger.ts`、`growth/ledger-service.ts`（§10.1，唯一持有 store）
- 改 `session-state.ts`：设计稿 §0.2 修改一（`MEMORY_PENDING` 守卫）与修改二（`memoryHeld` 出口）
- 改 `orchestrator.ts`：§10.4 / §10.6 / §10.7 / §10.8（`gateSnapshot`、`previewNonce`、只读裁决 → 守卫 → 提交的顺序）
- 改 `proposal-validator.ts`：`memory:*` 扩到四条分支
- 改 `session-contracts`：`MEMORY_ASSENT` 扩字段、新增 `memoryPreview` 出站
- 改儿童端 Swift：`memoryPreview` 覆盖层，三个按钮同字号同尺寸同色、无默认选中、无超时自选（§11）

**测试**：`growth/gate-rules.test.ts`（44–64）、`growth/gate-tier1.test.ts`（65–69）、`growth/candidate-source.test.ts`（104–108）、`growth/ledger-authority.test.ts`（109–115）、`session-state.test.ts` 改动（125–131）、`orchestrator.test.ts` 改动（132–152）、**`growth/tier2-happy-path.test.ts`（153–155，MF-02 守门测试）**、Swift（196–203）

- [ ] Step 1：写 `gate-rules.test.ts` 与 `gate-tier1.test.ts`，确认红；实现规则表与三个入口
- [ ] Step 2：写 `session-state.test.ts` 的四条新转换测试，确认红；改状态机
- [ ] Step 3：写 `tier2-happy-path.test.ts`（用真 `mathPlugin` 跑完主路径并断言账本落一条档 2 记录），确认红
- [ ] Step 4：实现 `ledger-service.ts` / `candidate.ts` / 编排器接入，跑到守门测试绿
- [ ] Step 5：写 `ledger-authority.test.ts`（同时扫 `packages/` 与 `apps/`，除账本服务自身外任何文件 import 到 store 实现即失败）
- [ ] Step 6：儿童端 Swift 同意界面与测试
- [ ] Step 7：全绿并提交「实现三档门禁与档 2 写入闭环」

## 批 4：区分性探针

**文件**：新增 `growth/probe-selection.ts`（§5.2–5.3）；改 `session-state.ts`（§0.2 修改三、修改四）；改 `orchestrator.ts` 发探针；插件 `classifyProbeOutcome`

**测试**：`growth/probe-selection.test.ts`（35–43）、`orchestrator` 探针相关（145、169）

- [ ] Step 1：写 `probe-selection.test.ts`，确认红；实现 `separatesTwo` 与 `selectDiscriminatingProbe`
- [ ] Step 2：状态机两条新转换 + 编排器发探针；探针不计升级次数、不推高最高提示级别、只受独立探针预算
- [ ] Step 3：全绿并提交「实现区分性根因探针」

## 批 5：跨轮趋势与档 3

**文件**：新增 `growth/scaffold-trend.ts`（§6）；档 3 门禁与家长审阅（§8.3、§12）；`apps/agent-host` 通道分离（§12.1：儿童 `0.0.0.0:8788`，家长 `127.0.0.1:8789` + token，儿童通道上根本没有 `/parent/*` 路由）；`parent-console.html` 新增待审阅与教学警报两块

**测试**：`growth/scaffold-trend.test.ts`（70–79）、`parent-channel.test.ts`（185–195）

- [ ] Step 1：写 `scaffold-trend.test.ts`，确认红；实现趋势判定（分支顺序按 §6.2：gap 短路 → 点数不足 → rising 优先 → withdrawing → 持平才看前窗口）
- [ ] Step 2：档 3 门禁与家长审阅接口；家长只有批准 / 拒绝 / 收窄范围，没有改写文案的入口
- [ ] Step 3：通道分离，升级现有的本机限制为两个独立实例
- [ ] Step 4：家长控制台两块界面
- [ ] Step 5：全绿并提交「实现跨轮退出趋势与第 3 档写入」

## 批 6：孩子的知情、异议与视图

**文件**：`growth/views.ts`（§2.4 三视图投影）；异议冻结（§8.1–8.2，冻结的一等对象是 claimKey 不是假设）；`/child/*` 独立 HTTP 通道（§12.4，不走 WebSocket 帧、不占 `clientSeq`、不调 `host.open`）；首次使用告知（§11.4）；儿童端 `ChildUnderstandingView.swift`

**测试**：`growth/views.test.ts`（116–124）、`child-channel.test.ts`（179–184）、Swift（204–205）

- [ ] Step 1：写 `views.test.ts`，确认红；实现三视图投影，孩子视图含活动假设的儿童版描述与中性脚手架句
- [ ] Step 2：`CONTEST.target` 类型化为 `{kind, id}`，儿童端按当前呈现内容填出可解析目标；编排器落 `contests` 与冻结集
- [ ] Step 3：`/child/*` 通道与首次告知；会话已 `COMPLETED` 或宿主重启后无活动会话时三件事仍返回 200
- [ ] Step 4：儿童端「系统目前怎么理解我」页面
- [ ] Step 5：全绿并提交「实现孩子的知情、异议与三种视图」

## 批 7：删除级联与保留清理

**文件**：`growth/deletion.ts`（§7.2 纯函数计划器）、`growth/retention.ts`（§7.3）、`apps/agent-host/src/retention-job.ts`；删除请求闭环（§7.4）

**测试**：`growth/deletion.test.ts`（80–91）、`growth/deletion-request-flow.test.ts`（92–99）、`growth/retention.test.ts`（100–103）

- [ ] Step 1：写 `deletion.test.ts`，确认红；实现 `planDeletionCascade`
- [ ] Step 2：删除执行：单个 `BEGIN IMMEDIATE` 内完成，同时脱敏会话库四处 JSON 列；提交后 `wal_checkpoint(TRUNCATE)` + `VACUUM`
- [ ] Step 3：金丝雀测试**先自检**删除前能扫到标记串，再断言删除后 0 命中（避免恒绿空测试）
- [ ] Step 4：删除请求闭环：请求即停用，家长拒绝也不解除，7 天只告警不自动删
- [ ] Step 5：保留清理作业与脱敏后的最小可解析形状
- [ ] Step 6：全绿并提交「实现删除级联与保留清理」

---

## 完成定义

七批全绿后，下列各条都有测试佐证：

- 一次真实会话能走完规范 14.3 的第 7 步（向孩子展示拟写入的描述，同意且门禁通过才写入）与第 8 步（孩子指出「你理解错了」，相关假设立即冻结并重新验证）；
- 用真 `mathPlugin` 跑主路径，账本确实落下一条档 2 记录（守门测试 153）；
- `assisted_round` 为真的任何路径都写不进档 2 与档 3；
- 除账本服务自身外没有任何文件能拿到 store 的写方法（机械扫描）；
- 孩子在会话结束后仍能查看、异议、请求删除；
- 删除后全库扫描不残留被删内容，失去依据的结论一并失效，趋势显示「数据不完整」而非静默重算。
