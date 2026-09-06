---
说明：本稿由「三角度独立设计 → 九份分镜头评审 → 106 条致命缺陷归并成 38 条必修项 → 两版独立合成 → 六份对抗性验收 → 定稿」的多代理流程产出，2026-09-06。
评审材料与中间稿不入库。实施方式：按第 0.2 节先改主规范，再分批实施，每批回写本稿与主规范。
本稿是实施依据，不是已实现状态；各节的实现进度以 docs/superpowers/plans/ 下对应计划的勾选为准。
---

# AI 学科心智学习系统 · 成长记忆层最终设计

> 状态：定稿，可直接实施
> 依据规范：`docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md`（v0.4，2026-09-06）
> 本稿覆盖第 9 章全部、10.2/10.3/10.4/10.6/10.7、5.6/5.7、6.2、8.5、12、15.1/15.2，并对 5.0 转换表、9.7 权限矩阵、14.6 阶段边界做了四处显式修改（§0.2 列全，实施后必须回写规范）。

---

## 0. 范围、阶段声明与对规范的显式修改

### 0.1 阶段声明（MF-37）

本设计 = 规范 14.6 的**阶段 3（数学 Alpha）全量** + 阶段 4 的**「删除语义」与「跨轮退出趋势」提前实现**，其余阶段 4 内容（文学薄插件、家长视图完整形态）不在本稿范围。

**为什么把这两块提前**：

- 删除语义与数据模型强耦合。删除要做到原子，会话库与成长库必须同库同连接（§7.1）；若先按两库落地档 2 档 3，删除到来时要改 `SqliteSessionStore` 的构造签名、events 表结构与全部脱敏路径，返工面比一次做完更大。
- 9.5 的底线（孩子可随时查看、异议、请求删除）不能等到阶段 4。没有删除闭环，「请求删除」按钮就是画出来的饼，而这是规范 16 章点名的风险「孩子不知情或无法反驳」。
- 跨轮趋势是档 3 门禁的输入。档 3（跨轮习惯）属阶段 3 的「分级成长写入」，趋势不做，档 3 就只能造假。

**代价（必须接受）**：实现量与测试面约为纯阶段 3 的 1.6 倍；`CodexRealtimeBridge` 接入后移到本层落地之后（本层用 `ScriptedReplayBridge` / `ParentCoachBridge` 就能跑完全部门禁路径）。

**实施后必须回写规范 14.6**：第 3 项补「含删除语义与跨轮退出趋势」，第 4 项删去这两项并注明已在阶段 3 完成。

### 0.2 对规范的四处显式修改（实施前先改规范，不许静默放宽）

**修改一：5.0 表 `MEMORY_PENDING` 行加守卫**（MF-18）

原文「孩子同意或确认描述准确，**且本地写入规则通过** → `COMPLETED`」，与 9.1.1 末句「任何门禁未满足时，候选停留在 `MEMORY_PENDING`」合读，本来就该有「同意但规则未通过」这一行；现在把它显式写进表：

| 当前状态 | 事件或条件 | 下一状态 | 必须发生的动作 |
|---|---|---|---|
| `MEMORY_PENDING` | 孩子选「记下来」但本地写入规则未通过 | `MEMORY_PENDING` | 拒绝转换并记 `guardFailed`；候选转 `held`，落一条 `committed:false` 的决策；不进活动成长模型 |

**修改二：新增 `MEMORY_PENDING --memoryHeld--> COMPLETED`**（8.1 单屏原则 + 修改一的必然推论）

修改一让会话停在 `MEMORY_PENDING`，而这块屏上只有三个选项。若不给出口，孩子唯一的离开方式是改按「不确定」——说一句自己不这么想的话，这是软胁迫。因此内核在**候选已落成 `held` 之后**自行发一个 `memoryHeld` 信号收尾会话。**停在 `MEMORY_PENDING` 的是候选，不是孩子**：这是 9.1.1 末句的正确读法，实施时按此读。

| 当前状态 | 事件或条件 | 下一状态 | 必须发生的动作 |
|---|---|---|---|
| `MEMORY_PENDING` | 候选已置 `held`（内核信号，非孩子动作） | `COMPLETED` | `keepCandidateTemporary`；撤下卡片；候选不进活动成长模型，也不得被挑战生成器当已知事实 |

**修改三：新增 `ASSESSING --probeIssued--> ASSESSING`**（6.2 区分性探针）

6.2 要求「依次使用区分性探针」。若把探针塞进提示阶梯（`ASSESSING→INTERVENING` 的 1 级问句），跑到第三个探针必然 `assessedBudgetExhausted → SOFT_LANDING`、`assisted_round=true`，本轮档 2/档 3 全灭；而且探针会推高 `max_hint_level_used`，让 5.7 把**诊断**误报成**教学警报**。探针是诊断动作不是帮助动作（它不给解题信息），必须与提示阶梯分离。

| 当前状态 | 事件或条件 | 下一状态 | 必须发生的动作 |
|---|---|---|---|
| `ASSESSING` | 活跃候选 ≥ 2 且存在能区分其中两个的探针，探针预算未尽 | `ASSESSING` | 发出探针问句（`hint_level = 0`，不计入 `escalation_count` 与 `max_hint_level_used`，不受提示预算约束，受独立探针预算约束） |

**修改四：新增 `ASSESSING --childOutput--> ASSESSING`**（元规则的补齐）

现状：孩子在 `ASSESSING` 说话会命中 `unlistedTransition`。探针在 `ASSESSING` 原地发出后，孩子的回答必须被接受为本轮产出。

| 当前状态 | 事件或条件 | 下一状态 | 必须发生的动作 |
|---|---|---|---|
| `ASSESSING` | 孩子仍有新产出（含探针回答） | `ASSESSING` | 计入实质性尝试；不直接升级提示 |

**修改五：9.7 权限矩阵「学科插件 × 临时假设」格**

原表为「计算离散证据摘要」。本设计把离散摘要的计算改由内核 `summarizeClaim` 实现（口径必须跨学科一致，且它是门禁输入，不能由插件决定）。插件在该格改为「提供证据的方向、来源探针与表面情境键」。这是对矩阵的修改，回写规范 9.7。

**同时明确一处不修改**：9.7「家长 × 跨轮趋势」格只有「必须事前审阅」，没有「可纠正」。本设计因此**不给家长任何改写孩子将看到的文案的能力**（§8.3），审阅只有批准 / 拒绝 / 收窄适用范围三个动作。

### 0.3 文件清单（照单实施才编译得过，MF-33）

**新增内核源码**（全部在 `packages/learning-kernel/src/growth/`，中文注释，不得出现学科字面量）：

```
growth/constants.ts        时间常数、claimKey / linkId / previewNonce 的构造
growth/types.ts            §2 全部类型
growth/discrete-guard.ts   assertDiscreteOnly / findDiscreteViolations
growth/forbidden-labels.ts PERSONA_PATTERNS / screenChildFacingText / compilePatterns
growth/child-text.ts       renderChildFacingText / renderEvidenceSummaryText / renderScaffoldLine
growth/gate-rules.ts       GATE_RULES 一份规则表 + runRules + 三个导出入口
growth/evidence-fold.ts    summarizeClaim / foldRunDirection / buildEvidenceLinks
growth/hypothesis.ts       假设状态机、活跃候选上限、解冻判定
growth/probe-selection.ts  separatesTwo / selectDiscriminatingProbe
growth/scaffold-trend.ts   analyzeScaffoldTrend / isComparable
growth/candidate.ts        buildCandidateDraft / foldCapabilityClaim / 去重合并
growth/deletion.ts         planDeletionCascade / previewDeletion（纯函数）
growth/retention.ts        planRetentionPrune / redactEventPayload / redactProposal
growth/permission-matrix.ts PERMISSION_MATRIX 常量
growth/views.ts            三视图投影
growth/run-recorder.ts     RunRecorder
growth/ports.ts            五个窄端口类型
growth/null-ledger.ts      NULL_LEDGER（不接账本时的空实现）
growth/database.ts         openLearningDatabase（全仓唯一 new DatabaseSync 的地方）
growth/ledger-service.ts   GrowthLedgerService（唯一持有 GrowthStore）
growth/store/growth-sqlite.ts  GrowthStore 实现（不从 index.ts 导出）
```

**必须一并改的既有文件**：

```
packages/learning-kernel/src/challenge.ts          扩 LearningChallenge / ChallengeInput / DisciplineEvidence / DiscriminatingProbe
packages/learning-kernel/src/plugin.ts             扩 manifest 与 DisciplinePlugin（classifyProbeOutcome）
packages/learning-kernel/src/session-state.ts      §0.2 四处表改动 + Signal / SessionContext 改动
packages/learning-kernel/src/orchestrator.ts       §10 全部接入
packages/learning-kernel/src/store.ts              SessionStore 接口三处扩展 + InMemorySessionStore 同步实现
packages/learning-kernel/src/sqlite-store.ts       构造器改为接收注入的 db；三处扩展的 SQL 实现
packages/learning-kernel/src/proposal-validator.ts memory:* 分支扩到四条；frozenTargets 改类型
packages/learning-kernel/src/testing/plugin-contract.ts  新增七项检查、收紧 separatesTwo
packages/learning-kernel/src/index.ts              导出成长层公共类型与服务，不导出 store 与 SQL 层
packages/session-contracts/src/evidence-event.ts   CONTEST.target 必填、MEMORY_ASSENT 扩字段、新增两种事件
packages/session-contracts/src/child-protocol.ts   新增四支出站消息
packages/plugin-math/src/decimal-multiplication.ts 按新契约补字段与文案
apps/agent-host/src/session-gateway.ts             注入 ledger / assent / learnerId
apps/agent-host/src/server.ts                      通道分离、/child/*、/parent/* 全套
apps/agent-host/src/replay-cli.ts                  构造点补参数
apps/agent-host/src/growth-wiring.ts               新增：账本创建与跨会话生命周期
apps/agent-host/src/retention-job.ts               新增：30 天清理作业
apps/agent-host/src/parent-console.html            新增四块
```

**必须一并改的测试构造点**（不改则编译不过）：

```
packages/learning-kernel/test/orchestrator.test.ts
packages/learning-kernel/test/orchestrator-recovery.test.ts
packages/learning-kernel/test/store.test.ts          （两个 SessionStore 实现跑同一套契约）
packages/learning-kernel/test/session-state.test.ts
packages/learning-kernel/test/proposal-validator.test.ts
packages/learning-kernel/test/helpers/fake-plugin.ts
packages/plugin-math/test/plugin-math.test.ts
apps/agent-host/test/server.test.ts
apps/agent-host/test/session-gateway.test.ts
apps/agent-host/test/replay-cli.test.ts
```

**账本是可选依赖**：`OrchestratorDeps.ledger` / `assent` 省略时走 `NULL_LEDGER`，闭环照跑（9.5「成长模型为空时系统仍必须能跑完整闭环」）。

### 0.4 全局纪律

- TypeScript 严格模式（`strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`）；可选字段一律写 `?: T | undefined`；相对导入带 `.js`。
- 存储只用 Node 22 内置 `node:sqlite`，不加新依赖。
- 时钟全部注入（`clock: () => number`）；`growth/` 目录源码不得出现 `Date.now`（有机械扫描）。
- 成长层内核源码（含中文注释）不得出现 `math` / `literature` / `decimal` / 数学 / 文学 / 小数；举例一律用「某一族题目」「这个发展目标」这类占位说法。
- 账本里**没有任何由模型或家长自由撰写、又会被孩子看到的文本列**。孩子看到的每一句话都由内核模板从「插件提供的儿童版短语 + 离散计数」渲染。

---

## 1. 插件契约扩展（MF-30）

门禁要「这条证据来自哪个探针」「表面情境键」「是否自我修正」「难度带顺序」「这句话怎么说人话」，这些只能由学科插件给（硬约束 6 禁止学科逻辑进内核）。契约按下面扩展，方向词汇统一 `supports` / `weakens`（不引入 `refutes`）。

### 1.1 类型改动

```ts
// challenge.ts
export interface HypothesisSupport {
  hypothesisId: string;
  direction: "supports" | "weakens";
}

export interface DisciplineEvidence {
  evidenceId: string;
  eventId: string;
  kind: string;
  summary: string;
  hypothesisSupport: HypothesisSupport[];
  /** 表面情境键：同一深层结构下的表面变体标识，跨轮可比的最小单位 */
  surfaceContextKey: string;
  /** 这条证据是否来自区分性探针；非探针证据为 undefined */
  fromProbeId?: string | undefined;
  /** 孩子在没有提示的情况下自己改对了 */
  selfCorrection: boolean;
}

export interface DiscriminatingProbe {
  id: string;
  question: string;                                   // 儿童可读，≤ 40 字，最多一个问号
  outcomes: Record<string, HypothesisSupport[]>;
  /** 每个 outcome 至少一条能被 classifyProbeOutcome 命中的样例回答，供契约测试用 */
  samples: Record<string, readonly string[]>;
}

export interface LearningChallenge {
  // …既有字段不变…
  /** 发展目标的稳定 id（claimKey 的组成部分，跨轮不变） */
  developmentGoalId: string;
  /** 发展目标的儿童版说法，例如「说清楚这一步为什么成立」。内核只搬运，不改写 */
  childFacingGoalPhrase: string;
  surfaceContextKey: string;
  /** 表面情境的儿童版说法，例如「换了数字的这种题」 */
  surfaceContextLabel: string;
  /** 本挑战承载的探针（由 requiredProbeId 驱动生成时非空） */
  probeId?: string | undefined;
  /** 本挑战能区分的候选 id */
  discriminates?: readonly string[] | undefined;
}

export interface ChallengeInput {
  curriculumAnchor: string;
  probeFamilyId?: string | undefined;
  difficultyBand?: string | undefined;
  /** 活动成长模型里已确认的记录（只读，不含候选） */
  knownRecords?: readonly KnownRecordRef[] | undefined;
  /** 到期复习项（9.3「毕业并低频回看」、5.1「到期复习项」） */
  dueReviews?: readonly DueReview[] | undefined;
  requiredProbeId?: string | undefined;
  competingHypothesisIds?: readonly string[] | undefined;
}
```

```ts
// plugin.ts
export interface DisciplinePluginManifest {
  // …既有字段不变…
  /** 难度带，低 → 高有序。SDP 固化下标，账本此后不再问插件（MF-31） */
  difficultyBands: readonly string[];
  /** 学科专有的贬义说法，存字符串模式，内核 compilePatterns 编译成正则；保持 JSON 可序列化 */
  forbiddenClaimPatterns: readonly string[];
  /** 根因假设目录：每个假设的儿童版猜想与家长版标签（MF-09 的文案生产者） */
  hypothesisCatalog: readonly { id: string; childFacingGuess: string; parentFacingLabel: string }[];
  /** 发展目标目录：id → 儿童版短语 */
  developmentGoals: readonly { id: string; childFacingGoalPhrase: string }[];
}

export interface DisciplinePlugin {
  // …既有方法不变…
  /** 把孩子对探针的回答归到某个 outcome；归不上返回 null */
  classifyProbeOutcome(probe: DiscriminatingProbe, text: string): string | null;
}
```

`developmentGoal`（既有的自由文本）保留，只给家长与 Agent 视图看；孩子看到的一律是 `childFacingGoalPhrase`。

### 1.2 `runPluginContract` 新增检查

| 检查名 | 内容 |
|---|---|
| `manifestHasOrderedDifficultyBands` | `difficultyBands` 非空，且 `createChallenge` 产出的 band 在表里 |
| `manifestForbiddenPatternsSerializable` | `forbiddenClaimPatterns` 是 `string[]`，`JSON.parse(JSON.stringify(manifest))` 与原 manifest 深等 |
| `hypothesisCatalogCoversProbes` | 探针 outcomes 里出现的每个 `hypothesisId` 都在 `hypothesisCatalog` 里 |
| `developmentGoalDeclared` | `challenge.developmentGoalId` 在 `manifest.developmentGoals` 里，且 `childFacingGoalPhrase` 与目录一致 |
| `childFacingPhrasesReadable` | `childFacingGoalPhrase` / `surfaceContextLabel` / 每条 `childFacingGuess` 非空、≤ 40 字、过内核 `screenChildFacingText`、不含数字比率 |
| `evidenceCarriesSurfaceContext` | 对样例事件产出的每条证据都有非空 `surfaceContextKey`，方向只有 `supports`/`weakens` |
| `probeSeparatesTwo` | 每个探针对某两个候选满足 §5.3 的 `separatesTwo` |
| `classifyProbeOutcomeHasSample` | 每个探针的每个 outcome，其 `samples` 里至少一条能被 `classifyProbeOutcome` 归回该 outcome |

`mathPlugin` 与 `test/helpers/fake-plugin.ts` 同步补齐这些字段后必须全绿；`kernel-purity.test.ts` 保持绿。

---

## 2. 核心类型

### 2.1 标识与基础结构（`growth/constants.ts`、`growth/types.ts`）

```ts
/** 主张键：跨会话、跨轮稳定，档 2 档 3 共用；discipline 是运行时字符串值，不是内核字面量 */
export function claimKeyOf(discipline: string, probeFamilyId: string, developmentGoalId: string): string {
  return `${discipline}::${probeFamilyId}::${developmentGoalId}`;
}

export const ASK_AGAIN_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;   // 拒绝后再问的冷却
export const VERIFY_INTERVAL_MS    = 21 * 24 * 60 * 60 * 1000;   // 下一次验证到期
export const EXPIRE_INTERVAL_MS    = 90 * 24 * 60 * 60 * 1000;   // 到期未复验转 expired
export const RETENTION_MS          = 30 * 24 * 60 * 60 * 1000;   // 未被引用的临时事件保留期
export const DELETION_SLA_MS       =  7 * 24 * 60 * 60 * 1000;   // 删除请求家长处理时限（只告警，不自动执行）
export const CONFIRM_SUPPORT_MIN   = 2;                          // suspected → confirmed 的最少支持挑战数
export const CONFIRM_SURFACE_MIN   = 2;                          // 同上：最少不同表面情境数
export const ROUND_ACTIVE_CANDIDATE_CAP = 3;                     // 硬约束 9
export const PROBE_BUDGET = { maxPerRun: 3, maxPerAssessing: 1 } as const;
```

```ts
export interface ContestTarget {
  kind: "proposal" | "hypothesis" | "candidate" | "record" | "session";
  id: string;
}

/** 编排器在「预检那一刻」与「孩子按下三选项那一刻」各现取一次；账本没有任何别的途径读到会话状态 */
export interface SessionGateSnapshot {
  sessionId: string;
  runId: string;
  takenAt: number;
  state: SessionState;
  assistedRound: boolean;                    // 粘性口径，见 §10.3
  frozenTargets: readonly ContestTarget[];
  maxHintLevelUsedInRound: number;
  transferHintLevelUsedInRound: number;
  transferTainted: boolean;
  probeResolved: boolean;
  previewNonce: string | null;
}

export interface ChallengeRun {
  runId: string;
  sessionId: string;
  challengeId: string;
  discipline: string;
  probeFamilyId: string;
  difficultyBand: string;
  difficultyBandIndex: number;               // 记 SDP 时就固化，账本此后不问插件（MF-31）
  developmentGoalId: string;
  childFacingGoalPhrase: string;
  surfaceContextKey: string;
  surfaceContextLabel: string;
  claimKey: string;
  startedAt: number;
  endedAt: number | null;
  firstServerSeq: number;
  lastServerSeq: number;
  artifactVersionIds: readonly string[];
  maxHintLevelUsed: number;
  escalationCount: number;
  probesIssued: number;
  transferOutcome: "succeeded" | "failed" | "none";
  transferHintLevelUsed: number;
  transferTainted: boolean;
  reconstructed: boolean;
  assistedRound: boolean;
  selfCorrectionObserved: boolean;
  timeToFirstProductiveActionMs: number | null;
  probeResolved: boolean;
  discriminates: readonly string[];
}
```

### 2.2 主张、证据链接与记录

```ts
/** 一条证据在账本里的落点。claimKey 必填，hypothesisKey 可空——干净成功路径上没有存活假设（MF-02） */
export interface ClaimEvidenceLink {
  linkId: string;                            // sha256(runId|evidenceId|claimKey|hypothesisKey ?? "").slice(0,32)
  learnerId: string;
  runId: string;
  eventId: string;
  evidenceId: string;
  claimKey: string;
  hypothesisKey: string | null;
  direction: "supports" | "weakens";
  surfaceContextKey: string;
  fromProbeId: string | null;
  selfCorrection: boolean;
  artifactVersionId: string | null;
  observedAt: number;
  status: "active" | "evidence_removed";
}

/** 五个离散计数。口径统一，有没有假设都算得出（MF-26） */
export interface DiscreteCounts {
  supportingChallenges: number;
  refutingChallenges: number;
  distinctSurfaceContexts: number;
  independentTransferSuccesses: number;
  hintedSuccesses: number;
}

export type JudgementStatus =
  | "suspected" | "confirmed" | "refuted" | "contested" | "expired" | "evidence_removed";

export interface TransferRef {
  runId: string;
  challengeId: string;
  transferHintLevelUsed: 0;                  // 类型锁死：有提示的迁移进不来
  maxHintLevelUsedInRound: number;
  achievedVia: "independent" | "afterDemoRebuild";
  occurredAt: number;
}

/** 结构化的「下一次验证条件」；人读的一句话由渲染函数生成，库里不存自由文本 */
export interface NextVerification {
  kind: "sameFamilyNewSurface" | "trendWindowRefresh";
  probeFamilyId: string;
  difficultyBandIndex: number;
  minSurfaceContexts: number;
  dueAt: number;
  expiresAt: number;
}

/** 9.4「每条能力判断必须具备」的七项，缺一不可，档 2 档 3 同构 */
export interface GrowthRecord {
  recordId: string;
  learnerId: string;
  tier: 2 | 3;
  claimKey: string;
  // ① 具体对象与适用范围
  targetObject: { id: string; label: string };
  scope: { probeFamilyId: string; difficultyBandIndex: number; surfaceContextKeys: readonly string[] };
  // ② 证据引用
  evidenceLinkIds: readonly string[];
  // ③ 五个离散计数 + 最近观察时间
  counts: DiscreteCounts;
  lastObservedAt: number;
  // ④ 9.4 六态之一
  status: JudgementStatus;
  // ⑤ 下一次验证条件
  nextVerification: NextVerification;
  // ⑥ 孩子提出异议的记录
  contests: readonly { contestId: string; at: number; resolvedAt: number | null }[];
  // ⑦ 迁移引用与最高提示级别（档 2 恰一条，档 3 ≥ 3 条）
  transferRefs: readonly TransferRef[];
  maxHintLevelUsedAtAchievement: number;
  // 渲染与审计
  childFacingText: string;                   // 内核模板渲染，不是自由文本
  evidenceSummaryText: string;
  hypothesisKeys: readonly string[];         // 可为空数组
  trendRef: { windowRunIds: readonly string[]; verdict: TrendVerdict } | null;  // 档 3 必填
  decisionId: string;
  committedAt: number;
  suppressedReason: "deletionRequested" | null;   // 孩子请求删除后立即停用（§7.4）
}
```

`assertRecordComplete(record)` 逐项检查并返回缺失字段名；门禁规则 `shared.recordFieldsComplete` 调它。

### 2.3 决策与候选

```ts
export interface RuleResult { ruleId: string; passed: boolean; detail: string }

export interface MemoryCommitDecision {
  decisionId: string;
  learnerId: string;
  candidateId: string;
  tier: 2 | 3;
  phase: "preflight" | "decide";
  rulesetId: string;                         // GATE_RULESET_ID，规则表变更时改版
  ruleResults: readonly RuleResult[];        // 不短路，收齐全部
  failures: readonly string[];               // 未通过的 ruleId
  childChoice: "record" | "unsure" | "disagree" | null;
  parentReviewId: string | null;
  assistedRound: boolean;
  outcome: { committed: boolean; recordId: string | null; reasonCode: string | null };
  decidedBy: "GrowthLedgerService";
  decidedAt: number;
}

export type CandidateStatus =
  | "awaiting_parent"    // 档 3：等家长事前审阅
  | "awaiting_child"     // 等孩子看预览并选
  | "awaiting_reassent"  // 家长收窄适用范围后，等重新问孩子（§8.3）
  | "held"               // 门禁在提交那一刻未过，停留（0.2 修改一）
  | "declined_unsure"    // 孩子选了不确定
  | "contested"          // 孩子选了不是这样
  | "committed"
  | "superseded";

export interface MemoryCandidate {
  candidateId: string;
  learnerId: string;
  tier: 2 | 3;
  claimKey: string;
  targetObject: { id: string; label: string };
  scope: GrowthRecord["scope"];
  counts: DiscreteCounts;
  evidenceLinkIds: readonly string[];
  hypothesisKeys: readonly string[];
  transferRefs: readonly TransferRef[];
  maxHintLevelUsedAtAchievement: number;
  nextVerification: NextVerification;
  childFacingText: string;
  evidenceSummaryText: string;
  contestTarget: ContestTarget;              // 儿童端「不是这样」直接回带
  proposedBy: "bridge" | "kernel" | "bridge+kernel";
  previewNonce: string | null;
  shownAt: number | null;
  status: CandidateStatus;
  createdAt: number;
}
```

### 2.4 三视图（MF-09）

```ts
export interface ChildFacingView {
  myQuestions: readonly { at: number; text: string }[];          // 孩子自己问过的（原话）
  myExplorations: readonly { at: number; label: string }[];      // 表示与策略尝试（插件给的 kind 的儿童版说法）
  myArtifacts: readonly { artifactId: string; versionNo: number; at: number }[];
  myCorrectedGuesses: readonly { at: number; text: string }[];   // 被我修正的猜想（自我修正证据）
  myNewMethods: readonly { recordId: string; text: string }[];   // 我新学会的方法（已提交记录的儿童版）
  /** 正在决定出什么题的活跃候选，儿童版、中性、不含模型推理（9.7 孩子 × 临时假设格） */
  activeGuesses: readonly { hypothesisKey: string; text: string; contestTarget: ContestTarget }[];
  /** 5.7 末句的中性脚手架呈现：只有两个整数，无趋势词、无百分比、无排名 */
  scaffoldLine: string;
  records: readonly { recordId: string; text: string; contestTarget: ContestTarget; canRequestDeletion: true }[];
  deletionRequests: readonly { requestId: string; status: string; outcomeText: string | null }[];
  firstUseAcknowledged: boolean;
}

export interface ParentFacingView {
  independence: readonly ScaffoldPointRow[];
  thinkingHabits: readonly GrowthRecord[];
  trends: readonly TrendReport[];
  discussionPrompts: readonly string[];       // 孩子自己提过的问题 + 本轮讲回问句，内核只搬运
  declineSignals: readonly { claimKey: string; consecutiveDeclines: number; lastDeclinedAt: number }[];
  alerts: readonly TeachingAlert[];
  pendingReviews: readonly ParentReviewItem[];
  deletionQueue: readonly DeletionRequestRow[];
  // 不含分数、排名，不含模型内部推理，不含桥接原始字段
}

export interface AgentFacingView {
  evidenceLinks: readonly ClaimEvidenceLink[];
  hintHistory: readonly { runId: string; level: number; at: number; proposalId: string }[];
  activeHypotheses: readonly { hypothesisKey: string; status: JudgementStatus; counts: DiscreteCounts }[];
  transferResults: readonly TransferRef[];
  nextChallengeCandidates: readonly { kind: "dueReview" | "discriminatingProbe"; ref: string }[];
}
```

### 2.5 离散守卫（MF-04）

```ts
// growth/discrete-guard.ts —— 按值判定，不猜键名
const RATIO_SUFFIXES = ["Ratio", "Rate", "Confidence", "Probability", "Likelihood"] as const;
const COUNT_FIELDS = new Set([
  "supportingChallenges", "refutingChallenges", "distinctSurfaceContexts",
  "independentTransferSuccesses", "hintedSuccesses", "escalationCount",
  "probesIssued", "consecutiveDeclines", "versionNo", "difficultyBandIndex",
]);

export interface DiscreteViolation { path: string; code: "nonInteger" | "ratioLike" | "declaredRatio" | "negativeCount" }

export function findDiscreteViolations(value: unknown, path = "$"): DiscreteViolation[] {
  // number：非整数一律拒；|x| 在 (0,1) 开区间内一律拒（这就是浮点置信度的形状）
  // 字段名以 RATIO_SUFFIXES 结尾且值是 number：即使是整数也拒（被声明为比率）
  // COUNT_FIELDS：必须是非负整数
  // 字符串、boolean、null 不进 number 分支，probeFamilyId / probeId / scoreBand 因此不会被误伤
  …
}

export function assertDiscreteOnly(value: unknown): void { /* 有违规则抛出并带全部路径 */ }
```

判定要点：`{ probeFamilyId: "x", supportingChallenges: 2 }` 通过；`{ confidence: 0.8 }` 拒（`$.confidence`, `ratioLike`）；`{ probeId: "p1" }` 不误伤；`{ scoreBand: "base" }` 通过（字符串）；`{ qualityRatio: 3 }` 拒（`declaredRatio`，后缀声明为比率，整数也不行）；嵌套数组里的 `0.33` 拒并给出 `$.a[1].x`；`{ supportingChallenges: -1 }` 拒（`negativeCount`）。

### 2.6 禁止标签筛查（MF-05、MF-35）

```ts
// growth/forbidden-labels.ts —— 内核通用词表只写人格化谓词与结构模式，不含任何领域名
export const PERSONA_PATTERNS: readonly string[] = [
  "粗心", "马虎", "毛躁", "没天赋", "天生就", "笨", "蠢", "懒", "不用心", "不专心",
  "注意力不集中", "老走神", "态度不好", "习惯差",
  "不擅长[\\p{Script=Han}A-Za-z0-9]{1,8}",
  "[\\p{Script=Han}]{2,8}(能力)?(差|弱|不行|不好)",
  "一直(都)?(不会|做不好)", "总是(错|不会)", "从来(都)?(不|没)", "永远(不|学不)",
];

export interface LabelHit { field: string; pattern: string }

/** 在候选生成时、预览出站之前调用；覆盖孩子会看到的每一段文字 */
export function screenChildFacingText(
  fields: { childFacingText: string; evidenceSummaryText: string; targetObjectLabel: string; scopeLabel: string },
  extraPatterns: readonly string[],
): LabelHit[] { /* 内核词表 + 插件补充，合并后逐字段扫 */ }
```

**筛查对象**：候选的 `childFacingText`、`evidenceSummaryText`、`targetObject.label`、scope 的儿童版说法；插件提供的 `childFacingGoalPhrase` / `childFacingGuess` / `surfaceContextLabel`（在 `runPluginContract` 与候选生成两处各扫一次）；首次知情说明文案；家长写的 `parentNote`（命中即 400，不落库）。

**不筛查孩子自己的内容**：作品标题、`UTTERANCE`、`EXPLAIN` 原话。词表只作用于系统生成的结论，孩子在画布上写「我今天有点粗心」不得让作品存不进档 1。

第二道（不靠黑名单）：`hasRequiredClaimStructure(candidate)` —— 候选必须有具体 `targetObject` 与非空 `scope.probeFamilyId`，缺一即拒 `shared.forbiddenLabelFree` 的姊妹规则 `shared.recordFieldsComplete`。

### 2.7 儿童版文案的生产（MF-38、MF-09）

**结论：账本里没有任何自由描述字段。孩子看到的每一句话都由内核模板拼装，词来自插件。**

```ts
// growth/child-text.ts —— 模板里只有连接词与数字，学科词全部来自插件字符串
export function renderChildFacingText(input: {
  childFacingGoalPhrase: string;    // 插件给：例如「说清楚这一步为什么成立」
  surfaceContextLabel: string;      // 插件给：例如「换了数字的这种题」
  counts: DiscreteCounts;
}): string {
  return `${input.surfaceContextLabel}里，${input.childFacingGoalPhrase}这件事，` +
         `你自己做出来了 ${input.counts.independentTransferSuccesses} 次。`;
}

export function renderEvidenceSummaryText(input: {
  surfaceContextLabel: string;
  counts: DiscreteCounts;
  selfCorrectionRuns: number;
}): string {
  return `我看到的是：一共 ${input.counts.supportingChallenges} 次这样的题，` +
         `其中 ${input.counts.independentTransferSuccesses} 次你一点提示都没用；` +
         `有 ${input.selfCorrectionRuns} 次是你自己发现不对再改过来的。`;
}

/** 5.7 末句要求的中性呈现：只有两个整数 */
export function renderScaffoldLine(zeroHintRuns: number, totalRuns: number): string {
  return `最近这些题，你自己做出来了 ${zeroHintRuns} 次，一共做了 ${totalRuns} 次。`;
}

/** 活跃猜想的儿童版：整句来自 manifest.hypothesisCatalog[].childFacingGuess，内核一个字不加 */
export function renderActiveGuess(childFacingGuess: string): string { return childFacingGuess; }
```

**Codex 的自由文本永不落库、永不给孩子看、也不给家长看**（§10.5）。`TeachingProposal.memoryCandidate.description` 只在本次会话内存里用作「桥接是否提了同一条主张」的对齐依据；落 `proposals` 表前由 `redactProposalForStorage` 抹掉。理由：12 章「默认不长期保存：未经验证的人格或能力判断」，把它挡在孩子面前却转手长期存下来给家长看，只是换了个出口。

---

## 3. 三档门禁：一份规则表，三个入口，两个阶段

### 3.1 规则表（MF-19）

```ts
// growth/gate-rules.ts
export const GATE_RULESET_ID = "growth-gate-v1";

interface GateRule {
  ruleId: string;
  tiers: readonly (2 | 3)[];
  /** preflight：不依赖孩子同意，预览出站之前就必须过；decide：只有拿到同意才判得了 */
  phase: "preflight" | "decide";
  evaluate(input: GateInput): RuleResult;
}

export const GATE_RULES: readonly GateRule[] = [ /* 下表逐条 */ ];

function runRules(input: GateInput, phase: "preflight" | "decide"): MemoryCommitDecision { /* 不短路 */ }

export function evaluateTier1Gate(input: Tier1GateInput): Tier1GateResult { /* §3.3 */ }
export function preflight(input: GateInput): MemoryCommitDecision { return runRules(input, "preflight"); }
export function decide(input: GateInput): MemoryCommitDecision { return runRules(input, "decide"); }
```

`decide` 跑 `preflight` 的全部规则**再加**只在 decide 生效的规则，因此 `preflight 失败集 ⊆ decide 失败集` 是结构性成立的（有属性测试）。

| ruleId | 档 | 阶段 | 判定 |
|---|---|---|---|
| `shared.firstUseAcknowledged` | 2,3 | preflight | 首次知情说明已确认（9.5 第一条） |
| `shared.snapshotPresent` | 2,3 | preflight | 入参带 `SessionGateSnapshot`（类型必填，删掉编译不过） |
| `shared.snapshotFresh` | 2,3 | decide | `snapshot.takenAt === callAt`：必须是本次调用现取，不接受缓存 |
| `shared.stateIsMemoryPending` | 2,3 | decide | `snapshot.state === "MEMORY_PENDING"` |
| `shared.notAssistedRound` | 2,3 | preflight | `snapshot.assistedRound === false`（粘性口径，硬约束 3） |
| `shared.notFrozenTarget` | 2,3 | preflight | 候选、其 claimKey、其假设都不在 `snapshot.frozenTargets` |
| `shared.notContestedClaim` | 2,3 | preflight | 该 claimKey 无未解决的 contest（**不依赖假设存在**，MF-07） |
| `shared.notReusingFrozenEvidence` | 2,3 | preflight | `evidenceLinkIds ∩ frozenLinkIds = ∅`，且解冻条件满足（§8.2） |
| `shared.claimNotSuppressed` | 2,3 | preflight | 该 claim 无未决删除请求、无未撤销的 suppression |
| `shared.discreteOnly` | 2,3 | preflight | `assertDiscreteOnly(candidate)` 通过 |
| `shared.forbiddenLabelFree` | 2,3 | preflight | `screenChildFacingText` 零命中 |
| `shared.recordFieldsComplete` | 2,3 | preflight | `assertRecordComplete` 七项齐，detail 给缺失字段名 |
| `t2.transferSucceededThisRun` | 2 | preflight | `run.transferOutcome === "succeeded"` |
| `t2.transferUnhinted` | 2 | preflight | `transferHintLevelUsedInRound === 0 && transferTainted === false`（**不看** `maxHintLevelUsed`，5.6 允许 4 级演示后 0 级迁移） |
| `t2.hypothesesKnown` | 2 | preflight | `hypothesisKeys` ⊆ 已存在的 key；**空数组通过**（MF-02 主路径的关键） |
| `t2.rootCauseDiscriminated` | 2 | preflight | `hypothesisKeys.length === 1` ⇒ `snapshot.probeResolved === true`（6.2「不允许模型直接指定唯一根因」） |
| `t2.askAgainAllowed` | 2 | preflight | 冷却与新证据条件（§8.4） |
| `t3.threeComparableChallenges` | 3 | preflight | 窗口内 ≥ 3 个可比支撑 run，且**全部** `assistedRound === false`（硬约束 2 档 3） |
| `t3.trendUsable` | 3 | preflight | 趋势 verdict ∈ `{withdrawing, flat}`；`incomplete` / `insufficient` / `rising` 一律拒 |
| `t3.parentApproved` | 3 | preflight | 存在 `approved` 的 `parent_review` |
| `t3.noApprovalOnContested` | 3 | preflight | 家长批准时该 claim 无未解决 contest（9.5「家长不能在孩子明确异议后静默启用同一结论」） |
| `t3.parentBeforeChild` | 3 | decide | `review.reviewedAt <= candidate.shownAt` |
| `t2.assentNonceMatches` | 2,3 | decide | `assent.previewNonce === candidate.previewNonce` |
| `t2.assentAfterPreview` | 2,3 | decide | `assent.answeredAt >= candidate.shownAt`（**不设时效上限**：重启后隔天回答仍算数，见 §10.7） |
| `t2.assentChoiceIsRecord` | 2,3 | decide | `choice === "record"` |
| `shared.postTransitionCompleted` | 2,3 | decide | `transitionAccepted === true && stateAfterTransition === "COMPLETED"`（§10.8） |

**无论通过与否都落一条 `MemoryCommitDecision`**，带 `rulesetId` 与逐条 `RuleResult`。preflight 失败也落（`phase:"preflight"`），供审计，不含任何自由文本。

### 3.2 两个入口的调用点

- **`preflight`**：在 TRANSFER 成功那一刻、候选草稿构造出来之后、**任何 `memoryPreview` 出站之前**调用；入参**带候选**（草稿是纯内存对象，preflight 不过就不落库、不问孩子）。这样 `askAgainAllowed`、`forbiddenLabelFree`、`notReusingFrozenEvidence`、`rootCauseDiscriminated` 这些候选级规则都在孩子看到之前跑完（MF-19）。
- **`decide`**：在 `recordAssent` 内部跑，跑全量。

先给孩子看儿童版描述、再告诉他其实不能记，是最伤的交互。这个取舍与 9.5「任何进入长期成长记录的结论孩子必须在提交前看到」不冲突：**没有进入长期记录的东西不需要给孩子看**。此取舍在本节显式记一笔。

### 3.3 档 1 门禁（MF-10）

档 1 = 原始作品与会话事件，本地自动保存，不含能力结论，不需要同意。它有**独立的写入函数与独立的门禁函数**：

```ts
export interface Tier1GateInput {
  artifactId: string; versionNo: number; contentRef: string; contentHash: string;
  writer: "host_snapshot" | "child_upload";
  payload: Record<string, unknown>;
}

export function evaluateTier1Gate(input: Tier1GateInput): { ok: boolean; failures: string[] } {
  // t1.noCapabilityClaim：payload 不得含 claim / counts / hypothesisKeys / status 这些结论键（结构判定）
  // t1.hasContentRef：contentRef 与 contentHash 非空
  // t1.noAssentRequired：恒真的声明性规则，写在表里以证明「档 1 不问孩子」是被显式决定的
}
```

档 1 **不跑禁词表**：禁词表只作用于系统生成的结论字段，不作用于孩子自己的内容。

---

## 4. 证据链接与离散摘要

### 4.1 有效质量：账本不信调用方（MF-27）

`resolveConfirmedEvents`（既有纯函数）是「这条转写到底确认了没有」的唯一口径，原 `events` 行永不改写、`content_hash` 永不变。为让账本能按事件 id 单点查询，`SessionStore` 增加一个**派生索引**：

```ts
// store.ts 接口新增三处
export interface SessionStore {
  // …既有方法…
  appendEvent(sessionId: string, stored: StoredEvent, artifactVersionId: string | null): void;
  /** 把 CONFIRM_TRANSCRIPT 折叠回被确认事件后的有效质量；索引可从 events 完整重建 */
  effectiveQualityOf(sessionId: string, eventId: string): EvidenceQuality;
  /** 首个作品版本创建之前落盘的事件回填外键（旧库迁移用） */
  backfillArtifactVersion(sessionId: string, artifactVersionId: string): number;
}
```

SQLite 实现：`appendEvent` 在同一事务里，遇 `CONFIRM_TRANSCRIPT` 就 upsert 一行 `event_confirmations(session_id, target_event_id, confirmed, corrected, at)`（后到覆盖先到）。`InMemorySessionStore` 同构实现。两个实现跑同一套 `store.test.ts` 契约。

`ingestRun` 逐条回查 `effectiveQualityOf`：只有 `confirmed` / `corrected` 才成链接，`unconfirmed` 的计入 `linksSkippedUnconfirmed`（进 Agent 视图，不进计数）。

### 4.2 建链接与算计数

```ts
// growth/evidence-fold.ts
export function buildEvidenceLinks(input: {
  run: ChallengeRun; evidence: readonly DisciplineEvidence[];
  qualityOf: (eventId: string) => EvidenceQuality;
  artifactVersionOf: (eventId: string) => string | null;
}): { links: ClaimEvidenceLink[]; skippedUnconfirmed: number }
```

一条证据可产生多行链接：一行 `hypothesisKey = null`（挂在 claim 上，主张级计数用），加上每个 `hypothesisSupport` 一行。`linkId` 由 `(runId, evidenceId, claimKey, hypothesisKey)` 决定 → 重放同一 run 不双计。claim 行的 `direction`：本 run 内该 claim 的**净方向**（见下）。

```ts
/** 同一 run 内同一 (claimKey, hypothesisKey) 的净方向：按 observedAt 取最后一条；
 *  若期间发生过方向翻转 supports → weakens 且两条之间没有 hintIssued，则标 selfCorrection */
export function foldRunDirection(links: readonly ClaimEvidenceLink[]): "supports" | "weakens";

export function summarizeClaim(links: readonly ClaimEvidenceLink[], runs: readonly ChallengeRun[]): DiscreteCounts;
```

五个计数的口径（唯一口径，档 2 档 3 共用，有没有假设都算得出，MF-26）：

- `supportingChallenges` = `COUNT(DISTINCT runId)`，该 run 对本 claim 净方向为 `supports` 且链接 `status='active'`
- `refutingChallenges` = 同上，净方向 `weakens`
- `distinctSurfaceContexts` = `COUNT(DISTINCT surfaceContextKey)`（active 链接）
- `independentTransferSuccesses` = `COUNT(DISTINCT runId)`，run 满足 `transferOutcome='succeeded' ∧ transferHintLevelUsed=0 ∧ !transferTainted ∧ !assistedRound`
- `hintedSuccesses` = `COUNT(DISTINCT runId)`，run 满足 `transferOutcome='succeeded'` 且（`transferHintLevelUsed>0` 或 `maxHintLevelUsed>0`）

「4 级演示后 0 级迁移」的 run 同时使 `independentTransferSuccesses` 与 `hintedSuccesses` 各 +1 —— 这正是 5.6 要求的：允许写入，但依赖度照常记账。

`growth_records.counts_*` 是缓存列；有一条恒等测试：任意删除/清理操作后，`summarizeClaim` 重算值等于缓存列。

---

## 5. 假设生命周期与区分性探针

### 5.1 假设状态与活跃候选上限（MF-16）

跨轮身份是 `hypotheses.hypothesis_key`（`plugin.manifest.hypothesisCatalog[].id`，跨轮不变）；本轮活跃是 `round_active_candidates(run_id, hypothesis_key)` —— **两件事分开存**，这是 MF-16 的根子。

```ts
// growth/hypothesis.ts
export function activateRoundCandidate(store, runId, hypothesisKey): Result;  // 新增路径
export function reactivateHypothesis(store, hypothesisKey, toStatus): Result; // 状态翻回活跃的路径

/** 两条路径共同调用；不依赖任何表触发器 */
function assertActiveCandidateLimit(store, runId): void {
  if (store.countActiveCandidates(runId) >= ROUND_ACTIVE_CANDIDATE_CAP) throw new GateError("roundCandidateCapReached");
}
```

新 run 开始时，从上一 run 的活跃集**继承**仍活跃（`suspected` / `confirmed`）的假设 —— 上一轮建的 3 个仍占名额，本轮不能再建 3 个。

状态转换：
- `suspected → confirmed`：`supportingChallenges >= CONFIRM_SUPPORT_MIN` 且 `distinctSurfaceContexts >= CONFIRM_SURFACE_MIN`（单一表面情境永远确认不了）
- `任意 → contested`：孩子异议
- `contested → confirmed` **一步到位禁止**：只能先回 `suspected`，再按上面的条件重新确认
- `active 链接归零 → evidence_removed`；新增 active 链接后回 `suspected`
- `now > expiresAt → expired`：由注入时钟驱动，重复跑结果一致

### 5.2 探针的判据（MF-17）

```ts
// growth/probe-selection.ts
function dirOf(probe: DiscriminatingProbe, outcome: string, h: string): "supports" | "weakens" | "none";

/** 两个候选被真正分开：存在两个结果，一个支持 A 而削弱 B，另一个不削弱 B 而削弱 A */
export function separatesTwo(probe: DiscriminatingProbe, a: string, b: string): boolean {
  const keys = Object.keys(probe.outcomes);
  return keys.some((o1) => dirOf(probe, o1, a) === "supports" && dirOf(probe, o1, b) === "weakens")
      && keys.some((o2) => dirOf(probe, o2, b) !== "weakens" && dirOf(probe, o2, a) === "weakens");
}
```

旧判据（`touched.size >= 2` 或「某个候选自己方向不定」）会把「B 压根没出现」判成分开，一律作废。`src/testing/plugin-contract.ts` 的同名检查同步收紧；`mathPlugin` 三个探针与 `fake-plugin` 的 `probe-1` 实测通过。

```ts
export function selectDiscriminatingProbe(input: {
  activeCandidates: readonly { hypothesisKey: string; supporting: number }[];
  probes: readonly DiscriminatingProbe[];
  usedProbeIds: readonly string[];
}): { probe: DiscriminatingProbe; discriminates: readonly [string, string] } | null {
  // 活跃候选 < 2 → 直接 null，不放行（6.2「不允许模型直接指定唯一根因」）
  // top2 = 按 supporting 降序、hypothesisKey 字典序稳定排序
  // 候选探针 = probes.filter(p => separatesTwo(p, top1, top2))
  // 排序：未用过优先 → 触及候选数多优先 → id 字典序（确定性）
}
```

### 5.3 探针的代价口径（MF-17 未修部分，拍死）

- 探针走 §0.2 修改三的 `ASSESSING --probeIssued--> ASSESSING`，**不进 INTERVENING**。
- 探针**不计入** `hintLevel` / `escalationCount` / `maxHintLevelUsed`，**不受**软/硬提示预算约束，出站 `speak` 的 `hintLevel` 为 `0`。
- 探针受独立预算：`PROBE_BUDGET.maxPerRun = 3`、`maxPerAssessing = 1`，且两次探针之间必须有孩子新产出（`RunRecorder.newOutputSinceLastProbe`）。
- 探针问句由插件给（`probe.question`），内核只搬运；长度 ≤ 40 字、最多一个问号，由 `runPluginContract` 校验。
- SDP 另记 `probes_issued`（诊断代价对家长可见），**不进趋势判定**。
- 探针回答分类由 `plugin.classifyProbeOutcome` 做。命中 outcome 后，内核直接把 `probe.outcomes[key]` 构造成一条 `DisciplineEvidence`（`kind:"probe_outcome"`、`summary` 用 outcome key、`fromProbeId` 非空），进证据流。
- `probeResolved` **只在**：命中某 outcome，且该 outcome 对当时 top2 的两个候选方向不同（真把两个分开）时置位；`run.discriminates` 同时记下这两个 id。新候选进入 top2 时 `probeResolved` 归零。
- 答完探针不需要「撤提示」（本来就没发提示），`assess()` 继续走：预算允许就下一个探针，否则走提示阶梯。

### 5.4 跨轮的区分性验证

`CONTESTED → PREPARING` 时把 `requiredProbeId` / `competingHypothesisIds` 写进 `ChallengeInput`；插件造好挑战后内核回校验 `challenge.probeId === requiredProbeId && challenge.discriminates ⊇ 两个候选`；不满足则拒绝该挑战、记 `policyError{guardFailed}`、退回不带探针的普通挑战（不阻塞孩子）。

---

## 6. 脚手架依赖点与跨轮趋势

### 6.1 SDP 的写入口径（MF-31 + 修掉「assisted 点整条排除」）

每个 run 关闭时写**一条** SDP，绑 `developmentGoalId`（不按假设分组：5.7 的比较单位是「同一探针族、相近难度带」，假设级趋势第一版不做）。

```
scaffold_points(point_id, learner_id, run_id, challenge_id,
                goal_kind='developmentGoal', goal_id,
                probe_family_id, difficulty_band, difficulty_band_index,
                max_hint_level_used, escalation_count, probes_issued,
                independent_transfer_succeeded, time_to_first_productive_action_ms,
                self_correction_observed, assisted_round, occurred_at)
```

`difficulty_band_index = manifest.difficultyBands.indexOf(band)`，**记 SDP 时就固化**，账本此后不问插件。`index === -1`（band 不在表里）的点不进趋势并记 policyError。

**软着陆降 band 产生的点照样写、照样进趋势**：5.7 明写 SDP「属系统自评…因此来自所有会话」，而反复软着陆、提示级别抬高恰恰是「最高提示级别上升 → 教学警报」最该抓到的形态。把 `assistedRound` 的点整条排除会把趋势变成只看得见顺利那些轮的假象。分流靠**难度带下标**（降 band 的点自然落到另一个窗口），不靠 `assistedRound`。

**档 3 另行严格**：`t3.threeComparableChallenges` 要求窗口内三个支撑 run **全部** `assistedRound === false`（能力结论不能拿辅助轮作证据）。这两件事分开，互不牵连。

可比判定：`isComparable(p, ref) = p.probeFamilyId === ref.probeFamilyId && p.goalId === ref.goalId && Math.abs(p.difficultyBandIndex - ref.difficultyBandIndex) <= 1`。

### 6.2 趋势算法（MF-28）

```ts
export type TrendVerdict = "withdrawing" | "flat" | "rising" | "incomplete" | "insufficient";

export function analyzeScaffoldTrend(input: {
  points: readonly ScaffoldPointRow[];   // 已按 (learnerId, goalId, probeFamilyId) 过滤，按 occurredAt 升序
  gaps: readonly TrendGapRow[];
}): TrendReport {
  const latest = input.points[input.points.length - 1];
  if (latest === undefined) return { verdict: "insufficient", … };
  const comparable = input.points.filter((p) => isComparable(p, latest));
  const window = comparable.slice(-3);
  const w0 = window[0], w1 = window[1], w2 = window[2];        // 显式收窄，noUncheckedIndexedAccess
  if (w0 === undefined || w1 === undefined || w2 === undefined) return { verdict: "insufficient", … };

  // 1. 数据不完整前置短路：窗口首点之后有未补齐的洞
  const openGap = input.gaps.find((g) => g.removedAt >= w0.occurredAt && g.addedSinceCount < g.removedCount);
  if (openGap) return { verdict: "incomplete", reason: "artifactDeleted", … };

  // 2. rising 优先：最高提示级别上升 → 教学警报。绝不被「0 级迁移比例上升」抢先判成脚手架退出
  if (w2.maxHintLevelUsed > w0.maxHintLevelUsed) {
    return { verdict: "rising", alert: { pauseDifficultyIncrease: true, interventionHistoryRunIds: [w0.runId, w1.runId, w2.runId] }, … };
  }
  if (w2.maxHintLevelUsed < w0.maxHintLevelUsed) return { verdict: "withdrawing", … };

  // 3. 首尾持平时才看前一窗口；前一窗口不足 3 点就绝不把 0 当基线
  const prev = comparable.slice(-6, -3);
  if (prev.length < 3) return { verdict: "flat", teachingAdjustmentSuggested: true, … };
  const zeroNow = window.filter((p) => p.independentTransferSucceeded).length;
  const zeroPrev = prev.filter((p) => p.independentTransferSucceeded).length;
  if (zeroNow > zeroPrev) return { verdict: "withdrawing", … };
  const meanNow = mean(window.map((p) => p.maxHintLevelUsed));
  const meanPrev = mean(prev.map((p) => p.maxHintLevelUsed));
  if (meanNow > meanPrev) return { verdict: "rising", alert: { … }, … };
  return { verdict: "flat", teachingAdjustmentSuggested: true, … };
}
```

抖动（`2,3,2`）落到第 3 步，保守判 `flat` + `teachingAdjustmentSuggested`。

### 6.3 「数据不完整」是当次标记（MF-28、硬约束 7）

`trend_gaps(gap_id, learner_id, goal_id, probe_family_id, difficulty_band_index, removed_count, added_since_count, removed_at)`。删除移走 N 个点时插一行 `removed_count = N, added_since_count = 0`；此后每写一个同三元组、`occurredAt > removed_at` 的新 SDP 就 `added_since_count += 1`；补齐（`added_since_count >= removed_count`）后该 gap 不再短路，趋势自动恢复。永久标脏是错的。

---

## 7. 删除、失效级联与保留清理

### 7.1 单库单连接（MF-11）

```ts
// growth/database.ts —— 全仓唯一 new DatabaseSync 的地方
export type LearningDatabase = DatabaseSync;
export function openLearningDatabase(path: string): LearningDatabase {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA secure_delete = ON;      -- 删除必须真的擦页内容，否则金丝雀扫描不可验证（MF-36）
    PRAGMA foreign_keys = ON;
  `);
  createSessionTables(db);
  createGrowthTables(db);
  return db;
}
```

`SqliteSessionStore` 的构造器改为 `constructor(private readonly db: LearningDatabase)`，不再自己 `new`。会话表与成长表同库同连接，删除整段在**一个** `BEGIN IMMEDIATE … COMMIT`（失败 `ROLLBACK`）里完成。跨连接没有原子事务，这一点没有第二种解法。

### 7.2 删除级联（MF-12、MF-13）

```ts
// growth/deletion.ts —— 纯函数，previewDeletion 与 executeDeletion 用同一个
export interface DeletionInput {
  subject: { kind: "artifact" | "growth_record"; id: string };
  // 由 store 一次性读出的只读快照
  artifactVersions: readonly ArtifactVersionRow[];
  runs: readonly ChallengeRun[];
  links: readonly ClaimEvidenceLink[];
  records: readonly GrowthRecord[];
  points: readonly ScaffoldPointRow[];
  assents: readonly ChildAssentRow[];
  reviews: readonly ParentReviewRow[];
  decisions: readonly MemoryCommitDecision[];
  hypotheses: readonly HypothesisRow[];
  now: number;
}

export interface DeletionPlan {
  redactEventIds: readonly string[];          // events.event_json 文本脱敏
  redactOutboundKeys: readonly { sessionId: string; eventId: string }[];
  redactSnapshotKeys: readonly { sessionId: string; snapshotSeq: number }[];
  redactProposalIds: readonly string[];
  removeArtifactVersionIds: readonly string[];
  removeContentRefs: readonly string[];       // 磁盘文件
  evidenceRemovedLinkIds: readonly string[];  // 转 evidence_removed
  invalidatedRecordIds: readonly string[];    // 失去必需迁移证据 → 立即 evidence_removed
  retiredHypothesisKeys: readonly string[];
  removeScaffoldPointIds: readonly string[];
  newTrendGaps: readonly TrendGapRow[];
  voidedAssentIds: readonly string[];
  voidedReviewIds: readonly string[];
  redactedDecisionIds: readonly string[];
  audit: DeletionAuditEntry;                  // 只有 id、枚举、计数、时间与 id 列表，没有任何自由文本
}

export function planDeletionCascade(input: DeletionInput): DeletionPlan;
export function previewDeletion(input: DeletionInput): DeletionPreview;   // 只输出计数，文字现算
```

**执行顺序（单事务内）**：

1. 解析被删范围：作品 → 其全部版本；记录 → 该记录本身（不动作品）。
2. **清会话库里孩子的原话与提案文本**（MF-12）：`events.event_json`、`outbound.messages_json`、`snapshots.snapshot_json`、`proposals.proposal_json`。
   - 归属判据一：`events.artifact_version_id`（**服务端列**，编排器落盘时填，覆盖不带客户端 `artifactVersion` 的纯语音转写事件）。
   - 归属判据二（提案与出站）：`proposals.run_id`（编排器 `saveProposal` 时带上当轮 runId）与 `run.firstServerSeq..lastServerSeq` 区间。
3. 链接转 `evidence_removed`（不删行，保留 `linkId` 幂等审计）。
4. 重算受影响 claim 与假设的计数；active 链接归零的假设转 `evidence_removed`。
5. 记录失效：`requiredTransferLinkIds` 全部失效的记录 → `status='evidence_removed'`，退出 `activeModel()` 与 `personalizationInputs()`。
6. SDP 移除 + 插 `trend_gaps` 行。
7. **显式作废**同意与家长审阅：`child_assents.voided_at`、`parent_reviews.voided_at`（不依赖 `evidenceSetHash` 自动变——删除只往另一张表加行，哈希根本不变；同时 `evidenceSetHash` 的口径改为只算 active 链接，两条路都验）。
8. 决策脱敏：`memory_decisions` 只留 `decision_id` 与 `failures`，`child_facing_text` / `evidence_summary_text` 置空串。
9. 删作品版本行与磁盘目录。
10. 写 `ledger_audit` 一行（只有 id、枚举、计数、时间与 id 列表）。
11. `COMMIT` 之后：`PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM`。

### 7.3 脱敏后的最小可解析形状（修「脱敏后 JSON.parse 会炸」）

清理与删除一律**脱敏不删行**，且脱敏结果必须仍是合法结构，因为 `listEvents` / `latestSnapshot` 会 `JSON.parse` 回结构体并被 `SessionOrchestrator.restore` 的 `absorb` 直接消费。

```ts
// growth/retention.ts
export function redactEventPayload(p: EventPayload): EventPayload {
  // 保持 type 与所有非文本字段；文本字段置 ""；STROKE.contentHash / bounds 原样保留（幂等判重要用）
}
export function redactSnapshot(s: SessionSnapshot): SessionSnapshot {
  // runtime.lastSpoken = null；runtime.lastLearnerTask = ""；evidence[].summary = ""；结构不动
}
export function redactProposalForStorage(r: ProposalRecord): ProposalRecord {
  // spokenResponse = ""；learnerTask = "（已删除）"（schema min(1)）；canvasActions = []；memoryCandidate 去掉
}
```

三张表各加一列 `redacted INTEGER NOT NULL DEFAULT 0`。`event_id` / `client_seq` / `content_hash` / `quality` 四列永不变 → 重放同一 `event_id` 仍走 `duplicate`、不重复计证据。

**被拒的提案自由文本从一开始就不落库**：`saveProposal` 在写入前对 `accepted === false` 的记录调 `redactProposalForStorage`（只留 `proposalId` / `accepted` / `reasons` / `hintLevel` / `runId` / `decidedAt`）。被接受的提案保留全文（它是教学动作的审计），但同样进 30 天清理与删除级联。

### 7.4 孩子的删除请求闭环（MF-24）

- 孩子发起时**先看到与家长同一份影响范围**（`previewDeletion` 的计数 + 一句渲染出来的话，例如「这会让这句话和另外 2 条记录消失」），确认后才提交请求。
- **提交那一刻起目标立即停用**：记录 `suppressedReason='deletionRequested'`，不进 `activeModel()`、不进 `personalizationInputs()`、不进 `dueReviews`；孩子视图上该条显示「这条我先不用了，等爸爸妈妈看一下」。
  家长**拒绝也不解除**停用。解除只有两条路：孩子自己撤回请求，或家长拒绝后孩子在结果卡片上主动选「知道了，可以继续用」。这是 9.5「家长不能在孩子明确异议后静默启用同一结论」的直接落地。
- **超时**：`DELETION_SLA_MS = 7 天` 未处理 → `parent_signals{kind:'deletionSlaBreached'}`，家长队列置顶标红。**不自动执行删除**（删除不可逆），但停用一直有效。
- **复核**：家长拒绝后孩子可以再请求（唯一索引是部分索引，只约束 `pending`），第二次自动带 `escalated=1`，家长控制台显示「孩子第 2 次请求」。
- **记录级删除**：`subjectKind='growth_record'`，孩子不必删掉整件作品才能去掉一句话。
- **执行前重算**：`executeDeletion` 重新跑 `planDeletionCascade`，与预览时的计数不一致就中止并返回 `deletionPreviewStale`。

### 7.5 30 天保留清理（MF-29）

```ts
export function planRetentionPrune(input: {
  now: number;
  events: readonly { eventId: string; receivedAt: number; redacted: boolean }[];
  referencedEventIds: ReadonlySet<string>;    // 反向依赖显式化：由 GrowthReadPort.referencedEventIds() 提供
  proposals: readonly { proposalId: string; decidedAt: number; accepted: boolean; redacted: boolean }[];
}): RetentionPlan
```

由 `GrowthLedgerService.sweepRetention(now)` 执行——它同时持有会话表与成长表，反查引用不需要跨进程。`apps/agent-host/src/retention-job.ts` 每天跑一次。清理只脱敏不删行；被记录引用的事件永不脱敏。

---

## 8. 异议冻结、再问冷却与家长纠正

### 8.1 CONTEST 的目标永远填得出（MF-06）

`CONTEST.target` **必填**。儿童端按当前呈现内容填，优先级：

1. 当前 `memoryPreview` 的 `contestTarget`（`{kind:"candidate", id}`）
2. 最近一条 `speak` 携带的 `contestTarget`（`{kind:"proposal", id}`）
3. 最近一条 `learnerTask` 携带的 `contestTarget`（`{kind:"hypothesis", id}`，在 `INDEPENDENT` 只有任务没有 speak 时也填得出）
4. 兜底 `{kind:"session", id: sessionId}` —— 「我不同意你现在对我的理解」

出站 `speak` 与 `learnerTask` 因此都加 `contestTarget` 字段。`ChildSessionView.swift:127` 的 `contest(targetId: nil)` 彻底消失。

**目标 → claimKey 的分派**：

- `candidate` / `record` → 直接拿到 `claimKey`
- `hypothesis` → 该假设当前挂着的全部 `claimKey`
- `proposal` → 查 `proposal_hypotheses` 表。**写入者与时机拍死**：编排器在 `emitProposal` 之后（提案被校验接受、确实说给了孩子）写入 `(proposalId, hypothesisKey)`，key 取自 `RunRecorder.activeCandidates()`（该提案发出时正在驱动教学的假设集）。
- `session` → 本轮全部活跃候选 + 本轮 claimKey

### 8.2 冻结的一等对象是 claimKey，不是假设（MF-07）

干净成功路径上的档 2 候选可以没有任何假设（这正是 MF-02 的关键）。如果冻结只挂在假设上，孩子按「不是这样」之后，同一 claimKey 会在下一次可比迁移成功时被原样重新生成，异议退化成减速带。因此：

```
contests(contest_id, learner_id, subject_kind, subject_id, session_id, run_id, event_id,
         claim_keys_json, contested_at, resolved_at, resolution)
contest_frozen_links(contest_id, link_id)      -- 当时支撑这些 claim 的全部证据链接
contest_frozen_points(contest_id, point_id)
```

- `shared.notContestedClaim`：该 claimKey 存在 `resolved_at IS NULL` 的 contest 时，档 2 档 3 一律拒。**不依赖假设是否存在。**
- 被指向的假设与已提交记录同时转 `contested`：`activeModel()` 不返回、`personalizationInputs()` 不返回、不用于个性化、不进孩子视图的「我新学会的方法」。
- **解冻**（`canUnfreeze`）三条件缺一不可：存在至少一条新链接，且 ① 不在 `contest_frozen_links` 内，② `observedAt > contestedAt`，③ 来自 `run.discriminates` 非空的区分性 run。满足后 contest 置 `resolved`，假设/记录回 `suspected`（**不是** `confirmed`）。
- 用原证据重提 → `rejected(shared.notReusingFrozenEvidence)`。
- 档 3 趋势记录适用同一规则（冻结 `pointIds`）。

### 8.3 家长的纠正：结构上写不出孩子没看过的句子（MF-22）

**家长不能撰写孩子将看到的任何文字。** 审阅与纠正只有下面这些动作：

| 动作 | 效果 |
|---|---|
| `approve` / `reject`（档 3 事前审阅） | 只有批准/拒绝，可写 `parentNote`（**只给家长自己看**，过禁词表，删除时一并抹，不长期保留超过记录本身） |
| `narrowScope`（档 2 已提交记录） | 从内核给的枚举里选更窄的 `scope`（收窄到单一 `difficultyBandIndex` 或单一 `surfaceContextKey`）。scope 一变，`childFacingText` 由模板重新渲染成孩子没看过的一句 → **作废原同意**、记录退回 `awaiting_reassent`、退出 `activeModel()`、返回 `needsReassent: true` |
| `downgrade` | 记录降回 `suspected`，退出活动模型 |
| `retract` | 记录级撤回（不动作品） |
| `export` | 导出完整档案（12 章） |

**contested 记录禁止任何纠正**（`parent.cannotCorrectContested`）。
**跨轮趋势记录只有事前审阅，没有纠正**（`parent.cannotCorrectTrend`）——而且路由层根本不存在这个入口，比校验更硬。

**被纠正的记录怎么重新问孩子**（MF-22 未修部分）：`awaiting_reassent` 的候选进入 §10.4 的候选取用队列，优先级最高。它会在**下一次同族迁移成功时**被端到孩子面前。本设计**刻意不为「重新问」新增打断孩子的入口**（5.0 表进 `MEMORY_PENDING` 只有 TRANSFER 成功与 CONTESTED 验证完成两条）；在此期间记录不进活动成长模型，所以不伤害孩子。家长控制台显示「这条要等下一次同类题做完才会问孩子」。

### 8.4 拒绝之后（MF-20）

孩子选「不确定」或「不是这样」之后：

- 候选 `status = declined_unsure` / `contested`；该 claim **不进** `activeModel()`。
- 对应假设 `stops_driving_personalization = 1`：不进 `personalizationInputs()`、不参与探针选择的 top2、不影响下一次挑战的难度带。**不允许改个名字继续用。**
- 再问必须同时满足（`t2.askAgainAllowed`，在 **preflight** 层跑，孩子不会被重新问一遍才知道在冷却期）：
  - `now - lastDeclinedAt >= ASK_AGAIN_COOLDOWN_MS`（14 天）
  - `runsSinceLastAsk >= 1`
  - 存在 `observedAt > lastDeclinedAt` 且来自**新** `surfaceContextKey` 的 active 链接
- 连续拒绝只产出 `parent_signals{kind:'repeatedDecline'}` 进家长视图，**不影响难度带与提示阶梯**（有对比测试：连拒 3 次前后孩子端行为完全一致）。

---

## 9. 数据库

### 9.1 会话侧表的改动

```sql
-- events 加两列：服务端归属外键 + 脱敏标记
ALTER TABLE events ADD COLUMN artifact_version_id TEXT;
ALTER TABLE events ADD COLUMN redacted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS events_artifact ON events(artifact_version_id);

-- proposals 加 run 归属 + 脱敏标记
ALTER TABLE proposals ADD COLUMN run_id TEXT;
ALTER TABLE proposals ADD COLUMN redacted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE snapshots ADD COLUMN redacted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbound  ADD COLUMN redacted INTEGER NOT NULL DEFAULT 0;

-- 转写确认的派生索引；可从 events 完整重建，原事件行永不改写
CREATE TABLE IF NOT EXISTS event_confirmations (
  session_id TEXT NOT NULL, target_event_id TEXT NOT NULL,
  confirmed INTEGER NOT NULL, corrected INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (session_id, target_event_id));

-- 提案发出时正在驱动教学的假设：CONTEST 指向 proposal 时靠它分派（写入者见 §8.1）
CREATE TABLE IF NOT EXISTS proposal_hypotheses (
  proposal_id TEXT NOT NULL, hypothesis_key TEXT NOT NULL, recorded_at INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, hypothesis_key));
```

### 9.2 成长侧表

```sql
CREATE TABLE IF NOT EXISTS learners (
  learner_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);

-- ══ 档 1：作品与版本链 ══
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, session_id TEXT NOT NULL,
  discipline TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS artifact_versions (
  artifact_version_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, version_no INTEGER NOT NULL,
  writer TEXT NOT NULL CHECK (writer IN ('host_snapshot','child_upload')),
  content_ref TEXT NOT NULL, content_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
  written_by TEXT NOT NULL CHECK (written_by = 'GrowthLedgerService'),
  UNIQUE (artifact_id, version_no));

-- ══ run、链接、假设 ══
CREATE TABLE IF NOT EXISTS challenge_runs (
  run_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, session_id TEXT NOT NULL, challenge_id TEXT NOT NULL,
  discipline TEXT NOT NULL, probe_family_id TEXT NOT NULL, difficulty_band TEXT NOT NULL,
  difficulty_band_index INTEGER NOT NULL, development_goal_id TEXT NOT NULL, claim_key TEXT NOT NULL,
  surface_context_key TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER, first_server_seq INTEGER NOT NULL, last_server_seq INTEGER NOT NULL,
  max_hint_level_used INTEGER NOT NULL, escalation_count INTEGER NOT NULL, probes_issued INTEGER NOT NULL,
  transfer_outcome TEXT NOT NULL CHECK (transfer_outcome IN ('succeeded','failed','none')),
  transfer_hint_level_used INTEGER NOT NULL, transfer_tainted INTEGER NOT NULL,
  reconstructed INTEGER NOT NULL, assisted_round INTEGER NOT NULL, self_correction_observed INTEGER NOT NULL,
  time_to_first_productive_action_ms INTEGER, probe_resolved INTEGER NOT NULL, discriminates_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS run_artifacts (run_id TEXT NOT NULL, artifact_version_id TEXT NOT NULL, PRIMARY KEY (run_id, artifact_version_id));

CREATE TABLE IF NOT EXISTS claim_evidence_links (
  link_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, run_id TEXT NOT NULL,
  event_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
  claim_key TEXT NOT NULL, hypothesis_key TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('supports','weakens')),
  surface_context_key TEXT NOT NULL, from_probe_id TEXT, self_correction INTEGER NOT NULL,
  artifact_version_id TEXT, observed_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','evidence_removed')),
  written_by TEXT NOT NULL CHECK (written_by = 'GrowthLedgerService'));
CREATE INDEX IF NOT EXISTS links_claim ON claim_evidence_links(learner_id, claim_key, status, observed_at);
CREATE INDEX IF NOT EXISTS links_event ON claim_evidence_links(event_id);

CREATE TABLE IF NOT EXISTS hypotheses (
  hypothesis_key TEXT NOT NULL, learner_id TEXT NOT NULL, discipline TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('suspected','confirmed','refuted','contested','expired','evidence_removed')),
  stops_driving_personalization INTEGER NOT NULL DEFAULT 0,
  c_supporting INTEGER NOT NULL DEFAULT 0, c_refuting INTEGER NOT NULL DEFAULT 0,
  c_distinct_surfaces INTEGER NOT NULL DEFAULT 0, c_independent_transfers INTEGER NOT NULL DEFAULT 0,
  c_hinted_successes INTEGER NOT NULL DEFAULT 0,
  last_observed_at INTEGER, expires_at INTEGER, PRIMARY KEY (learner_id, hypothesis_key));

-- 本轮活跃 ≠ 跨轮身份（MF-16）
CREATE TABLE IF NOT EXISTS round_active_candidates (
  run_id TEXT NOT NULL, hypothesis_key TEXT NOT NULL, activated_at INTEGER NOT NULL,
  demoted_at INTEGER, PRIMARY KEY (run_id, hypothesis_key));

-- ══ SDP 与趋势洞 ══（列见 §6.1）
CREATE TABLE IF NOT EXISTS scaffold_points ( … );
CREATE INDEX IF NOT EXISTS sdp_window ON scaffold_points(learner_id, goal_id, probe_family_id, difficulty_band_index, occurred_at);
CREATE TABLE IF NOT EXISTS trend_gaps (
  gap_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, goal_id TEXT NOT NULL, probe_family_id TEXT NOT NULL,
  difficulty_band_index INTEGER NOT NULL, removed_count INTEGER NOT NULL,
  added_since_count INTEGER NOT NULL DEFAULT 0, removed_at INTEGER NOT NULL);

-- ══ 候选、同意、审阅、决策、记录 ══
CREATE TABLE IF NOT EXISTS memory_candidates (
  candidate_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, tier INTEGER NOT NULL CHECK (tier IN (2,3)),
  claim_key TEXT NOT NULL, target_object_id TEXT NOT NULL, target_object_label TEXT NOT NULL,
  scope_probe_family_id TEXT NOT NULL, scope_band_index INTEGER NOT NULL, scope_surfaces_json TEXT NOT NULL,
  counts_json TEXT NOT NULL, evidence_link_ids_json TEXT NOT NULL, hypothesis_keys_json TEXT NOT NULL DEFAULT '[]',
  transfer_refs_json TEXT NOT NULL, max_hint_level_at_achievement INTEGER NOT NULL,
  next_verification_json TEXT NOT NULL,
  child_facing_text TEXT NOT NULL,            -- 内核模板渲染，非自由文本
  evidence_summary_text TEXT NOT NULL,
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('bridge','kernel','bridge+kernel')),
  preview_nonce TEXT, shown_at INTEGER,
  status TEXT NOT NULL CHECK (status IN
    ('awaiting_parent','awaiting_child','awaiting_reassent','held','declined_unsure','contested','committed','superseded')),
  created_at INTEGER NOT NULL,
  written_by TEXT NOT NULL CHECK (written_by = 'GrowthLedgerService'),
  UNIQUE (candidate_id, preview_nonce));

CREATE TABLE IF NOT EXISTS child_assents (
  assent_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, preview_nonce TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('record','unsure','disagree')),
  assent_event_id TEXT NOT NULL, shown_at INTEGER NOT NULL, answered_at INTEGER NOT NULL,
  voided_at INTEGER, voided_reason TEXT CHECK (voided_reason IS NULL OR voided_reason IN ('parent_narrowed_scope','evidence_removed')),
  UNIQUE (candidate_id, preview_nonce));

CREATE TABLE IF NOT EXISTS parent_reviews (
  review_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  narrowed_scope_json TEXT, parent_note TEXT,     -- note 只给家长看，过禁词表，删除时一并抹
  reviewed_at INTEGER NOT NULL, voided_at INTEGER);

CREATE TABLE IF NOT EXISTS memory_decisions (
  decision_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
  tier INTEGER NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('preflight','decide')),
  ruleset_id TEXT NOT NULL, rule_results_json TEXT NOT NULL, failures_json TEXT NOT NULL,
  child_choice TEXT, parent_review_id TEXT, assisted_round INTEGER NOT NULL,
  committed INTEGER NOT NULL, record_id TEXT, reason_code TEXT,
  child_facing_text TEXT NOT NULL DEFAULT '',     -- 删除时置空串（§7.2 步骤 8）
  evidence_summary_text TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL CHECK (decided_by = 'GrowthLedgerService'), decided_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS growth_records (
  record_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, tier INTEGER NOT NULL CHECK (tier IN (2,3)),
  claim_key TEXT NOT NULL, discipline TEXT NOT NULL, probe_family_id TEXT NOT NULL,
  development_goal_id TEXT NOT NULL, target_object_id TEXT NOT NULL, target_object_label TEXT NOT NULL,
  scope_band_index INTEGER NOT NULL, scope_surfaces_json TEXT NOT NULL,
  child_facing_text TEXT NOT NULL, evidence_summary_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN
    ('suspected','confirmed','refuted','contested','expired','evidence_removed')),
  suppressed_reason TEXT CHECK (suppressed_reason IS NULL OR suppressed_reason = 'deletionRequested'),
  evidence_link_ids_json TEXT NOT NULL, required_transfer_link_ids_json TEXT NOT NULL,
  hypothesis_keys_json TEXT NOT NULL DEFAULT '[]',
  c_supporting INTEGER NOT NULL, c_refuting INTEGER NOT NULL, c_distinct_surfaces INTEGER NOT NULL,
  c_independent_transfers INTEGER NOT NULL, c_hinted_successes INTEGER NOT NULL, last_observed_at INTEGER,
  transfer_refs_json TEXT NOT NULL, trend_ref_json TEXT,
  max_hint_level_at_achievement INTEGER NOT NULL,
  next_verification_json TEXT NOT NULL, next_verification_due_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  decision_id TEXT NOT NULL, committed_at INTEGER NOT NULL, retracted_at INTEGER,
  written_by TEXT NOT NULL CHECK (written_by = 'GrowthLedgerService'),
  -- 档 2 的迁移必须无提示：数据库层再挡一次
  CHECK (tier <> 2 OR json_extract(transfer_refs_json, '$[0].transferHintLevelUsed') = 0),
  CHECK (tier <> 3 OR trend_ref_json IS NOT NULL));
CREATE INDEX IF NOT EXISTS rec_active ON growth_records(learner_id, discipline, status, retracted_at, suppressed_reason);
CREATE INDEX IF NOT EXISTS rec_due    ON growth_records(learner_id, next_verification_due_at);

-- ══ 异议、冷却、信号、删除请求、知情、审计 ══
CREATE TABLE IF NOT EXISTS contests ( … );            -- §8.2
CREATE TABLE IF NOT EXISTS contest_frozen_links (contest_id TEXT NOT NULL, link_id TEXT NOT NULL, PRIMARY KEY (contest_id, link_id));
CREATE TABLE IF NOT EXISTS contest_frozen_points (contest_id TEXT NOT NULL, point_id TEXT NOT NULL, PRIMARY KEY (contest_id, point_id));

CREATE TABLE IF NOT EXISTS decline_signals (
  learner_id TEXT NOT NULL, claim_key TEXT NOT NULL,
  consecutive_declines INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_declines >= 0),
  last_asked_at INTEGER, last_declined_at INTEGER,
  runs_since_last_ask INTEGER NOT NULL DEFAULT 0 CHECK (runs_since_last_ask >= 0),
  PRIMARY KEY (learner_id, claim_key));

CREATE TABLE IF NOT EXISTS parent_signals (
  signal_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('repeatedDecline','teachingAlert','trendIncomplete','deletionSlaBreached')),
  subject_id TEXT NOT NULL, count INTEGER NOT NULL, created_at INTEGER NOT NULL, acknowledged_at INTEGER);

-- 影响范围只存计数，不存任何自由文本；文字每次现算（修版本 B 的 preview_json 泄漏）
CREATE TABLE IF NOT EXISTS deletion_requests (
  request_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('artifact','growth_record')),
  subject_id TEXT NOT NULL,
  requested_by TEXT NOT NULL CHECK (requested_by IN ('child','parent')),
  requested_at INTEGER NOT NULL, escalated INTEGER NOT NULL DEFAULT 0,
  affected_records INTEGER NOT NULL, affected_artifact_versions INTEGER NOT NULL,
  affected_points INTEGER NOT NULL, affected_links INTEGER NOT NULL, preview_computed_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  decided_at INTEGER, decided_by TEXT CHECK (decided_by IS NULL OR decided_by = 'parent'),
  outcome_code TEXT CHECK (outcome_code IS NULL OR outcome_code IN
    ('deleted','kept_needed_evidence','kept_parent_declined','withdrawn_by_child')),
  audit_id TEXT);
-- 「同一 subject 同时只能有一条待办」用部分唯一索引；把 status 写进 UNIQUE 会在第二次被拒时炸
CREATE UNIQUE INDEX IF NOT EXISTS del_req_one_pending
  ON deletion_requests(learner_id, subject_kind, subject_id) WHERE status = 'pending';

-- 结果回传给孩子：只存文案键与计数，库里不留自由文本
CREATE TABLE IF NOT EXISTS child_notifications (
  notification_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deletionResolved','recordRetracted','contestResolved')),
  subject_id TEXT NOT NULL, text_key TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER);

CREATE TABLE IF NOT EXISTS first_use_notices (
  learner_id TEXT PRIMARY KEY, version INTEGER NOT NULL, text_hash TEXT NOT NULL, acknowledged_at INTEGER NOT NULL);

-- 最小审计项：只有 id、枚举、计数、时间与 id 列表，没有任何自由文本列
CREATE TABLE IF NOT EXISTS ledger_audit (
  audit_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, occurred_at INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('child','parent','system')),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('artifact_deleted','record_deleted','record_retracted','retention_pruned')),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('artifact','growth_record','sweep')),
  subject_id TEXT NOT NULL,
  n_events INTEGER NOT NULL DEFAULT 0, n_outbound INTEGER NOT NULL DEFAULT 0, n_snapshots INTEGER NOT NULL DEFAULT 0,
  n_proposals INTEGER NOT NULL DEFAULT 0, n_links INTEGER NOT NULL DEFAULT 0, n_hypotheses INTEGER NOT NULL DEFAULT 0,
  n_records INTEGER NOT NULL DEFAULT 0, n_points INTEGER NOT NULL DEFAULT 0,
  n_assents INTEGER NOT NULL DEFAULT 0, n_decisions INTEGER NOT NULL DEFAULT 0,
  retired_record_ids_json TEXT NOT NULL DEFAULT '[]',
  retired_hypothesis_keys_json TEXT NOT NULL DEFAULT '[]',
  voided_assent_ids_json TEXT NOT NULL DEFAULT '[]');
```

`ledger_audit` 与 `deletion_requests` 的列类型纪律是可执行的：全库只有枚举、计数、时间与 id。配一条「把被删原文当子串扫全表」的测试，将来有人想往审计里塞摘要，会同时撞上没有可用列和这条测试。

### 9.3 唯一写入者的机械保障（MF-03）

**先说清一条做不到的验收**：MF-03 要求「编排器与网关拿到的类型上不存在提交入口」。孩子的同意必须由会话侧在「按下按钮那一刻」递交（这正是硬约束 3 与 MF-01 的要求），所以某个会话侧持有的类型上必然存在一个会导致提交的方法。本设计把它**隔离到一个只有一个方法的端口**上，并用五条机械保障替代那句字面验收，理由在此写明。

```ts
// growth/ports.ts —— 五个窄端口，编排器只拿前两个
export interface GrowthReadPort {                 // 只读
  activeModel(learnerId: string, discipline: string): readonly GrowthRecord[];
  personalizationInputs(learnerId: string, discipline: string): readonly HypothesisRow[];
  dueReviews(learnerId: string, discipline: string, now: number): readonly DueReview[];
  referencedEventIds(): ReadonlySet<string>;
}
export interface GrowthSessionPort extends GrowthReadPort {     // 编排器：写 run 与候选，不写记录
  ingestRun(input): IngestResult;
  ingestArtifactVersion(input): { artifactVersionId: string };  // 档 1，不叫 commit*
  buildAndPreflight(input): { candidate: MemoryCandidate | null; decision: MemoryCommitDecision | null };
  nextCandidateToAsk(learnerId, discipline, snapshot): MemoryCandidate | null;
  evaluateAssent(input): { wouldCommit: boolean; draft: MemoryCommitDecision };   // 只读裁决，不落库
  contest(input): { contestId: string; frozenClaimKeys: readonly string[] };
  holdCandidate(candidateId: string): void;
}
export interface GrowthAssentPort {               // 全系统唯一会产生 committed 记录的端口，只有一个方法
  recordAssent(input: RecordAssentInput): MemoryCommitDecision;
}
export interface GrowthParentPort { … }
export interface GrowthChildPort  { … }
```

五条机械保障：

1. `GrowthLedgerService.open({ db, clock })` 是唯一构造入口（`private constructor` + 静态工厂），`#store` 私有字段持有 `GrowthStore`，`#commitRecord` 私有方法。
2. `growth/store/growth-sqlite.ts` 与 `growth/database.ts` 不从包 `index.ts` 导出（导出清单快照测试）。
3. 机械扫描 `packages/` 与 `apps/` 下全部 `.ts`：除 `growth/ledger-service.ts` 与 `growth/store/` 自身外，任何文件 import `growth-sqlite.js` 或 `GrowthSqliteStore` 即失败；除 `growth/database.ts` 外任何文件 import `node:sqlite` 即失败。
4. 端口方法穷举：遍历 `GrowthReadPort` / `GrowthSessionPort` / `GrowthParentPort` / `GrowthChildPort` 上的所有方法，逐个调用后 **`growth_records` 全表内容哈希不变**（不是 `COUNT(*)` —— 那对 `narrowScope` 这类改写恒绿）。
5. 类型级：上述四个端口上不存在任何**返回 `MemoryCommitDecision` 的方法**（按返回类型判，不按名字前缀猜；`evaluateAssent` 返回的是 `{wouldCommit, draft}` 包装类型，不是它本身）；`GrowthAssentPort` 只有一个方法。

数据库层再加 `written_by` / `decided_by` 的 CHECK 常量作为第六道（它挡不住拿到同一 db 句柄的人，所以只是补充，不是主要手段——保障 3 才是）。

---

## 10. 编排器接入点

### 10.1 依赖与生命周期（MF-33）

```ts
export interface OrchestratorDeps {
  sessionId: string;
  learnerId: string;                       // 家庭单用户默认 "child-1"，从 ~/.ai-scholar/learner.json 读
  plugin: DisciplinePlugin;
  bridge: RealtimeBridge;
  store: SessionStore;
  clock: () => number;
  challengeInput: ChallengeInput;
  confirmationTimeoutMs?: number | undefined;
  /** 可选：不接账本时走 NULL_LEDGER，闭环照跑（9.5） */
  ledger?: GrowthSessionPort | undefined;
  assent?: GrowthAssentPort | undefined;
}
```

内部：`private readonly ledger = deps.ledger ?? NULL_LEDGER.session;`、`private readonly assentSink = deps.assent ?? NULL_LEDGER.assent;`

**宿主侧生命周期**（`apps/agent-host/src/growth-wiring.ts`）：`buildHostServer` 里
`const db = openLearningDatabase(join(dataDir, "ai-scholar.sqlite"))`
→ `const ledger = GrowthLedgerService.open({ db, clock })`（**进程级持有一次**，趋势是跨会话的，账本必须比会话活得久）
→ `const store = new SqliteSessionStore(db)`（同一连接）
→ `createSessionHost({ ledger: ledger.sessionPort(), assent: ledger.assentPort(), childPort: ledger.childPort(), parentPort: ledger.parentPort(), store, learnerId, … })`
→ `app.addHook("onClose", () => ledger.close())`（关掉的是 db，只此一处）。

### 10.2 状态机改动

```ts
// session-state.ts
| { kind: "contest"; target: ContestTarget }                                   // 必填
| { kind: "memoryAssent"; choice: "record" | "unsure" | "disagree"; localRulesPassed: boolean }
| { kind: "memoryHeld" }                                                       // 新增（0.2 修改二）
| { kind: "probeIssued" }                                                      // 新增（0.2 修改三）
```

`SessionContext.frozenTargetIds: string[]` → `frozenTargets: readonly ContestTarget[]`（按 `kind+id` 去重）。`proposal-validator.ts` 里 `context.frozenTargetIds.includes(proposal.proposalId)` 改为 `context.frozenTargets.some(t => t.kind === "proposal" && t.id === proposal.proposalId)`。

四行改动：

```ts
{ from: "MEMORY_PENDING", signal: "memoryAssent",
  guard: (_ctx, s) => s.kind !== "memoryAssent" || s.choice !== "record" || s.localRulesPassed,
  to: (s) => (s.kind === "memoryAssent" && s.choice === "disagree" ? "CONTESTED" : "COMPLETED"),
  actions: (s) => s.kind !== "memoryAssent" ? []
    : s.choice === "record" ? ["commitGrowthRecord"]
    : s.choice === "unsure" ? ["keepCandidateTemporary"] : ["freezeAndPlanVerification"] },
{ from: "MEMORY_PENDING", signal: "memoryHeld", to: "COMPLETED", actions: ["keepCandidateTemporary"] },
{ from: "ASSESSING", signal: "probeIssued", to: "SAME", actions: ["askDiscriminatingProbe"] },
{ from: "ASSESSING", signal: "childOutput", to: "SAME", actions: [],
  update: (ctx, s) => (s.kind === "childOutput" && s.isNewStrategy ? childOutputUpdate(ctx) : {}) },
```

新增 `KernelAction`：`"askDiscriminatingProbe"`。

### 10.3 `RunRecorder`（`growth/run-recorder.ts`，会话级、可序列化，MF-14）

```ts
export class RunRecorder {
  /** 每次 challengeValidated 都调（含 SOFT_LANDING → PREPARING → challengeValidated 的路径），完整清零并生成新 runId */
  beginRun(challenge: LearningChallenge, bandIndex: number, firstServerSeq: number, at: number): void;
  noteFirstProductiveAction(at: number): void;      // 首次 childOutput{isNewStrategy:true}
  noteChildOutput(at: number): void;                // 置 newOutputSinceLastProbe = true
  noteHint(level: number, at: number): void;
  enterTransfer(at: number): void;                  // EXPLAIN_BACK → TRANSFER
  noteTransferOutcome(o: "succeeded" | "failed"): void;
  noteReconstructed(): void;
  /** 每次 apply() 之后由编排器统一同步：if (ctx.assistedRound) recorder.noteAssisted() */
  noteAssisted(): void;
  noteProbeIssued(probeId: string, discriminates: readonly [string, string], at: number): void;
  noteProbeOutcome(outcomeKey: string, separated: boolean): void;
  noteEvidence(e: DisciplineEvidence, at: number): void;
  noteArtifactVersion(id: string): void;
  noteServerSeq(seq: number): void;
  activeCandidates(): readonly { hypothesisKey: string; supporting: number }[];
  usedProbeIds(): readonly string[];
  snapshot(now: number): ChallengeRun;              // 只有这一个取值方法，没有 peek()
  toJSON(): RunRecorderState;
  static from(s: RunRecorderState): RunRecorder;
}
```

`noteHint` 的关键逻辑（堵住 MF-14 的整条绕法）：

```
noteHint(level, at):
  maxHintLevelUsed = max(maxHintLevelUsed, level)
  escalationCount += 1
  if (transferOpen):
      transferHintLevelUsed = max(transferHintLevelUsed, level)
      transferTainted = true
```

`transferOpen` 由 `enterTransfer()` 置 true、由 `noteTransferOutcome()` 置 false。绕道 `TRANSFER → helpRequest → ASSESSING → INTERVENING → hintIssued` 时 `transferOpen` 仍为 true（没有任何 transferOutcome）→ `transferTainted = true`；之后即使回 `INDEPENDENT` 再重进 `TRANSFER`，`transferTainted` **不清** —— 只有 `beginRun()` 才清。

`assistedRound` 用**粘性**口径：run 内曾为真即为真，不被后续状态洗掉。软着陆选「换一个更简单的」走 `softLandingChoice → PREPARING → challengeValidated`，`beginRun` 清零本轮记账但新 run 的 `assistedRound` 立即被 `noteAssisted()` 置回 true（`ctx.assistedRound` 在 `COMPLETED → PREPARING` 之前不清）——SDP 的最高提示级别因此绑定本次挑战而不是上一题（修「SOFT_LANDING 路径不经 nextChallenge」的清零缺口）。

`selfCorrectionObserved` 的内核可判口径（学科无关）：同一 `hypothesisId` 在同一 run 内方向从 `supports` 翻成 `weakens`，且两条之间没有 `noteHint` —— 孩子自己改对的。插件也可以直接在 `DisciplineEvidence.selfCorrection` 上标注，两者取或。

`OrchestratorRuntime` 新增字段（重启后不从零开始）：

```ts
runRecorder?: RunRecorderState | undefined;
runSeq?: number | undefined;
artifactId?: string | undefined;
artifactVersionId?: string | undefined;
previewNonceCounter?: number | undefined;      // §10.7 明说要持久化，必须在这里
memoryPreview?: { candidateId: string; nonce: string; tier: 2 | 3;
                  childFacingText: string; evidenceSummaryText: string;
                  contestTarget: ContestTarget; shownAt: number } | undefined;
pendingProbe?: { probeId: string; discriminates: readonly [string, string]; issuedAt: number } | undefined;
pendingChallengeInput?: { requiredProbeId: string; competingHypothesisIds: readonly string[] } | undefined;
```

### 10.4 TRANSFER 成功那一刻

```
handleChildOutput 里 state === "TRANSFER" && ANSWER && checkTransferAnswer 通过:
  recorder.noteTransferOutcome("succeeded")
  const run = recorder.snapshot(now)
  ledger.ingestRun({ run, evidence: this.evidence, qualityOf, artifactVersionOf })   // 先落链接与 SDP
  const snapshot = this.gateSnapshot(now)

  // 一个显式队列，每一条在返回前都跑 preflight；不过就跳到下一条（修「档 3 候选覆盖上来没跑预检」）
  const candidate = ledger.nextCandidateToAsk(learnerId, discipline, snapshot)
                 ?? ledger.buildAndPreflight({ learnerId, run, snapshot,
                        bridgeCandidate: this.lastMemoryCandidate,
                        plugin: { childFacingGoalPhrase, surfaceContextLabel, forbiddenClaimPatterns } }).candidate

  this.apply({ kind: "transferSucceeded", hasMemoryCandidate: candidate !== null }, out)
  if (candidate !== null) this.emitMemoryPreview(candidate, out, now)
```

`nextCandidateToAsk` 的优先级（每条都过 `preflight` 与 `screenChildFacingText`）：

1. `awaiting_reassent`（家长收窄适用范围后待重新同意，§8.3）
2. `awaiting_child`（档 3 家长已批准、等孩子）
3. 无 → 返回 null，交给 `buildAndPreflight` 造本轮的档 2 候选

`hasMemoryCandidate` 从此由真实候选决定，不再是字面量 `false`（MF-02）。preflight 不过就 `COMPLETED + saveArtifactOnly`，**一个字都不问孩子**，同时落一条 `phase:"preflight"` 的 `MemoryCommitDecision` 供审计。

一次 `MEMORY_PENDING` 只展示一个候选，另一个留到下次。

### 10.5 档 2 候选的来源与去重（MF-38）

两条来源并存，都过同一道门禁：

- **来源 A（桥接）**：Codex 提案里的 `memoryCandidate{ description, evidenceEventIds, hypothesisKeys }`。`proposal-validator` 的分支扩到四条：`memory:assistedRound`、`memory:notAfterTransfer`、`memory:unknownHypothesis`（引用了不存在的 key）、`memory:rootCauseNotDiscriminated`（`hypothesisKeys.length === 1` 且 `probeResolved === false`）。**`description` 只在内存里用于对齐 claimKey，永不落库、永不呈现**（§2.7）。
- **来源 B（账本自建）**：`foldCapabilityClaim(run, links)` —— `transferOutcome === "succeeded"` ∧ `transferHintLevelUsed === 0` ∧ `!transferTainted` ∧ `!assistedRound` 时，用 `run.developmentGoalId` 作 `targetObject.id`、`developmentGoal`（家长可读的那句）作 `label`、`{probeFamilyId, difficultyBandIndex}` 作 `scope`，产出一个候选。**不要求有存活的根因假设**，`hypothesisKeys` 可以是空数组 —— 这是让干净成功路径能写进档 2 的关键。

**去重**：`claimKey` 相同即同一条。两条并存时合并：`evidenceLinkIds` 取并集、`hypothesisKeys` 取并集、`proposedBy = "bridge+kernel"`。**来源 A 被本地规则拒时不降级为自建**（避免孩子看到的不是被拒的那句），直接不问孩子。

**儿童版描述**：一律由 `renderChildFacingText` 从「插件的 `childFacingGoalPhrase` + `surfaceContextLabel` + 离散计数」渲染，由 `screenChildFacingText` + `assertDiscreteOnly` 在**候选生成时、预览出站之前**校验。孩子永远看不到模型的自由文本 —— 把「禁止人格化标签」从可绕的词表问题变成结构上的做不到。

### 10.6 会话快照的取值时机（硬约束 3，MF-01）

```ts
/** 只在两处调用：预检那一刻、孩子按下三选项那一刻。都是「此时此刻」的值 */
private gateSnapshot(now: number): SessionGateSnapshot {
  const run = this.recorder.snapshot(now);
  return {
    sessionId: this.deps.sessionId, runId: run.runId, takenAt: now,
    state: this.context.state,
    assistedRound: run.assistedRound,                 // 粘性口径，不读 ctx 的瞬时值
    frozenTargets: this.context.frozenTargets,
    maxHintLevelUsedInRound: run.maxHintLevelUsed,
    transferHintLevelUsedInRound: run.transferHintLevelUsed,
    transferTainted: run.transferTainted,
    probeResolved: run.probeResolved,
    previewNonce: this.runtime.memoryPreview?.nonce ?? null,
  };
}
```

`SessionGateSnapshot` 是 `buildAndPreflight`、`nextCandidateToAsk`、`evaluateAssent`、`recordAssent` 的**必填**入参；`GrowthSessionPort` 与 `GrowthAssentPort` 上不存在任何读会话状态的方法。删掉这个字段，`decide` 编译不过。

**关于 MF-01 那条验收测试的读法**（必须写清）：MF-01 要求「软着陆选 hint 后走到 `MEMORY_PENDING` 再选记下来 → rejected」。在本设计里 `shared.notAssistedRound` 在 **preflight** 就挡住了，辅助轮根本进不了 `MEMORY_PENDING`（保护更强）。因此该验收拆成两条等价测试：
- **preflight 层**：软着陆后迁移成功 → 不发 `memoryPreview`、决策记 `rejected(shared.notAssistedRound, phase:"preflight")`、状态直接 `COMPLETED`。
- **decide 层（真实可达路径）**：预览挂在屏上时孩子按「我卡住了」→ `ASSESSING` → 拿提示 → 预算耗尽 → `SOFT_LANDING`（`assistedRound=true`）→ 「今天先到这里」→ `COMPLETED`；此时孩子回带旧 nonce 的 `MEMORY_ASSENT` → 被 `shared.stateIsMemoryPending` 与 `shared.notAssistedRound` 双重拒，库里没有记录。

### 10.7 预览凭证 `previewNonce`（MF-15）

```ts
private nextPreviewNonce(): string {
  this.previewNonceCounter += 1;                       // 进 OrchestratorRuntime → 进快照 → 重启续号
  return `pv-${this.deps.sessionId}-${this.previewNonceCounter}`;
}

private emitMemoryPreview(c: MemoryCandidate, out: ChildOutbound[], now: number): void {
  const nonce = c.previewNonce ?? this.nextPreviewNonce();     // 已挂 nonce 的候选复用它
  this.runtime.memoryPreview = { candidateId: c.candidateId, nonce, tier: c.tier,
    childFacingText: c.childFacingText, evidenceSummaryText: c.evidenceSummaryText,
    contestTarget: c.contestTarget, shownAt: now };
  this.ledger.markPreviewShown(c.candidateId, nonce, now);     // 落 memory_candidates.preview_nonce / shown_at
  out.push(this.msg({ type: "memoryPreview", candidateId: c.candidateId, previewNonce: nonce, … }));
}
```

`viewSnapshot()` 在 `MEMORY_PENDING` 时**补发同一条 preview、带同一个 nonce**（出站 `id` 用同一个 `outboundCounter`，不再另起 `snap-N` 编号）。**凭证是 `previewNonce`，不是出站 id。** nonce 同时进 `OrchestratorRuntime.memoryPreview` 与 `memory_candidates.preview_nonce`，重连、重启、补发一律复用。

**不设回答时效**：孩子重启后隔天回答仍算数（`t2.assentAfterPreview` 只校验顺序）。设时效会重新制造 MF-15 描述的「孩子卡在选项界面」。

预览在 `WAITING_CONFIRMATION` / `PAUSED_CHILD` / `PAUSED_TECH` 这些停车状态下**保留**（它们的 `PRIOR` 就是 `MEMORY_PENDING`）；转到任何其它状态时清空。

### 10.8 `MEMORY_ASSENT` 的处理：**先守卫，后提交**

```
case "MEMORY_ASSENT": {
  const p = event.payload;                       // { candidateId, previewNonce, choice }
  const pv = this.runtime.memoryPreview;
  if (!pv || pv.candidateId !== p.candidateId || pv.nonce !== p.previewNonce) {
    pushPolicyError({ code: "guardFailed", from: this.context.state, signal: "memoryAssent" });
    out.push(this.msg({ type: "notice", text: "我这边没找到刚才那张卡片，我们重新看一次。" }));
    if (this.context.state === "MEMORY_PENDING" && pv) this.emitMemoryPreview(pv, out, now);
    return;                                       // 不落库
  }
  const now = this.deps.clock();
  const snapshot = this.gateSnapshot(now);

  // ① 只读裁决：跑全量规则，一个字都不写
  const { wouldCommit } = this.ledger.evaluateAssent({ candidateId: p.candidateId, choice: p.choice,
      previewNonce: p.previewNonce, shownAt: pv.shownAt, answeredAt: now, snapshot,
      forbiddenPatterns: this.deps.plugin.manifest.forbiddenClaimPatterns });

  // ② 守卫在写入之前：转换被拒时，账本一个字都没写
  const moved = this.apply({ kind: "memoryAssent", choice: p.choice, localRulesPassed: wouldCommit }, out);

  // ③ 无论通过与否都落一条决策（10.7 要求）；提交只在守卫过了之后发生
  const decision = this.assentSink.recordAssent({ candidateId: p.candidateId, choice: p.choice,
      previewNonce: p.previewNonce, assentEventId: event.eventId, shownAt: pv.shownAt, answeredAt: now,
      snapshot, transitionAccepted: moved, stateAfterTransition: this.context.state,
      forbiddenPatterns: this.deps.plugin.manifest.forbiddenClaimPatterns });

  if (!moved) {                                   // 门禁未过 → 候选转 held，给孩子出口（0.2 修改二）
    this.ledger.holdCandidate(p.candidateId);
    out.push(this.msg({ type: "notice", text: MEMORY_HELD_NOTICE }));
    out.push(this.msg({ type: "memoryDismissed", candidateId: p.candidateId, reason: "held" }));
    if (this.context.state === "MEMORY_PENDING") this.apply({ kind: "memoryHeld" }, out);
    this.runtime.memoryPreview = undefined;
    return;
  }
  if (p.choice === "disagree") {
    const r = this.ledger.contest({ learnerId, target: pv.contestTarget, eventId: event.eventId,
        sessionId, runId: snapshot.runId, at: now });
    this.planDiscriminatingTask(r.frozenClaimKeys);
  }
  this.runtime.memoryPreview = undefined;
  return;
}
```

`recordAssent` **不信调用方**：它内部重跑同一张规则表，外加 `shared.postTransitionCompleted`（`transitionAccepted && stateAfterTransition === "COMPLETED"`）；两者结论不一致时以它自己的为准并记 `rejected`。幂等：同一 `(candidateId, previewNonce)` 只落一条决策，重复调返回同一条。

这条顺序修掉了「孩子被告知没记、账本已经记了」的整类路径：卡片挂着时孩子说了句话（`transcriptUncertain → WAITING_CONFIRMATION`）或按「我卡住了」（`ANY_ACTIVE → ASSESSING`），此时按「记下来」→ `apply` 命中 `unlistedTransition` → `moved=false` → **一个字都没写**；同时 `shared.stateIsMemoryPending` 也会独立拒掉。两道锁。

### 10.9 CONTESTED 路径

1. 会话中途的 `CONTEST`（`ANY_ACTIVE` 通配行，`to: "SAME"`）：转换成功后调 `ledger.contest(...)` 落 `contests` + 冻结集，被指向的假设与记录转 `contested`。
2. `memoryAssent{disagree}` → `CONTESTED`；编排器立即 `selectDiscriminatingProbe`，把 `requiredProbeId` / `competingHypothesisIds` 写进 `runtime.pendingChallengeInput`。
3. `CONTESTED --contestNewTask--> PREPARING` → `plugin.createChallenge(input)` → 内核回校验（§5.4）。
4. 该轮结束时 `run.discriminates` 非空且 `probeResolved` 为真，才可能解冻（§8.2 三条件）。

### 10.10 档 1 作品落盘（MF-10）

编排器在两个时机调 `ledger.ingestArtifactVersion`（**不叫 commit\***，见 §9.3 保障 5）：

1. `start()` 里 `createSession` 之后立刻创建第 1 个版本（空画布），拿到 `artifactVersionId` 存进 runtime；
2. 之后每次 `snapshotIfNeeded` 触发时（状态转换 / 每 100 条事件 / 每 30 秒），若自上个版本以来有过 `STROKE` / `ERASE`，就写新版本，`versionNo += 1`。

内容（孩子笔迹 id + contentHash 列表、Agent 层对象、讲回文本的 eventId 引用）落到 `dataDir/artifacts/<artifactId>/<versionNo>.json`，库里只存 `content_ref` 与 `content_hash`。儿童端可另行上传 PNG（`POST /child/artifacts/:versionId/png`），落同目录。

`store.appendEvent(sessionId, stored, this.runtime.artifactVersionId)` 把服务端列填上 —— **每一条事件（含纯语音转写）都有可解析的作品版本外键**，MF-12 的归属判据因此成立。`backfillArtifactVersion` 只用于旧库迁移。

### 10.11 探针的轮内注入（§5.3 的调用点）

```
private async assess(out) {
  if (state !== "ASSESSING") return;
  if (isExpectedEvidenceMet) { … return; }

  // 探针优先于提示：6.2「优先选择信息增益高、对孩子干预最小的探针」
  if (this.recorder.canIssueProbe()) {
    const pick = selectDiscriminatingProbe({ activeCandidates: this.recorder.activeCandidates(),
        probes: this.deps.plugin.discriminatingProbes(this.currentChallenge()),
        usedProbeIds: this.recorder.usedProbeIds() });
    if (pick && this.apply({ kind: "probeIssued" }, out)) {
      this.recorder.noteProbeIssued(pick.probe.id, pick.discriminates, now);
      this.runtime.pendingProbe = { probeId: pick.probe.id, discriminates: pick.discriminates, issuedAt: now };
      this.pushSpeak(pick.probe.question, 0, out);     // hintLevel 0，不计提示预算
      return;
    }
  }
  … 原有提示阶梯逻辑不变 …
}
```

孩子在 `ASSESSING` 的回答走 `handleChildOutput` 的通用分支：先 `plugin.classifyProbeOutcome` 归类，命中则构造 `probe_outcome` 证据并按 §5.3 决定是否置 `probeResolved`，然后 `apply({kind:"childOutput"})`（0.2 修改四），再 `await this.assess(out)` 继续。不会死循环：`canIssueProbe()` 要求 `probesIssued < 3` 且 `newOutputSinceLastProbe`（发探针后置 false）。

### 10.12 挑战生成只读活动成长模型 + 到期复习（MF-32）

```ts
private buildChallengeInput(): ChallengeInput {
  const now = this.deps.clock();
  const d = this.deps.plugin.manifest.id;
  return {
    ...this.deps.challengeInput,
    knownRecords: this.ledger.activeModel(this.deps.learnerId, d)
      .map((r) => ({ targetObjectId: r.targetObject.id, probeFamilyId: r.scope.probeFamilyId,
                     difficultyBandIndex: r.scope.difficultyBandIndex })),
    dueReviews: this.ledger.dueReviews(this.deps.learnerId, d, now),
    ...(this.runtime.pendingChallengeInput ?? {}),
  };
}
```

**候选表不可达** —— 这是 9.1.1 末句「不得被后续挑战生成器当作已知事实使用」的实现方式。`held` / `declined_unsure` / `contested` / `awaiting_*` 的候选一律不进 `activeModel`。`dueReviews` 非空时插件把回看任务放进 `learnerPrompt`，孩子端能看到。成长模型为空时两者都是空数组，闭环照跑。

---

## 11. 儿童端协议与界面

### 11.1 协议改动（TS 与 Swift 同步，夹具共用）

```ts
// evidence-event.ts
export const contestTargetSchema = z.object({
  kind: z.enum(["proposal", "hypothesis", "candidate", "record", "session"]),
  id: z.string().min(1),
});
// CONTEST：target 必填（不再 optional）
z.object({ type: z.literal("CONTEST"), target: contestTargetSchema, note: z.string().optional() }),
// MEMORY_ASSENT：加两个必填字段
z.object({ type: z.literal("MEMORY_ASSENT"),
  candidateId: z.string().min(1), previewNonce: z.string().min(1),
  choice: z.enum(["record", "unsure", "disagree"]) }),
// 探针回答复用 ANSWER / UTTERANCE，不新增类型
```

```ts
// child-protocol.ts 出站新增四支
z.object({ type: z.literal("memoryPreview"), id: z.string().min(1),
  candidateId: z.string().min(1), previewNonce: z.string().min(1),
  childFacingText: z.string().min(1), evidenceSummaryText: z.string(),
  tier: z.union([z.literal(2), z.literal(3)]),
  contestTarget: contestTargetSchema,
  // tuple 锁死顺序与个数：少一个、多一个、换顺序都过不了 schema
  options: z.tuple([z.literal("record"), z.literal("unsure"), z.literal("disagree")]) }),
z.object({ type: z.literal("memoryDismissed"), id: z.string().min(1),
  candidateId: z.string().min(1), reason: z.enum(["held", "answered"]) }),
z.object({ type: z.literal("firstUseNotice"), id: z.string().min(1),
  version: z.number().int().positive(), text: z.string().min(1), acknowledgeLabel: z.string().min(1) }),
z.object({ type: z.literal("artifactContext"), id: z.string().min(1),
  artifactId: z.string().min(1), artifactVersionId: z.string().min(1) }),
```

`speak` 与 `learnerTask` 各加 `contestTarget: contestTargetSchema`（让「你理解错了」在任何时刻都填得出目标，§8.1）。

**协议里刻意不存在 `defaultOption` / `selected` / `recommended` 字段** —— 「三个选项不设默认选中」在契约层无从表达。

`clientFrameSchema` 保持单一 `event` 形态不变：**儿童侧账本走独立 HTTP，不走 WebSocket 帧**（§11.3），因此不需要判别联合，也不占 `clientSeq`。

### 11.2 同意卡片（`MemoryPreviewCard.swift`）

**不是不可退出的模态。** 卡片渲染在任务区，四个常驻入口（我卡住了 / 我做完了 / 我想休息 / 你理解错了）**照常可见可用**（8.1）。不选就是不选：不点空白关闭、不设超时自动选择、不加第四个选项；想离开就按常驻的「我想休息」（`PAUSED_CHILD`，`PRIOR = MEMORY_PENDING`，回来卡片带同一 nonce 重发）。

```swift
// 三个选项：同一个数组 → 同一个 ForEach → 同一个 view builder。
// 结构上不可能给某个选项加权重（硬约束 10、规范 9.5）。
private func assentButton(_ option: String) -> some View {
    Button(Self.assentTitle(option)) {
        act(.memoryAssent(candidateId: preview.candidateId,
                          previewNonce: preview.previewNonce, choice: option))
    }
    .buttonStyle(.bordered)                 // 三个都是 .bordered
    .font(.title3)                          // 同字号
    .foregroundStyle(Color.primary)         // 同色：不给「记下来」上绿、不给「不是这样」上红
    .frame(minWidth: 180, minHeight: 56)    // 同尺寸
    .accessibilityIdentifier("assent-\(option)")
}
```

刚性纪律，逐条可测：

1. 三个按钮共用 `assentButton`，**不允许任何一个用 `.borderedProminent`**；
2. 不加 `.keyboardShortcut(.defaultAction)`、不加 `.defaultFocus`、不用 `.alert` 的 `.cancel` / `.destructive` role；
3. 证据摘要排在按钮**之前**（孩子先看到依据再选）；
4. 顺序固定 `record / unsure / disagree`，由 schema 的 `z.tuple` 保证；
5. 不点不发事件。

**验证方式**（修「XCTest 没有内建快照比对」）：UI 测试断言三个 `assent-*` 元素的 `frame.width` / `frame.height` 相等且都存在；视觉权重由**源码级机械检查**保证 —— 一条 Swift 单测读 `MemoryPreviewCard.swift` 源文件，断言不含 `borderedProminent`、`keyboardShortcut`、`defaultFocus`、`.tint(`。**不写**「断言没有任何 `isSelected`」——那在 bordered Button 上恒为 false，是空断言。

### 11.3 「系统怎么理解我」（`ChildUnderstandingView.swift`，9.5 末条）

走 `ChildLedgerClient` 的 HTTP `/child/*`，**不依赖活动会话、不占 `clientSeq`、不触发 `host.open`**（后者会新建会话并推一道新题——孩子想看一眼不该等于开一节课）。

内容严格按 9.6 + 9.7：

- 我的问题 / 我的探索 / 我的作品 / 被我修正的猜想 / 我新学会的方法；
- **我现在的猜想**（`activeGuesses`：正在决定出什么题的活跃候选，儿童版一句，来自 `manifest.hypothesisCatalog[].childFacingGuess`，中性、不含模型推理、不含计数）；
- 中性脚手架句（`renderScaffoldLine`，只有两个整数）；
- 每条记录与每条猜想两个入口：「不是这样」→ `POST /child/contest`；「请删掉」→ 先 `POST /child/deletion-preview` 看影响范围，孩子确认后 `POST /child/deletion-requests`；
- 通知区：删除请求的处理结果（`GET /child/notifications`）。

界面上不出现任何计数、假设名、状态枚举、模型推理（8.1）。这两个按钮在 `COMPLETED` 状态与宿主重启后无活动会话时**仍可用并有反馈**。

### 11.4 首次知情说明（`FirstUseNoticeView.swift`，MF-21）

宿主在 `host.open(sessionId)` 时先查 `childPort.firstUseNotice(learnerId)`，未确认就把 `firstUseNotice` 排在所有其它消息**之前**。孩子按「知道了」→ `POST /child/first-use-notice/ack`。

门禁规则 `shared.firstUseAcknowledged` 在 preflight 层：未完成前**不得发出任何 `memoryPreview`**。

文案（`FIRST_USE_NOTICE_V1`，固定，有快照测试，本身过禁止标签检查）：

> 我会把你画的东西、说的话和做出来的题，存在家里这台电脑上，这样下次我们能接着做。
>
> 我还会自己猜「你可能是在哪一步卡住了」。这些猜想是我用来决定出什么题的，你随时可以看，也可以说「不是这样」，我就不再用它。
>
> 如果我觉得你学会了什么，我会先写成一句话给你看，你说「记下来」我才会记；你说「不确定」或「不是这样」，我就不记。有一种话是关于你好几次的表现的，这种爸爸妈妈会比你先看到，他们同意了我才来问你。
>
> 爸爸妈妈能看到你的作品、你做题的过程、我记下来的那些话，还有我对你的猜想。
>
> 你随时可以看我记了什么。你可以让我删掉，不过删掉要爸爸妈妈一起决定；在他们决定之前，我先不用那句话了。

最后一句是刻意的：机制里孩子只有 `requestDeletion`，文案就不能承诺「可以让我删掉」。承诺做不到的事，后面所有的「同意」都建立在假前提上。

---

## 12. 家长端 HTTP 接口

### 12.1 通道分离（MF-23）

| 通道 | 监听 | 路由 | 鉴权 |
|---|---|---|---|
| 儿童 | `0.0.0.0:8788` | `/healthz`、`/session`(ws)、`/child/*` | 无（家庭局域网明文，11.4 已裁决） |
| 家长 | `127.0.0.1:8789` | `/parent/*` | 绑定回环 **且** `X-Parent-Token`（token 从 `~/.ai-scholar/parent-token` 读，首次启动生成 0600 文件） |

两个独立 Fastify 实例，共享同一个 `host` 对象与同一个 `LearningDatabase`。**儿童通道上根本没有 `/parent/*` 路由**（404，比 403 更硬——不存在的东西不需要判断谁能访问）。原来的 `isLoopback` onRequest 钩子保留在 `parentApp` 上作为第二道。

档 3 的家长审阅端点因此**结构上**无法由儿童端调用（不同进程监听、不同端口、只绑回环、另需令牌），这道门禁不再自己给自己开门。

**测试口径**（修「从局域网地址连 8789」在 CI/离线环境不可重复）：断言 `parentApp.listen` 的 `host` 参数是 `127.0.0.1`（配置断言）+ 一次回环连通性对照；不依赖真实网卡。

### 12.2 路由表

```
# 会话（现有，不变）
GET    /parent/sessions
GET    /parent/sessions/:id
POST   /parent/sessions/:id/proposal
POST   /parent/sessions/:id/tick

# 档 3 事前审阅（9.1.1、9.7 家长 × 跨轮趋势格：只有审阅，没有纠正）
GET    /parent/growth/pending
         → [{ candidate, trend, runs:[{runId, occurredAt, probeFamilyId, difficultyBand,
                maxHintLevelUsed, probesIssued, independentTransferSucceeded, assistedRound}],
              hypotheses:[{hypothesisKey, parentFacingLabel, status, counts}],
              artifactLinks, childFacingText(只读，不可编辑),
              blocked: null | { code:"parent.cannotOverrideChildContest", contestedAt } }]
POST   /parent/growth/candidates/:id/review
         body { decision:"approved"|"rejected", parentNote? }      # 没有 editedChildFacingText
         → 200 | 403 parent.cannotOverrideChildContest
               | 409 parent.candidateNotAwaitingReview | 409 parent.reviewStale
               | 400 parent.forbiddenLabelInNote

# 已提交记录（9.7 家长 × 具体能力记录格、12 章）
GET    /parent/growth/records
POST   /parent/growth/records/:id/narrow-scope
         body { toBandIndex? , toSurfaceContextKey? , parentNote? }
         → 200 { ok:true, needsReassent:true, candidateId }        # 改了范围就重新问孩子
         → 409 parent.cannotCorrectContested | 409 parent.cannotCorrectTrend
POST   /parent/growth/records/:id/downgrade
POST   /parent/growth/records/:id/retract
GET    /parent/export                                              # 12 章「家长应能导出」

# 趋势与教学警报
GET    /parent/growth/trends
GET    /parent/growth/alerts
POST   /parent/signals/:id/ack
GET    /parent/growth/agent-view                                   # 9.6 Agent 视图

# 删除
GET    /parent/deletion-preview?subjectKind=&subjectId=
POST   /parent/deletion            body { subjectKind, subjectId, previewComputedAt }
                                   → 409 parent.deletionPreviewStale
GET    /parent/deletion-requests                                   # 孩子发起的待办，超时项置顶
POST   /parent/deletion-requests/:id/resolve  body { decision:"approved"|"rejected" }
```

**路由层刻意不存在的入口**（比校验更硬）：

- 没有 `POST /parent/growth/commit`（任何档位都不能由家长直接提交）；
- 没有 `POST /parent/growth/trends/:id/correct`（9.7 那一列只有「必须事前审阅」）；
- 没有 `POST /parent/growth/candidates/:id/assent`（家长不能代替孩子同意）；
- **任何路由的 body 里都没有能写进 `child_facing_text` 的字段**（§8.3）。

### 12.3 家长控制台（`parent-console.html`）新增四块

1. **待审阅成长记录**：候选卡片（**只读**的儿童版描述、三个 run 的表格：日期/探针族/难度带/最高提示级别/探针数/是否 0 级迁移/是否辅助轮、涉及假设的五项计数与家长版标签、原始作品链接），批准/拒绝按钮 + 只给家长自己看的备注框。被异议冻结的候选**灰显不可批准并写明原因**（「必须先有新的区分性证据把异议解决掉」），不是静默 409。
2. **教学警报**：`verdict === "rising"` 的项，列出这三轮的介入历史。固定中性文案：「这一族题目最近三轮需要的提示级别在上升，建议先不加难度，看看这三轮的介入记录」——**不出现任何指向孩子的词**。同时展示 `incomplete` 项并说明是因为作品被删除。
3. **删除请求队列**：孩子发起的请求，展示与孩子看到的**同一份**影响范围计数（文字由同一个渲染函数生成），超时项标红置顶，第二次请求标「孩子第 2 次请求」；处理结果回传给孩子。
4. **已提交记录**：收窄范围（提示「改了范围会重新问孩子」）、降级、撤回、导出。

**不显示模型内部推理、不显示 Codex 任何字段**（4.3 铁律、9.6 家长视图定义）。

### 12.4 儿童侧 HTTP（`/child/*`，MF-08）

```
GET  /child/understanding                       → ChildFacingView
POST /child/contest                             { target, note? }
POST /child/deletion-preview                    { subjectKind, subjectId } → DeletionPreview（计数 + 一句渲染文字）
POST /child/deletion-requests                   { subjectKind, subjectId } → { requestId, preview }
GET  /child/deletion-requests
POST /child/deletion-requests/:id/withdraw
GET  /child/notifications
POST /child/notifications/:id/read
GET  /child/first-use-notice
POST /child/first-use-notice/ack                { version }
POST /child/artifacts/:versionId/png            （可选：儿童端上传画布位图）
```

全部由 `GrowthChildPort` 直接服务，**不经会话状态机、不占 `clientSeq`、不调 `host.open`**。会话已 `COMPLETED`、宿主重启后无活动会话时，一律返回 200。

---

## 13. 测试清单

### `packages/learning-kernel/test/growth/discrete-guard.test.ts`（MF-04）

1. `{probeFamilyId:"x", supportingChallenges:2}` 通过 —— 字符串字段不进浮点判定。
2. `{confidence:0.8}` 被拒，路径 `$.confidence`、code `ratioLike`。
3. `{probeId:"p1"}` 不被误伤（旧口径按键名子串扫会命中它）。
4. `{scoreBand:"base"}` 通过；`{qualityRatio:3}` 被拒 `declaredRatio`（后缀声明为比率，整数也不行）。
5. 嵌套数组里的 `0.33` 被拒且路径为 `$.a[1].x`。
6. `{supportingChallenges:-1}` 被拒 `negativeCount`。
7. 落盘前对每条 `GrowthRecord` / `MemoryCandidate` / 假设行跑 `assertDiscreteOnly`（集成断言）。

### `packages/learning-kernel/test/growth/forbidden-labels.test.ts`（MF-05、MF-35）

8. 含「粗心」的候选在 `memoryPreview` 发出**之前**被拒，出站消息列表里不含该文本。
9. 「不擅长」「没天赋」「注意力不集中」「马虎」逐条命中内核词表。
10. 「某某理解差」被后缀结构模式命中 —— 内核词表里没有任何领域名。
11. `screenChildFacingText` 同时扫 `childFacingText`、`evidenceSummaryText`、`targetObject.label`、scope 儿童版说法四段。
12. 插件词表只作补充：插件传空数组时内核词表照样生效。
13. **孩子自己的内容不被扫**：作品标题写「我今天有点粗心」照常存进档 1（`evaluateTier1Gate` 通过）。
14. `growth/` 下每个 `.ts`（含中文注释）不含 `math|literature|decimal|数学|文学|小数`。

### `packages/learning-kernel/test/growth/evidence-fold.test.ts`（MF-26、MF-27）

15. 计数口径是 `COUNT(DISTINCT runId)`：同一 run 内三条同向证据只算一个挑战。
16. 同 run 内先 supports 后 weakens 且中间无 hint → 净方向 weakens 且 `selfCorrection = true`。
17. `status === "evidence_removed"` 的链接不进任何计数。
18. 「4 级演示后 0 级迁移」的 run 同时使 `independentTransferSuccesses` 与 `hintedSuccesses` 各 +1。
19. 走完「不确定 → 确认」流程后该事件参与计数（`effectiveQualityOf` 生效）。
20. 始终 `unconfirmed` 的事件不参与计数，计入 `linksSkippedUnconfirmed`。
21. `effectiveQualityOf` 与 `resolveConfirmedEvents` 对同一批事件结论一致；且清空 `event_confirmations` 后能从 `events` 完整重建。
22. 计数恒等：任意删除/清理后，`summarizeClaim` 重算值等于 `growth_records` 的缓存列。
23. 重放同一 `runId` 的 `ingestRun` 不双计（`linkId` 幂等）。

### `packages/learning-kernel/test/growth/hypothesis-lifecycle.test.ts`（MF-07、MF-16、MF-34）

24. 单一表面情境永远到不了 `confirmed`。
25. `contested → confirmed` 一步到位被拒，只能先回 `suspected`。
26. contest 后 `status='contested'`、`activeModel()` 不返回、`personalizationInputs()` 不返回（三条断言）。
27. 解冻三条件缺一即拒：不在冻结集 ∧ `observedAt > contestedAt` ∧ 来自 `discriminates` 非空的 run。
28. 用原证据重提返回 `rejected(shared.notReusingFrozenEvidence)`。
29. **没有假设的 claim 也被冻结**：主路径档 2 候选（`hypothesisKeys: []`）被孩子异议后，同一 claimKey 的新候选被 `shared.notContestedClaim` 拒；只有满足解冻条件才放行。
30. 冻结在快照丢失、进程重启后仍在（重开 service 再断言）。
31. 跨轮累积到第 4 个活跃候选被拒（上一轮的 3 个仍活跃）。
32. 把 `demoted` 行改回 `active` 使活跃数变 4 被拒（走 `reactivate` 路径，不依赖任何表触发器）。
33. `expired` 由注入时钟驱动，跑两遍结果相同。
34. 机械扫描：`growth/` 下不出现 `Date.now`。

### `packages/learning-kernel/test/growth/probe-selection.test.ts`（MF-17）

35. `separatesTwo` 对「只有 A 出现、B 未被触及」返回 false。
36. `separatesTwo` 对「A 自己方向不定但 B 没出现」返回 false（旧判据的漏洞）。
37. `mathPlugin` 三个探针对各自 top2 全部返回 true；`fake-plugin` 的 `probe-1` 返回 true。
38. `activeCandidates.length < 2` 时 `selectDiscriminatingProbe` 返回 null，不放行。
39. 已用探针在同分时排在后面；排序确定性（跑两遍同结果）。
40. 探针命中 outcome 且方向把 top2 分开 → `probeResolved = true`；未命中任何 outcome → 仍为 false。
41. 新候选进入 top2 → `probeResolved` 归零。
42. **探针不计入提示预算**：连发三个探针后 `escalationCount === 0`、`maxHintLevelUsed === 0`、状态仍是 `ASSESSING`、`assistedRound === false`。
43. 探针数进 SDP 的 `probes_issued`，但不参与 `analyzeScaffoldTrend` 的任何判定。

### `packages/learning-kernel/test/growth/gate-rules.test.ts`（MF-01、MF-19、MF-26）

44. `assistedRound: true` 的快照下档 2 preflight 返回 rejected，failures 含 `shared.notAssistedRound`。
45. 档 3 在 `assistedRound: true` 的快照下同样 rejected。
46. 同一候选下 `preflight` 的失败规则集 ⊆ `decide` 的失败规则集（属性测试，20 组随机输入）。
47. 规则不短路：同时违反三条时三条 id 都在 `ruleResults` 里。
48. `hypothesisKeys: []` 的档 2 候选**通过** `t2.hypothesesKnown` —— 档 2 不要求有存活根因假设。
49. `transferHintLevelUsedInRound: 2` → 拒 `t2.transferUnhinted`；`maxHintLevelUsedInRound: 4` 且 `transferHintLevelUsedInRound: 0` → 通过。
50. `snapshot.state !== "MEMORY_PENDING"` 时 decide 拒 `shared.stateIsMemoryPending`。
51. `transitionAccepted: false` 时 decide 拒 `shared.postTransitionCompleted` 且不产生记录。
52. `t3.parentBeforeChild`：`reviewedAt > shownAt` 时拒。
53. `t3.noApprovalOnContested`：依赖 claim 有未解决 contest 时拒。
54. `t3.threeComparableChallenges`：只有两个可比点 → 拒；三个点里有一个 `assistedRound` → 拒。
55. `t3.trendUsable`：趋势 `rising` / `incomplete` / `insufficient` 时拒。
56. `t2.rootCauseDiscriminated`：单一 `hypothesisKey` 且 `probeResolved === false` → 拒。
57. `t2.askAgainAllowed`：冷却期内拒；冷却期满但无新表面情境证据仍拒；三条件齐 → 通过。
58. `shared.firstUseAcknowledged` 未完成时 preflight 就失败。
59. 缺任一必备项的记录 → 拒 `shared.recordFieldsComplete` 且 detail 给出缺失字段名。
60. **档 2 无假设时七项照样齐**：`hypothesisKeys: []` 的候选，五个计数由 `summarizeClaim` 算出、`nextVerification` 由内核模板生成，`assertRecordComplete` 通过（测试 48 与 59 不打架）。
61. 档 3 趋势记录同样带齐七项（`transferRefs` ≥ 3 条、`trendRef` 非空）。
62. `evaluateAssent`（只读）不写任何行：调用前后全库内容哈希不变。
63. 无论通过与否都产出一条带 `rulesetId` 与逐条 `RuleResult` 的 `MemoryCommitDecision`；preflight 失败也落一条 `phase:"preflight"`。
64. `SubmitAssentInput` 删掉 `snapshot` → 类型测试（`expectTypeOf`）编译不过。

### `packages/learning-kernel/test/growth/gate-tier1.test.ts`（MF-10）

65. 一次画布会话结束后库里至少一条 `artifact_versions` 行。
66. 该轮 `STROKE` / `EXPLAIN` 事件的 `artifact_version_id` 能反查到它；**纯语音 `UTTERANCE` 也有**。
67. 档 1 不需要同意、不产生 `GrowthRecord`、不写 `memory_decisions`。
68. `payload` 含 `claim` 键 → 拒 `t1.noCapabilityClaim`。
69. 三档门禁是三个独立导出函数（`evaluateTier1Gate` / `evaluateTier2Gate` / `evaluateTier3Gate`），导出名断言 + 各自被调用。

### `packages/learning-kernel/test/growth/scaffold-trend.test.ts`（MF-28、MF-31）

70. `1→2→3` 判 `rising`，`alert.pauseDifficultyIncrease === true`。
71. 恰好三个可比点（前一窗口为空）时不误判 `withdrawing`；显式断言不走 zero 基线分支。
72. 「最高提示级别上升」优先于「0 级迁移比例上升」，不被抢先判成 `withdrawing`。
73. `3→2→1` 判 `withdrawing`；`2→2→2` 判 `flat`；`2→3→2` 判 `flat` 且 `teachingAdjustmentSuggested`。
74. `trend_gaps` 存在且未补齐时，在任何计算之前返回 `incomplete`。
75. 补齐 `removedCount` 个晚于 `removedAt` 的新点后自动恢复正常结论（当次标记）。
76. 难度带下标距离 > 1 的点不进同一窗口。
77. **`assistedRound` 的点照常进趋势**：三轮软着陆导致提示级别 `1→2→3` 时判 `rising` 并出教学警报（这是本设计对版本 B「整条排除」的显式纠正）。
78. `difficultyBandIndex === -1` 的点不进趋势并记 policyError。
79. `renderScaffoldLine` 只返回两个整数，不含趋势词、百分比、排名。

### `packages/learning-kernel/test/growth/deletion.test.ts`（MF-11/12/13/36）

80. 删掉某作品后，依赖它的档 2 记录 `status === "evidence_removed"` 且不进 `activeModel()`。
81. 其 SDP 从趋势移除，该三元组标记「数据不完整」。
82. `memory_decisions` 只剩 id 与 failures，`child_facing_text` / `evidence_summary_text` 被抹成空串。
83. `voidedAssentIds` / `voidedReviewIds` 显式返回，且重算的 `evidenceSetHash`（只算 active 链接）确实变了 —— 两条路都验。
84. 删除中途抛错后 `ROLLBACK`：作品内容与记录同时保持删除前状态。
85. 会话库与成长库共用同一个 `DatabaseSync`：两者的写在同一事务里可见。
86. **金丝雀全文扫描**：把 `ZZQQ-DELETE-CANARY-7731` 分别埋进不带客户端 `artifactVersion` 的 `UTTERANCE`、一条被拒提案文本、一条快照的 `lastSpoken`；**删除前先断言全库能扫到**（防止恒绿空测试），删除 + `wal_checkpoint(TRUNCATE)` + `VACUUM` 后全库（含 WAL 与作品目录）扫描 0 命中。
87. 库开了 `secure_delete`（`PRAGMA secure_delete` 返回 1）。
88. 同一测试断言：删除后重放同一 `event_id` 仍走 `duplicate`、不重复计证据。
89. **脱敏后仍可解析**：删除后 `SessionOrchestrator.restore` 能打开该会话不抛错，`absorb` 正常跳过空文本事件。
90. `DeletionAuditEntry` 序列化后不含任何被删内容（子串断言）。
91. 同一 subject 重复删除返回同一 `auditId`，不重复翻状态。
92. `previewDeletion` 与 `executeDeletion` 用同一个纯函数算影响范围；执行时重算不一致则返回 `deletionPreviewStale` 并中止。
93. **`deletion_requests` 表里没有任何自由文本列**：`PRAGMA table_info` 断言列名集合，且把金丝雀串塞进任何字段都插不进去。

### `packages/learning-kernel/test/growth/deletion-request-flow.test.ts`（MF-24）

94. 孩子发起 → 目标立即 `suppressedReason='deletionRequested'`，不进 `activeModel()`、不进 `dueReviews`。
95. 家长拒绝后目标**仍不解除停用**；只有孩子撤回或孩子在结果卡片上主动选「可以继续用」才解除。
96. 家长第一次拒绝后孩子可以第二次请求（部分唯一索引），第二次 `escalated = 1`，家长处理时不撞唯一约束。
97. 超过 `DELETION_SLA_MS` 未处理 → `parent_signals{kind:'deletionSlaBreached'}`；不自动执行删除。
98. 记录级删除：孩子只删一条记录，作品与其它记录不受影响。
99. 孩子请求时收到的是影响范围计数与渲染文字，不是安抚语。

### `packages/learning-kernel/test/growth/retention.test.ts`（MF-29）

100. 清理跑完后被记录引用的事件仍在（执行前反查 `referencedEventIds`）。
101. 未被引用且超 30 天的事件被脱敏（行还在，`event_id`/`client_seq`/`content_hash`/`quality` 四列不变）。
102. 清理后重放同一 `event_id` 仍不重复计证据；账本离散计数前后完全相同。
103. 被拒的记忆候选自由文本**从一开始就不落库**：`saveProposal` 后 `proposal_json` 里没有 `memoryCandidate.description`。

### `packages/learning-kernel/test/growth/candidate-source.test.ts`（MF-38）

104. Codex 提了候选但本地规则不过 → **不问孩子**（无 `memoryPreview` 出站），落一条 `phase:"preflight"` 的 rejected 决策。
105. Codex 没提但账本自建成立 → 正常询问，`proposedBy === "kernel"`。
106. 两者并存 → 合并为一个候选，`proposedBy === "bridge+kernel"`，`childFacingText` 来自内核模板。
107. **Codex 的 `description` 全库不可检索**：埋进提案的罕见串在候选、记录、决策、提案四张表里 0 命中。
108. `renderChildFacingText` 的输出含插件给的 `childFacingGoalPhrase` 与 `surfaceContextLabel` 原文，不是 id 串（拿 `fake-plugin` 的短语断言）。

### `packages/learning-kernel/test/growth/ledger-authority.test.ts`（MF-03）

109. `growth-sqlite.js` 与 `database.js` 不在包 `index.ts` 的导出清单里（快照测试）。
110. 机械扫描 `packages/` 与 `apps/` 全部 `.ts`：除 `growth/ledger-service.ts` 与 `growth/store/` 外无人 import store 实现。
111. 机械扫描：除 `growth/database.ts` 外无人 import `node:sqlite`。
112. `new GrowthLedgerService(...)` 的类型测试编译不过（private constructor）。
113. **端口方法穷举**：遍历四个只读/会话/家长/儿童端口的所有方法，逐个调用后 `growth_records` **全表内容哈希**不变（覆盖 `narrowScope` 这类改写）。
114. 四个端口上不存在任何返回 `MemoryCommitDecision` 的方法（类型测试）；`GrowthAssentPort` 只有一个方法。
115. `recordAssent` 幂等：同一 `(candidateId, previewNonce)` 只落一条决策。

### `packages/learning-kernel/test/growth/views.test.ts`（MF-09、MF-20、MF-25）

116. `ChildFacingView` 的字段清单与 9.6 孩子视图逐条对齐（五类内容全在）。
117. `activeGuesses` 的文本等于 `manifest.hypothesisCatalog[].childFacingGuess` 原文，中性、不含模型推理、不含计数、不含 `hypothesisKey`。
118. 孩子视图里不出现家长/Agent 专有字段（`counts`、`hypothesisKey`、`nextVerification`、`hintHistory`）—— 键集合断言 + 类型测试。
119. `ParentFacingView` 含趋势与「适合共同讨论的问题」，不含分数排名，不含桥接原始字段。
120. `AgentFacingView` 含提示历史与下一挑战候选。
121. `contested` 与 `suppressed` 的记录不出现在 `activeModel()`，也不出现在 `personalizationInputs()`。
122. 连拒 3 次后 `ParentFacingView.declineSignals` 出现提示项。
123. **权限矩阵逐格**：遍历 `PERMISSION_MATRIX` 的 25 格。有 `allow` 的格（约 14 个）各一条允许路径 + 一条拒绝路径；`allow` 为空的格（Codex 行、插件行的写入列）只验「该主体可达的全部入口里不存在这些方法/路由」，一格一条。**总口径写进本节，不假装 50 条**。重点断言：孩子对删除只有 `requestDeletion`（`GrowthChildPort` 类型上不存在 `executeDeletion`）；家长对跨轮趋势 `narrowScope` 返回 `parent.cannotCorrectTrend`；家长导出存在且返回非空；家长端不存在任何能写 `child_facing_text` 的入口。

### `packages/learning-kernel/test/session-state.test.ts`（改动，MF-06、MF-18）

124. 5.0 表逐行测试更新后全绿；未列出转换仍全部被拒。
125. `memoryAssent{record, localRulesPassed:false}` → **不转换**，记 `guardFailed`，状态仍 `MEMORY_PENDING`。
126. 同上但 `localRulesPassed:true` → `COMPLETED` + `commitGrowthRecord`。
127. `memoryAssent{unsure}` 不受守卫约束，照常 → `COMPLETED`。
128. `memoryHeld` 只在 `MEMORY_PENDING` 可用，→ `COMPLETED` + `keepCandidateTemporary`；其它状态下被拒。
129. `probeIssued` 只在 `ASSESSING` 可用，`to: SAME`，动作 `askDiscriminatingProbe`。
130. `ASSESSING + childOutput` 被接受并计入 `substantiveAttempts`。
131. `contest{target}` 进 `frozenTargets` 并按 `kind+id` 去重。

### `packages/learning-kernel/test/orchestrator.test.ts`（改动 + 新增）

132. **档 2 主路径（fake-plugin）**：独立 → 讲回 → 迁移成功 → 预览 → 选「记下来」→ 账本出现一条档 2 记录，`decision.outcome.committed === true`。
133. `transferSucceeded.hasMemoryCandidate` 由真实候选决定（preflight 不过的场景 → false，且不发 `memoryPreview`）。
134. **提交发生在守卫之后**：在 `MEMORY_PENDING` 先发一条 `unconfirmed` 的 `UTTERANCE`（→ `WAITING_CONFIRMATION`），再发 `MEMORY_ASSENT{record}` → 转换被拒、**库里没有任何记录、没有任何 committed 决策**；孩子收到的 notice 与库状态一致。
135. 同上换成先按「我卡住了」（→ `ASSESSING`）→ 同样结果。
136. 门禁在 decide 层失败 → 状态留在 `MEMORY_PENDING` 记 `guardFailed`，候选转 `held`，随后 `memoryHeld` 收尾到 `COMPLETED`，出站含 `memoryDismissed`；候选不进 `activeModel`。
137. `TRANSFER` 中求助拿 2 级提示后答对 → 档 2 拒 `t2.transferUnhinted`（覆盖 `TRANSFER → ASSESSING → INTERVENING` 绕道）。
138. 4 级演示 → 重建 → 讲回 → 0 级迁移 → 允许写入，记录 `maxHintLevelUsedAtAchievement === 4`、`achievedVia === "afterDemoRebuild"`。
139. `SOFT_LANDING → 换一个更简单的 → challengeValidated` 后 `RunRecorder` 完整清零（`transferTainted`、`maxHintLevelUsed`、`escalationCount` 归零），且新 run 的 `assistedRound` 仍为 true。
140. `nextChallenge` 后同样清零。
141. 未收到预览就发 `MEMORY_ASSENT` → 拒绝、记 `guardFailed`、不落库。
142. `previewNonce` 在同一会话内不重复（跑 50 次断言集合大小）。
143. 会话中途按「你理解错了」→ 被指向的假设 `status === "contested"`，后续 `ingestRun` 不再为它累计支持计数。
144. **`INDEPENDENT` 阶段（只有 learnerTask、没有 speak）按「你理解错了」**：儿童端填出 `{kind:"hypothesis"}` 或兜底 `{kind:"session"}`，账本落 contest 并冻结本轮全部活跃候选与 claimKey。
145. 区分性探针走 `ASSESSING` 原地注入；跑过且结果区分后 `run.probeResolved === true`，`escalationCount` 与 `maxHintLevelUsed` 均未变。
146. 一次画布会话结束后库里至少一条 `artifact_versions` 行；该轮全部事件（含纯语音）能反查到它。
147. 到期记录出现在下一次 `createChallenge` 的 `ChallengeInput.dueReviews` 里，且儿童端 `learnerTask` 里出现对应回看任务。
148. **不接账本**（`ledger` / `assent` 省略，走 `NULL_LEDGER`）时现有全套会话测试仍绿，完整闭环跑通至 `COMPLETED`。
149. 拒绝后教学动作不变：连拒 3 次前后的题目难度带与提示阶梯完全一致。
150. 拒绝后该 claim 不进 `activeModel`，对应假设 `stopsDrivingPersonalization === true`。
151. 首次知情说明未确认时不发出任何 `memoryPreview`。
152. 家长收窄范围后的记录进入 `awaiting_reassent`，在下一次同族迁移成功时被 `nextCandidateToAsk` 端到孩子面前并重新走三选项；在此之前不进 `activeModel`。

### `packages/learning-kernel/test/growth/tier2-happy-path.test.ts`（MF-02 守门测试）

153. **用 `mathPlugin` 跑完整条主路径**：`UTTERANCE("结果会比 2.4 小")` → `UTTERANCE("0.3 是 3 个 0.1")` → `ANSWER("0.72")` → `DONE` 隐式满足 → `EXPLAIN("因为 0.3 是 3 个 0.1，所以比 2.4 小")` → `TRANSFER` → `ANSWER("1.4")` → 预览 → 「记下来」→ 账本出现一条档 2 记录且 `outcome.committed === true`。**任何新增门禁条件必须先证明这条仍绿。**
154. 同一路径在 `fake-plugin` 下同样绿。
155. 该路径上 `hypothesisKeys` 为空数组（mathPlugin 算对时只给 weakens），记录照样写进去 —— 证明「必须有存活根因假设」这类追加条件不得存在。

###
`packages/learning-kernel/test/orchestrator-recovery.test.ts`（改动）

156. `MEMORY_PENDING` 下重启宿主，`viewSnapshot()` 补发的 `memoryPreview` 携带**同一个** `previewNonce`，孩子回带被接受。
157. `previewNonceCounter` 从快照还原：重启前发过 2 次预览，重启后第 3 次的 nonce 不与前两次撞号（`OrchestratorRuntime` 里必须有这个字段，否则本条红）。
158. `frozenTargets` 与账本 `contests` 表在快照丢失/重启后仍在。
159. `RunRecorder` 与 `round_active_candidates` 从快照还原，重启后打点不从零开始（`transferTainted`、`probesIssued`、`maxHintLevelUsed` 全部续上）。
160. `artifactId` / `artifactVersionId` 从快照还原：重启后新事件仍挂在同一作品版本链上，不另起一件作品。
161. 出站 id 重启后不撞号（重启前后 id 集合无交集），且 `viewSnapshot` 不再产生独立的 `snap-N` 编号。

### `packages/learning-kernel/test/store.test.ts`（改动，MF-33 的构造点）

162. `InMemorySessionStore` 与 `SqliteSessionStore` 跑同一套契约：`appendEvent(sessionId, stored, artifactVersionId)` 三参数、`effectiveQualityOf`、`backfillArtifactVersion` 行为一致。
163. `SqliteSessionStore` 构造器接收注入的 `LearningDatabase`（不再接 path），两个实现的契约测试都不自己开库。
164. `backfillArtifactVersion` 只回填 `artifact_version_id IS NULL` 的行，返回回填条数；重复调返回 0。

### `packages/learning-kernel/test/proposal-validator.test.ts`（改动，MF-38、MF-17）

165. `memoryCandidate` 引用不存在的 `hypothesisKey` → 拒 `memory:unknownHypothesis`。
166. `memoryCandidate` 指定唯一根因且 `probeResolved === false` → 拒 `memory:rootCauseNotDiscriminated`。
167. `frozenTargets` 含 `{kind:"proposal", id}` 时该提案被拒 `proposal:frozen`（类型改了之后仍然拦得住）。
168. 被拒提案落库后 `proposal_json` 里没有 `memoryCandidate.description`（脱敏在 `saveProposal` 里发生）。

### `packages/learning-kernel/test/plugin-contract.test.ts` / `packages/plugin-math/test/`（MF-30）

169. `runPluginContract(mathPlugin)` 全绿，含收紧后的 `probeSeparatesTwo`（三个探针都通过）。
170. `runPluginContract(fakePlugin)` 全绿。
171. `manifestHasOrderedDifficultyBands`：`difficultyBands` 非空且挑战的 band 在表里。
172. `manifestForbiddenPatternsSerializable`：`JSON.parse(JSON.stringify(manifest))` 与原 manifest 深等。
173. `hypothesisCatalogCoversProbes`：探针里出现的每个 `hypothesisId` 都在目录里。
174. `childFacingPhrasesReadable`：全部儿童版短语非空、≤ 40 字、过内核禁词表。
175. `evidenceCarriesSurfaceContext`：插件产出的每条证据都有非空 `surfaceContextKey`，方向只有 `supports`/`weakens`（全仓不存在 `refutes`）。
176. `classifyProbeOutcomeHasSample`：每个探针每个 outcome 的样例都能被归回该 outcome。
177. `developmentGoalDeclared`：`challenge.developmentGoalId` 在目录里且短语一致。

### `packages/learning-kernel/test/kernel-purity.test.ts`（不改，必须保持绿）

178. `packages/learning-kernel/src`（含新增 `growth/` 全部文件与中文注释）不含学科字面量。

### `apps/agent-host/test/child-channel.test.ts`（MF-08、MF-24）

179. 会话已 `COMPLETED` 时 `/child/understanding`、`/child/contest`、`/child/deletion-requests` 三个调用都返回 200（不是 `policyError`、不抛错）。
180. 宿主重启后进程里没有活动会话时，同三个调用仍返回 200。
181. **这三个调用不触发 `host.open`**：调用前后 `host.sessionIds()` 不变，库里不新增 `sessions` 行、不新增挑战（修「看一眼等于开一节课」）。
182. 这三个调用不占用 `clientSeq`：之后的 WebSocket `event` 帧序号仍连续。
183. 孩子发起删除 → 家长队列出现 → 家长处理 → `child_notifications` 出现结果 → `/child/notifications` 拿到。
184. `/child/first-use-notice` 未确认时返回 `acknowledged:false`；ack 之后为 true 且落 `first_use_notices` 行。

### `apps/agent-host/test/parent-channel.test.ts`（MF-23、MF-25）

185. 儿童通道（8788）上 `GET /parent/growth/records` 返回 404（路由根本不存在）。
186. 家长通道的 `listen` 配置是 `host: "127.0.0.1"`（配置断言）+ 一次回环连通性对照；不依赖真实网卡。
187. 无 `X-Parent-Token` → 401；错误 token → 401；正确 token → 200。
188. `POST /parent/growth/candidates/:id/review` 在儿童通道上不存在（档 3 的家长审阅无法由儿童端自助完成）。
189. `GET /parent/export` 返回完整归档并含作品、记录、决策、审计四类。
190. **路由清单快照测试**：家长通道上不存在 commit 入口、不存在趋势 correct、不存在代替孩子同意的入口、**不存在任何接受 `childFacingText` 的 body 字段**（对每条 POST 的 zod schema 断言键集合）。
191. `POST /parent/growth/records/:id/narrow-scope` 改动范围后 `needsReassent === true`，原 `child_assents` 置 `voided`，该记录不进 `activeModel`。
192. 对 `contested` 记录调 `narrow-scope` → `parent.cannotCorrectContested`；对 `tier === 3` 记录 → `parent.cannotCorrectTrend`。
193. `parentNote` 命中禁词 → 400 `parent.forbiddenLabelInNote`，不落库。

### `apps/ipad/ScholarPad/ScholarPadTests/`

194. `SessionProtocolTests`：`MEMORY_ASSENT` 编解码带 `candidateId` 与 `previewNonce`；`CONTEST` 带**必填**的类型化 `target`，缺 target 即解码失败。
195. `SessionProtocolTests`：`memoryPreview.options` 顺序与个数固定，缺一即解码失败；`speak` 与 `learnerTask` 都带 `contestTarget`。
196. `SessionViewStateTests`：收到 `memoryPreview` 后 `memoryPreview != nil`；收到 `memoryDismissed` 或转到 `MEMORY_PENDING`/停车状态之外的 phase 时清空；停车状态（`WAITING_CONFIRMATION`/`PAUSED_*`）下**不清**。
197. `SessionViewStateTests`：`resetForResume()` 清空 `memoryPreview`（宿主随后用同一 nonce 补发，不靠客户端记忆）。
198. `SessionViewStateTests`：`contestTarget` 按 §8.1 的四级优先级推导；`INDEPENDENT` 只有 learnerTask 时也非 nil。
199. `SessionViewStateTests`：`firstUseNotice` 未确认时同意卡片不渲染。
200. **源码级机械检查**：读 `MemoryPreviewCard.swift` 断言不含 `borderedProminent`、`keyboardShortcut`、`defaultFocus`、`.tint(`。

### `apps/ipad/ScholarPad/ScholarPadUITests/`

201. `MemoryAssentSmokeUITests`：三个 `assent-*` 按钮存在，`frame.width` / `frame.height` 三者相等。
202. 同上：证据摘要元素的 `frame.minY` 小于三个按钮（孩子先看到依据）。
203. 同上：**卡片挂着时四个常驻按钮仍存在且可点**（8.1），点空白不关闭卡片，不设超时自选。
204. `ChildUnderstandingSmokeUITests`：会话 `COMPLETED` 状态下「不是这样」与「请删掉」按钮仍可点且有反馈。
205. `FirstUseNoticeSmokeUITests`：首次启动先看到知情说明，文案与 `FIRST_USE_NOTICE_V1` 快照一致。

### 覆盖率自检（写进 CI）

206. 每条 `GATE_RULES` 的 `ruleId` 在测试文件里至少被断言一次（表驱动扫描：读 `GATE_RULES` 与测试源码，缺一即红）——这是 MF-19「每条规则一对一挂测试」的机械保证，也防止规则 id 在文档与代码里漂成两个名字。

---

## 必修项对照

| MF | 本设计中修它的机制 |
|---|---|
| **MF-01** | `SessionGateSnapshot`（§2.1）是 `buildAndPreflight` / `nextCandidateToAsk` / `evaluateAssent` / `recordAssent` 的**必填**入参，由 `SessionOrchestrator.gateSnapshot(now)`（§10.6）在预检那一刻与孩子按下按钮那一刻各现取一次；`GrowthSessionPort` / `GrowthAssentPort` 上不存在任何读会话状态的方法。`assistedRound` 用 `RunRecorder` 的**粘性**口径（run 内曾为真即为真），软着陆后回到 `MEMORY_PENDING` 也拒。档 2 档 3 共用唯一提交入口 `GrowthAssentPort.recordAssent`。规则 `shared.snapshotPresent` / `shared.snapshotFresh` / `shared.notAssistedRound` / `shared.stateIsMemoryPending`。§10.6 显式写明该验收测试拆成 preflight 层与 decide 层两条的读法与理由。测试 44、45、50、62、64、134、135。 |
| **MF-02** | 门禁不追加「必须有存活根因假设」「必须有区分性探针证据」：`t2.hypothesesKnown` 允许空数组（测试 48、155），`t2.rootCauseDiscriminated` 只在候选声明**唯一**根因时生效。来源 B `foldCapabilityClaim`（§10.5）绑 `run.developmentGoalId` 而非五类根因。`orchestrator` 的 `transferSucceeded.hasMemoryCandidate` 改为 `candidate !== null`（§10.4）。守门测试 `tier2-happy-path.test.ts` 用 **`mathPlugin`** 跑完整条主路径（测试 153，逐条事件在 §13 里写死），`fake-plugin` 同路径（测试 154）；任何新增门禁条件必须先证明这两条仍绿。 |
| **MF-03** | `GrowthLedgerService.open({db, clock})` 静态工厂 + private 构造器 + `#store` 私有字段 + `#commitRecord` 私有方法；`growth/store/growth-sqlite.ts` 与 `growth/database.ts` 不从 `index.ts` 导出。**验收里「编排器与网关拿到的类型上不存在提交入口」在 §9.3 显式说明做不到且不该做**（孩子的同意必须由会话侧在按下按钮那一刻递交），改为把提交隔离到只有一个方法的 `GrowthAssentPort`，并用五条机械保障替代：不导出、双目录 import 扫描、`node:sqlite` 扫描、端口方法穷举（用**全表内容哈希**而非 `COUNT(*)`，覆盖 `narrowScope` 这类改写）、按**返回类型**而非名字前缀的类型级黑名单（档 1 写入方法因此叫 `ingestArtifactVersion`，与黑名单不冲突）。测试 109–115。 |
| **MF-04** | `growth/discrete-guard.ts` 的 `assertDiscreteOnly` / `findDiscreteViolations`（§2.5）按**值**判定：非整数拒、`0<|x|<1` 拒、以 `Ratio/Rate/Confidence/Probability/Likelihood` 结尾的 number 字段拒（整数也拒）、计数字段要求非负整数；字符串根本不进 number 分支，`probeFamilyId` / `probeId` / `scoreBand` 不会被误伤。规则 `shared.discreteOnly`。测试 1–7。 |
| **MF-05** | `screenChildFacingText(fields, extraPatterns)`（§2.6）在 `buildCandidateDraft` 内部、预览出站**之前**调用，覆盖 `childFacingText` / `evidenceSummaryText` / `targetObject.label` / scope 儿童版说法四段，外加插件短语与首次说明文案。`PERSONA_PATTERNS` 内置通用人格化谓词与结构模式（`不擅长XX`、`XX差/弱/不行`、`总是错`、`从来不`），插件 `forbiddenClaimPatterns` 只作补充。**不扫孩子自己的内容**（作品标题、原话），档 1 门禁因此只有结构判定。家长 `parentNote` 照样过词表。测试 8–13、193。 |
| **MF-06** | `ContestTarget = {kind, id}` 五种 kind，`CONTEST.target` **必填**（§11.1）；出站 `speak`、`learnerTask`、`memoryPreview` 都带 `contestTarget`，儿童端按四级优先级填出（含 `INDEPENDENT` 只有任务时的 `hypothesis`/`session` 兜底），`ChildSessionView.swift:127` 的 `nil` 分支消失。`proposal_hypotheses` 的**写入者与时机拍死**：编排器在 `emitProposal` 成功之后写入，key 取自 `RunRecorder.activeCandidates()`（§8.1）。编排器转换成功后调 `ledger.contest(...)` 落 `contests` + 冻结集。测试 131、143、144、158、194、195、198。 |
| **MF-07** | 冻结的一等对象是 **claimKey 不是假设**（§8.2）：`contests.claim_keys_json` + `contest_frozen_links/points` + 规则 `shared.notContestedClaim`（**不依赖假设存在**），彻底堵住「主路径候选没有假设 → 冻结落空 → 同一 claim 被原样重生成」。记录状态用 9.4 六态，contest 后 `activeModel()` / `personalizationInputs()` 都不返回。解冻三条件：不在冻结集 ∧ `observedAt > contestedAt` ∧ 来自 `discriminates` 非空的区分性 run；`contested → confirmed` 一步到位禁止。档 3 适用同一规则。测试 25–30。 |
| **MF-08** | 儿童侧账本走**独立 HTTP** `/child/*`（§12.4），不走 WebSocket 帧、不占 `clientSeq`、**不调 `host.open`** —— 修掉「孩子看一眼等于开一节课」。`ChildUnderstandingView` 用 URLSession。会话已 `COMPLETED`、宿主重启后无活动会话时三件事都返回 200。测试 179–182、204。 |
| **MF-09** | 三个独立类型 `ChildFacingView` / `ParentFacingView` / `AgentFacingView`（§2.4），投影在账本内部完成。`activeGuesses` 的**文案生产者拍死**：`manifest.hypothesisCatalog[].childFacingGuess`（§1.1），内核只搬运，`runPluginContract` 校验它可读且过禁词表（测试 174）—— 修掉「把 hypothesisKey 原样吐出来也能过测试」。孩子视图含 9.6 五类内容 + 5.7 中性脚手架句。测试 116–120、117 显式断言等于插件原文。 |
| **MF-10** | `artifacts` / `artifact_versions` 表 + 版本链（§9.2）；写入者显式（`writer` 枚举），宿主在 `start()` 与每次快照时机调 `ingestArtifactVersion`（§10.10）；`events.artifact_version_id` 是**服务端列**，纯语音事件同样有。档 1 独立写入函数与独立门禁 `evaluateTier1Gate`（§3.3，不跑禁词表），三档门禁三个导出函数。测试 65–69、146。 |
| **MF-11** | `openLearningDatabase(path)` 是全仓唯一 `new DatabaseSync` 的地方（§7.1）；`SqliteSessionStore` 构造器改为接收注入的 `LearningDatabase`；会话表与成长表同库同连接；删除整段在单个 `BEGIN IMMEDIATE` 内完成。测试 84、85、163。 |
| **MF-12** | 删除同时脱敏 `events.event_json` / `outbound.messages_json` / `snapshots.snapshot_json` / `proposals.proposal_json`（§7.2 步骤 2）。归属判据一是 `events.artifact_version_id`（服务端列，覆盖不带客户端 `artifactVersion` 的纯语音转写）；判据二是 `proposals.run_id` 与 `run.firstServerSeq..lastServerSeq` 区间。脱敏不删行，`event_id`/`client_seq`/`content_hash`/`quality` 四列不动。测试 86、88。 |
| **MF-13** | 纯函数 `planDeletionCascade(input): DeletionPlan`（§7.2），返回 `evidenceRemovedLinkIds` / `invalidatedRecordIds` / `removeScaffoldPointIds` + `newTrendGaps` / **显式的** `voidedAssentIds` / `voidedReviewIds` / `redactedDecisionIds` / 不含任何内容文本的 `audit`。`evidenceSetHash` 口径改为只算 active 链接，**同时**保留显式作废路径（两条路都验，不依赖哈希自动变）。测试 80–83、90、91。 |
| **MF-14** | `RunRecorder.enterTransfer()` 打点 + `transferOpen` 期间任何 `noteHint` 置 `transferTainted = true`（§10.3），与当时是 `INTERVENING` 还是绕道 `ASSESSING` 无关；重进 `TRANSFER` 不清，只有 `beginRun()` 清。**清零口径补齐**：`beginRun` 在每次 `challengeValidated` 调用（含 `SOFT_LANDING → PREPARING` 路径），修掉软着陆继承上一题记账的缺口。`noteAssisted()` 的调用点明确（每次 `apply()` 之后同步）。记录必带 `transferRefs[].transferHintLevelUsed: 0`（类型锁死）与 `maxHintLevelUsedAtAchievement`，数据库 CHECK 再挡一次。规则 `t2.transferUnhinted` 只看迁移期提示，**不看** `maxHintLevelUsed`（5.6 允许 4 级演示后 0 级迁移）。测试 49、137–140。 |
| **MF-15** | 服务端生成 `previewNonce`，`previewNonceCounter` **进 `OrchestratorRuntime` 字段清单**（§10.3 与 §10.7 一致，修版本 B 的漏列）；`viewSnapshot()` 在 `MEMORY_PENDING` 补发时复用同一 nonce 且并入同一个 `outboundCounter`（不再有 `snap-N`）。**不设回答时效**（理由见 §10.7），避免重启后孩子被静默拒绝。规则 `t2.assentNonceMatches` / `t2.assentAfterPreview`。测试 115、141、142、156、157、161。 |
| **MF-16** | 跨轮身份是 `hypotheses.hypothesis_key`，本轮活跃是 `round_active_candidates(run_id, hypothesis_key)`，两件事分开存；`assertActiveCandidateLimit` 被 `activateRoundCandidate` 与 `reactivateHypothesis` 两条路径共同调用（§5.1），不依赖任何表触发器；新 run 从上一 run 的活跃集继承。测试 31、32、159。 |
| **MF-17** | `separatesTwo(probe, a, b)`（§5.2）要求两个结果**分别**把 A、B 分开，比 `touched.size >= 2` 严；`selectDiscriminatingProbe` 在活跃候选 < 2 时返回 null，不放行。**探针的代价口径整块拍死**（§5.3）：走新增的 `ASSESSING --probeIssued--> ASSESSING`（§0.2 修改三），不计 `escalationCount`/`maxHintLevelUsed`、不受提示预算、只受 `PROBE_BUDGET`，`probes_issued` 单独记进 SDP 但不参与趋势判定 —— 修掉「跑到第三个探针必然软着陆」与「探针被趋势误报成教学警报」。`probeResolved` 只在结果确实把 top2 分开时置位，新候选进场清零。`plugin-contract.ts` 同步收紧，`mathPlugin` 三个探针仍通过。测试 35–43、56、145、169。 |
| **MF-18** | 5.0 表 `MEMORY_PENDING` 行加 `localRulesPassed` 守卫，失败记 `guardFailed` 且状态不变（§0.2 修改一）；**提交顺序改为「只读裁决 → 守卫 → 提交」**（§10.8），转换被拒时账本一个字都没写；另加规则 `shared.stateIsMemoryPending` 与 `shared.postTransitionCompleted` 作第二、三道锁。新增 `memoryHeld` 给孩子出口（§0.2 修改二），并写明「停在 `MEMORY_PENDING` 的是候选不是孩子」这一读法与理由，要求回写规范 5.0 与 9.1.1。测试 125–128、134–136。 |
| **MF-19** | 一份 `GATE_RULES` 表（§3.1），每条带 `phase`；`preflight` 与 `decide` 共用内部 `runRules`，`preflight 失败集 ⊆ decide 失败集` 结构性成立。**`preflight` 入参带候选**（候选草稿是纯内存对象，不过就不落库、不问孩子），修掉「候选级规则跑不到 preflight」；`nextCandidateToAsk` 是显式队列，每条在返回前都跑 preflight 与禁词筛查，修掉「档 3 候选覆盖上来没预检」。RuleTape 不短路。测试 46、47、63、104、133、206（每条 ruleId 至少一条测试的机械扫描）。 |
| **MF-20** | 拒绝/不确定后候选转 `declined_unsure`，claim 不进 `activeModel()`，对应假设 `stops_driving_personalization=1`、不进 `personalizationInputs()`、不参与探针 top2、不影响难度带（**不得改名继续用**）。`decline_signals` 表 + 规则 `t2.askAgainAllowed`（14 天 ∧ ≥1 个新 run ∧ 新表面情境的新证据），**在 preflight 层跑**——孩子不会被重新问一遍才知道在冷却期。连拒计数只产出 `parent_signals{repeatedDecline}`。测试 57、122、149、150。 |
| **MF-21** | `FIRST_USE_NOTICE_V1`（§11.4）+ `first_use_notices` 表 + `/child/first-use-notice/ack` + 规则 `shared.firstUseAcknowledged`（preflight 层，未完成不得发出任何 `memoryPreview`）。**文案补齐 9.5 第一条要求的两件事**：系统会自己猜「你在哪一步卡住」且家长看得到、跨轮那种话家长比你先看到；并且**不承诺做不到的权利**（删除要家长一起决定，决定前先停用）。文案自身过禁词表，有快照测试。测试 58、151、184、199、205。 |
| **MF-22** | **家长在结构上写不出孩子没看过的句子**（§8.3）：`child_facing_text` 只由内核模板从「插件短语 + 离散计数 + scope」渲染，家长端**任何路由的 body 里都没有能写进它的字段**（有键集合快照测试 190）。家长只有批准/拒绝/收窄范围/降级/撤回/导出。收窄范围会让句子重渲染 → 作废原同意 → 退回 `awaiting_reassent` → 退出 `activeModel`。**重新问孩子的路径拍死**：`nextCandidateToAsk` 队列优先级第一位，在下一次同族迁移成功时被端到孩子面前（刻意不新增打断孩子的入口，理由写明）。`contested` 记录禁止任何纠正。测试 152、191、192。 |
| **MF-23** | 儿童通道 `0.0.0.0:8788`（`/healthz`、`/session`、`/child/*`）与家长通道 `127.0.0.1:8789`（`/parent/*` + `X-Parent-Token`）两个独立 Fastify 实例（§12.1）；儿童通道上**根本没有** `/parent/*` 路由（404）。测试口径改为**配置断言 + 回环连通性对照**，不依赖真实网卡（修「测试 139 在 CI 不可重复」）。测试 185–188、190。 |
| **MF-24** | `deletion_requests` 表（自由文本列全部删掉，只存计数与时间）+ **部分唯一索引** `WHERE status='pending'`（修「第二次被拒时插入炸掉」）+ `GrowthChildPort.previewDeletion/requestDeletion/withdraw/myRequests` + 家长队列与结果回传 + `child_notifications`（只存文案键）。**中止效果、超时、复核三件补齐**（§7.4）：请求提交即停用，家长拒绝**也不解除**（只有孩子撤回或主动同意才解除），7 天 SLA 只告警不自动删，第二次请求标 `escalated`。记录级删除让孩子不必删整件作品。测试 92–99。 |
| **MF-25** | `growth/permission-matrix.ts` 的 25 格常量 + 逐格测试，**测试口径写进 §13 测试 123**：有 `allow` 的格双路径，`allow` 为空的格只验拒绝（不假装 50 条）。孩子只有 `requestDeletion`；家长对跨轮趋势只有事前审阅（`narrow-scope` 返 `parent.cannotCorrectTrend`，且路由层不存在趋势 correct）；`GET /parent/export` 存在。**`editedChildFacingText` 整条删除**——版本 B 从审阅端点旁路行使「可纠正」的漏洞被堵死。§0.2 修改五显式声明「学科插件 × 临时假设」格改由内核实现并给理由。测试 123、189、190。 |
| **MF-26** | `GrowthRecord` 类型强制七项（§2.2 逐项标号），`assertRecordComplete` 缺项报字段名。**档 2 无假设时的口径拍死**：五个计数由 `summarizeClaim(claimKey, links)` 从证据链接 fold 出来（§4.2，claim 级不是假设级，有没有假设都算得出）；「下一次验证条件」是**结构化对象** `NextVerification` 由内核模板生成、不是自由文本。因此测试 48（空假设候选通过）与测试 59（缺项即拒）不再打架，测试 60 显式钉住这一点。档 3 同构（`transferRefs` ≥3、`trendRef` 非空）。测试 48、59–61。 |
| **MF-27** | `resolveConfirmedEvents` 仍是唯一口径，原 `events` 行永不改写、`content_hash` 不变；新增**派生索引** `event_confirmations`（`appendEvent` 同事务 upsert，可从 events 完整重建），`SessionStore.effectiveQualityOf` 联查。`ingestRun` 逐条回查、不信调用方，只有 `confirmed`/`corrected` 成链接。测试 19–21、162。 |
| **MF-28** | `analyzeScaffoldTrend`（§6.2）：gap 前置短路 → 点数不足 → **rising 优先**（首尾比较，不看前窗口）→ withdrawing → 首尾持平才看前窗口，且 `prev.length < 3` 时**绝不把 0 当基线**；数组下标显式收窄。`trend_gaps.added_since_count` 让「数据不完整」是当次标记、补齐自动恢复。测试 70–75。 |
| **MF-29** | 被拒提案的自由文本**在 `saveProposal` 时就不落库**（`redactProposalForStorage`）；`planRetentionPrune` 30 天脱敏清理，执行前反查 `GrowthReadPort.referencedEventIds()`（反向依赖显式写进端口）；`apps/agent-host/src/retention-job.ts` 是实际作业。**脱敏后的最小可解析形状定义在 §7.3**（仍是合法 `EvidenceEvent`/`SessionSnapshot`/`TeachingProposal`，四列不动），修掉「清理过的会话一 open 就抛 TypeError」。Codex 的 `memoryCandidate.description` 一并抹掉，不长期保存。测试 100–103、89、107。 |
| **MF-30** | `DisciplineEvidence` 加 `surfaceContextKey` / `fromProbeId` / `selfCorrection`，方向仍是 `supports`/`weakens`；manifest 加 `difficultyBands` / `forbiddenClaimPatterns`(`string[]`) / `hypothesisCatalog` / `developmentGoals`；`LearningChallenge` 加 `developmentGoalId` / `childFacingGoalPhrase` / `surfaceContextKey` / `surfaceContextLabel` / `probeId` / `discriminates`；`ChallengeInput` 加 `knownRecords` / `dueReviews` / `requiredProbeId` / `competingHypothesisIds`；接口加 `classifyProbeOutcome`；`DiscriminatingProbe` 加 `samples`。`runPluginContract` 新增八项校验（§1.2），`mathPlugin` 与 `fake-plugin` 同步更新全绿，`kernel-purity.test.ts` 保持绿。测试 169–178。 |
| **MF-31** | SDP 记录时就固化 `difficulty_band_index`（`manifest.difficultyBands.indexOf`，run 关闭时算好），账本此后不问插件；`isComparable` 用下标距离 ≤1。**软着陆降 band 的点靠下标自然分流，不按 `assistedRound` 排除**（§6.1）——纠正版本 B「assisted 点整条排除」削弱教学警报灵敏度、且与 5.7「SDP 来自所有会话」相反的错误。档 3 的三点门槛另行严格（`t3.threeComparableChallenges` 要求三点全部非辅助轮），两件事分开。测试 54、76–78。 |
| **MF-32** | `ChallengeInput.dueReviews` + `GrowthReadPort.dueReviews(learnerId, discipline, now)`（查 `next_verification_due_at <= now AND status='confirmed' AND suppressed_reason IS NULL`），由编排器 `buildChallengeInput()` 实际消费（§10.12），插件把回看任务放进 `learnerPrompt`，孩子端看得到。`growth_records` 上有 `rec_due` 索引。测试 147。 |
| **MF-33** | §0.3 列全新增文件、被改的既有文件与**全部十个测试构造点**（含版本 B 漏掉的 `store.ts` / `store.test.ts` / `plugin-math/test`）；`SessionStore` 接口的三处扩展在 `InMemorySessionStore` 同步实现并跑同一套契约。`OrchestratorDeps.ledger` / `assent` 可选，缺省 `NULL_LEDGER`。宿主侧 `growth-wiring.ts` 进程级创建账本、跨会话持有、`onClose` 关闭（§10.1）。测试 148、162–164。 |
| **MF-34** | `GrowthLedgerService.open({db, clock})` 注入时钟，机械扫描 `growth/` 不含 `Date.now`；趋势与 fold 的数组下标显式收窄（§6.2 的 `w0/w1/w2`）；manifest 的模式存 `string[]`，`compilePatterns` 在内核侧编译，`JSON.stringify` 往返测试。「过期」「解冻」类判定全部由注入时钟驱动、可重复。测试 33、34、172。 |
| **MF-35** | 成长层全部内核源码与中文注释用「某一族题目」「这个发展目标」这类占位说法；`forbidden-labels.ts` 只写人格化谓词与结构模式（`不擅长[…]{1,8}` 而非整词），学科专有贬义说法在插件 `forbiddenClaimPatterns` 里；儿童版文案的学科词一律来自插件字符串、内核模板只有连接词与数字（§2.7）。测试 10、14、178。 |
| **MF-36** | 建库时 `PRAGMA secure_delete = ON`（§7.1，与 WAL 同批）；删除事务提交后 `wal_checkpoint(TRUNCATE)` + `VACUUM`，再扫库文件与作品目录断言 0 命中；测试**先自检**删除前能扫到金丝雀串，避免恒绿空测试。测试 86、87。 |
| **MF-37** | §0.1 阶段声明：本设计 = 阶段 3 全量 + 阶段 4 的「删除语义」与「跨轮退出趋势」提前，写明三条理由（与数据模型强耦合、9.5 底线不能等、档 3 门禁依赖趋势）与代价（实现量与测试面约 1.6 倍、`CodexRealtimeBridge` 接入后移），并要求实施后回写规范 14.6 第 3、4 项。 |
| **MF-38** | §10.5 写死两条来源：来源 A 是 Codex 提案的 `memoryCandidate`（`proposal-validator` 扩到四条分支，`description` **只在内存里对齐 claimKey，永不落库、永不呈现**），来源 B 是账本 `foldCapabilityClaim` 自建（绑 `developmentGoalId`，`hypothesisKeys` 可空）；去重键 `claimKey`，并存时合并、`proposedBy = "bridge+kernel"`，来源 A 被拒时不降级为自建。**「儿童版描述由谁生成」这一格填满**：`renderChildFacingText` 从插件的 `childFacingGoalPhrase` + `surfaceContextLabel` + 离散计数渲染（§2.7、§1.1），不再是 id 串；由 `screenChildFacingText` + `assertDiscreteOnly` 在预览出站前校验。测试 104–108。 |

---

## 附：本稿相对上一版的实质改动（供评审快速定位）

1. **提交顺序反转**：`evaluateAssent`（只读）→ 状态机守卫 → `recordAssent`（唯一写入），并加 `shared.stateIsMemoryPending` 与 `shared.postTransitionCompleted` 两条规则。上一版「先提交后守卫」会产生「孩子被告知没记、账本已经记了」。
2. **`memoryHeld` 出口 + 卡片不再是不可退出的模态**：门禁失败时孩子不必说一句自己不这么想的话才能离开。
3. **儿童版文案有了真正的生产者**：插件提供 `childFacingGoalPhrase` / `surfaceContextLabel` / `hypothesisCatalog[].childFacingGuess`，内核模板只拼装。上一版孩子会看到 id 串。
4. **Codex 自由文本与家长改写文案两条泄漏路径全部删除**：`bridge_suggested_text` 不存在，`editedChildFacingText` 不存在，家长纠正只能收窄结构化范围。
5. **冻结改挂 claimKey**：主路径候选没有假设时异议也真的生效。
6. **探针的代价口径整块补齐**：新增 `ASSESSING --probeIssued--> ASSESSING`，探针不进提示预算，`ASSESSING` 接受孩子产出。
7. **SDP 不再按 `assisted_round` 排除**：教学警报的灵敏度还回来，档 3 门槛另行严格。
8. **删除请求闭环补齐**：部分唯一索引、请求即停用、家长拒绝不解除、SLA、复核；`preview_json` 自由文本列删除。
9. **脱敏后的最小可解析形状定义**：清理过的会话 `open()` 不再抛错。
10. **`previewNonceCounter` 进快照字段清单**、`peek()`/`snapshot()` 统一、`noteAssisted()` 有明确调用点、规则 id 全表统一、`store.ts` 与 `store.test.ts` 进构造点清单——上一版的编译级与命名级漏项全部补齐。