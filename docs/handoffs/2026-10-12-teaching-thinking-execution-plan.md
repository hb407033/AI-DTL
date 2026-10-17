# 教学思维改造执行计划（任务拆解）

日期：2026-10-12
状态（2026-10-13 校正）：实现与验收分开记录，不再使用 27/29（93%）这一未经逐项验证的数字。真实生产 provider 对照已完成，但多轮质量门禁未通过，默认仍为 realtime。见本轮报告 `2026-10-13-teaching-thinking-execution-results.md`。

后续更新：多轮单轮失败恢复、2.3通用提示精简约30%、真实失败的有限续验及最新安装事实见 `2026-10-13-teaching-continuity-and-prompt-results.md`；教学质量门禁不因连接接通而自动通过。
依据：
- 方案：`2026-10-12-teaching-thinking-redesign-plan.md`（P0～P3）
- 验收基准：`2026-10-12-tao-thinking-moves.md`（八个思维动作、量表）
- 证据：`2026-10-11-teaching-model-ablation-results.md`

## 〇、进度总览

本节替代此前互相矛盾的“只完成6项”“27/29完成”和“M0-M4全验收通过”表述。代码存在、单测通过、真实模型交付、真实孩子学习有效是四种不同证据。

| 里程碑 | 任务数 | 已完成 | 状态 |
| --- | --- | --- | --- |
| M0 评测基线 | 4 | 本轮固定生产路径基线已落盘 | 19单轮样本＋五题族预写六轮；实际180子调用，不等于所有会话完成 |
| M1 思考接回生产 | 7 | 1.1～1.6已实现并有相关验证 | 1.7质量门禁未通过；真机19项通过，非真人等待满意度 |
| M2 动作维度与判断框架 | 6 | 枚举、纪律、纠错已实现；规则搬迁逐字等价；2.3通用提示已精简约30% | 2.2尚未独立提交；2.3有规则/事实冻结证据；2.6教学质量未通过 |
| M3 数学真值层 | 5 | 五题族及有界复核已接入 | 未支持题意返回未验证；49条求解器测试通过，不声称任意题干正确 |
| M4 P2 第二批 | 4 | 事实摘要、可重建账本、撤手接线已实现 | 4.1真实教学效果未全过；4.3跨作品严格“最近证据”时序仍待补 |
| M5 画布实验 | 2 | 5.1已接入邀请与同意门禁 | 5.2明确不在本计划内，不能计为实施欠账 |
| M6 真实会话验收 | 1 | 未验收 | 模拟不能代替真实孩子T3 |

### 旧消融记录的解释边界

| 指标 | 第 1 轮（基线） | 第 2 轮（修复后） |
| --- | --- | --- |
| 总调用 | 57/57 | 57/57 |
| API 错误 | 0 | 0 |
| 硬失败 | 原报告记0，不能视为生产教学验收 | 原报告记0，不能视为生产教学验收 |
| 总费用 | 0.26 元 | 0.26 元 |
| 校验通过 | 45/57 | 45/57 |
| 主要失败原因 | nextFocus_acknowledge (7次) | nextFocus_acknowledge (9次，已强化提示词) |

旧实验并非完整生产 provider 的0.4基线。2026-10-13已补真正包含校验、复核和最多一次改写的对照；未交付与未评分均保留，不能用API零错误推导硬失败零。

### 本轮真机验证状态（2026-10-13）

- USB iPad构建、安装及相关自动化：19/19通过（WorkspaceClientTests、WorkspaceProcessSignalTests、ThinkingCancellationUITests）。未卸载App。
- 模拟器取消测试：1/1通过，等待与取消后截图保存在本轮私有证据目录。
- 测试采用隔离目录、假12秒决策和真实宿主路由，不调用模型、不采集真人语音；不能冒充真实模型的真机端到端等待满意度。
- 测试前后原有9个存档文件哈希一致、缺失0；家庭数据未用于评测。

### 已完成任务的具体改动

| 编号 | 做了什么 | 改了哪些文件 |
| --- | --- | --- |
| 1.1 | 抽出 `requestThinkingText` 为正式模块，消融脚本不再内联 fetch | 新增 `src/ai/qwen-thinking-text.ts`、`test/qwen-thinking-text.test.ts`；改 `scripts/teaching-ablation-core.ts`、`scripts/probe-teaching-ablation.ts` |
| 1.2 | 决策 provider 文本请求可注入，加 `AI_DTL_DECISION_MODE=realtime\|thinking` 配置，默认 `realtime` | 改 `src/ai/config.ts`、`src/ai/workspace-teaching-decision.ts`、`.env.ai.example`、7 个测试文件的 mock config |
| 3.1 | 精确十进制除法（BigInt），消除 `1.1÷0.1=11.000000000000002` 类浮点误差 | 改 `src/learning/decimal-division-policy.ts`、`src/ai/workspace-teaching-decision.ts`、`test/decimal-division-policy.test.ts` |
| 0.3 | 量表加 T1/T2/T3 和五类硬失败，报告脚本输出新维度 | 改 `scripts/probe-teaching-ablation.ts`、`scripts/report-teaching-ablation.ts`、`test/teaching-ablation.test.ts` |
| 0.1 | 样本集 v2：保留 8 个原有场景，加 3 条失败回归 + 8 个动作正例，共 19 条 | 改 `scripts/probe-teaching-ablation.ts`、`scripts/teaching-ablation-core.ts` |
| 0.2 | 多轮样本：五个题族各一条 6 轮脚本，含孩子状态轨迹说明 | 改 `scripts/probe-teaching-ablation.ts` |

### 原始排期（历史，不代表2026-10-13当前状态）

| 编号 | 为什么没做 | 需要什么才能开始 |
| --- | --- | --- |
| 0.4 | 需要调用真实模型跑基线 | 配好 `DASHSCOPE_API_KEY` 和 workspace ID，执行 prepare + run |
| 1.3 | 两段式决策（schema 加 `analysis`） | 可以立即开始，不依赖任何外部条件 |
| 1.4 | 超长定点改写 | 依赖 1.3 |
| 1.5 | host 发出思考态事件 | 可以立即开始 |
| 1.6 | iPad 思考态 UI | 需要 Xcode 环境和真机 |
| 1.7 | 验收：realtime 对 thinking 对比 | 依赖 1.3～1.6 全部完成 + 真机 |
| 3.2 | 题族求解器接口 | 可以立即开始，规模 L |

### 原始验证快照（历史）

- 328 个单元测试全部通过（59 个测试文件）
- TypeScript 编译无新增错误（仅存原有的 `photo-learning-closure` 两个 `@ts-expect-error` 问题）
- 上述328项和“未做真机验证”是旧快照；本轮实际验证以新报告和xcresult为准。默认决策模式仍为 `realtime`。

## 一、开工前核对到的代码事实

这些事实改变了方案里几处写法，本计划以这里为准。

| 事实 | 位置 | 对计划的影响 |
| --- | --- | --- |
| 决策 schema 是 `strictObject`，`utterance` 上限 90 在解析时就拒绝 | `apps/agent-host/src/learning/teaching-decision.ts` | 新字段必须可选，否则旧存档读不出；超长要在解析前识别，才能走定点改写 |
| 改写和复核循环写在 `QwenTeachingDecisionProvider.decide` 里，底层只调 `requestWorkspaceText` | `workspace-teaching-decision.ts:234` 起 | P0 不必新建平行 provider，把文本请求函数做成可注入即可，改写与复核逻辑原样复用 |
| 非实时思考调用只存在于消融脚本内联代码 | `scripts/probe-teaching-ablation.ts:115-140`，`teaching-ablation-core.ts` 的 `SseAccumulator` | 需要先抽成 `src/ai` 下的正式模块 |
| 抢答复核只在 `method === "ordinary"` 且孩子有表达时触发 | `workspace-teaching-decision.ts:300` 附近 | P1 要扩到所有题族 |
| `nextFocus` 把"你说得不对 / 你理解错了"归到 `clarify` | `workspace-teaching-decision.ts:35` | `acknowledge` 的入口就在这里 |
| 成长账本只接在旧 kernel 会话路由上，workspace 决策链路没有引用 | `server.ts:63-82`；`src/ai/workspace-*.ts` 无 ledger 引用 | 方案 P2 第 6 条"接到现有成长账本"不是直接可用，需要先决定归属（见第四节） |
| workspace 的 scaffold 只支持线段图一种对象，且需要孩子同意 | `session-contracts/src/line-scaffold.ts`（`kind: "line"`），`workspace-scaffold-route.ts` | `numberLine / areaModel / tenthsBar` 是旧 kernel 插件声明的对象，workspace 链路没有。"压扁平行四边形"需要新对象，单独立项 |
| `thinkingMoves` 只被 `plugin-math` manifest 和 kernel 的假插件引用 | `plugin-math/src/decimal-multiplication.ts:124` | 扩成八个不会破坏现有逻辑 |
| 实时文本请求的提示词上限 16000 字符 | `qwen-workspace-session.ts` | 提示词重构时要守住长度，或给思考通道单独设限 |

2026-10-13已核对：workspace原先忽略onEvents；本轮已接事实摘要，思考态与取消也已在模拟器/真机验证。真人等待体验仍未评。

## 二、里程碑与依赖

```
M0 评测基线 ──┬─> M1 思考接回生产（P0）──> M2 动作维度与判断框架（P2 第一批）──┐
              └─> M3 数学真值层（P1）────────────────────────────────────────┴─> M4 P2 第二批 ──> M5 画布实验 ──> M6 真实会话验收
```

M1 和 M3 可以并行。每个里程碑结束都在 M0 的固定样本上跑一次对照，不达标不进下一步。

规模标记：S 约半天内，M 约一到两天，L 两天以上。这是粗估，没有实测依据。

## 三、任务清单

### M0 评测基线（先把尺子做出来）

| 编号 | 任务 | 改动位置 | 完成标准 | 规模 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 0.1 | 固定样本集 v2：保留消融的 8 个首轮场景；加入三条失败回归（B 面积抢答、A 反复求助不响应、C 虚构画面）；加入清单里八个动作的正例场景 | 消融 `fixtures.json` 的新版本；`scripts/probe-teaching-ablation.ts` | 样本清单和哈希落盘，重复准备结果一致 | M | ✅ 已完成 |
| 0.2 | 多轮样本：五个题族各一条 6～8 轮脚本。孩子的发言预先写死，不看老师回复再编 | 同上 | 每条脚本有预期的"孩子状态轨迹"说明 | M | ✅ 已完成 |
| 0.3 | 量表扩展：加入 T1、T2 和五类硬失败；报告脚本输出新维度 | `rubric.json`、`scripts/report-teaching-ablation.ts`、`test/teaching-ablation.test.ts` | 离线重算可复现；T3 字段保留但对模拟样本标为不适用 | S | ✅ 已完成 |
| 0.4 | 基线跑分：用**当前生产路径**（含改写和复核）跑 v2，一次，不重试 | 新增一个走 `QwenTeachingDecisionProvider` 的探针入口 | 基线报告落盘，带请求数上限和截止时间 | S | ✅ 本轮生产基线已落盘（含失败） |

说明：0.2 的预写脚本和老师的实际回复可能对不上，这是模拟样本的固有局限，报告里要注明。0.4 与消融不同，测的是含门禁的生产链路。

### M1 把思考接回生产（方案 P0）

| 编号 | 任务 | 改动位置 | 完成标准 | 规模 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1.1 | 抽出非实时思考调用为正式模块 `requestThinkingText`，接入用量记录；消融脚本改为引用它 | 新增 `src/ai/qwen-thinking-text.ts`；`scripts/probe-teaching-ablation.ts`、`teaching-ablation-core.ts` | 用假 SSE 响应的单测通过；消融离线重算结果不变 | S | ✅ 已完成 |
| 1.2 | 决策 provider 的文本请求可注入，新增配置 `AI_DTL_DECISION_MODE=realtime\|thinking`，默认 `realtime` | `workspace-teaching-decision.ts`、`config.ts`、`server.ts`、`.env.ai.example` | 两种模式下现有决策测试全部通过；改写与复核路径不变 | S | ✅ 已完成 |
| 1.3 | 两段式决策：schema 增加可选 `analysis`；先写可核对的短决策摘要再写 utterance，不索取或存储隐藏思维链 | `learning/teaching-decision.ts`、`workspace-teaching-decision.ts` | 旧存档仍能解析；`analysis` 不进入播报和下发给 iPad 的载荷，有测试覆盖 | M | ✅ 摘要/隔离已验证 |
| 1.4 | 超长定点改写：解析前检查长度，超 90 字走受限编辑器改写（沿用现有 `questionLimit` 的模式），只压缩、不新增数字和结论 | `workspace-teaching-decision.ts`、`test/teaching-decision-repair.test.ts` | 消融里 B 的 103 字面积回复能被压到 90 字内且不丢"压扁"这个动作 | S | ✅ 受限改写已验证 |
| 1.5 | host 发出思考态事件：开始、结束、取消 | `workspace-voice-route.ts`、`session-contracts` | 取消后不再播报；有路由测试 | S | ✅ 含取消竞态回归 |
| 1.6 | iPad 思考态 UI 和"先停一下"取消 | `LearningWorkspaceView.swift`、`WorkspaceClient.swift`、`WorkspaceModels.swift` | 模拟器截图确认；UI 测试覆盖取消 | M | ✅ 真机19项通过；真人体验未评 |
| 1.7 | 验收：v2 样本上 `realtime` 对 `thinking`，都走生产 provider；USB 真机测等待体验 | 探针脚本；`ScholarPadProbe` | 多轮样本上 `thinking` 不差于基线、硬失败不增加，才把默认值切到 `thinking` | M | ⛔ 多轮质量未达标，不切默认 |

关于方案里的"快速承接语"：建议第一版**不做**，只做思考态 UI。理由是它和"不用填充语音掩盖等待"的边界很近，先在真机上看 9 秒的纯视觉等待是否可接受，再决定加不加。

### M2 动作维度与判断框架（方案 P2 第 1、2、4 条）

| 编号 | 任务 | 改动位置 | 完成标准 | 规模 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 2.1 | 插件 `thinkingMoves` 扩为清单的八个；决策 schema 增加可选 `move`（八选一或 `none`）和 `childMove`（带证据编号） | `plugin-math/src/decimal-multiplication.ts`、`learning/teaching-decision.ts` | 枚举从插件 manifest 构造，不在 agent-host 里另写一份；旧存档可读 | S | ✅ 枚举同源/旧档兼容 |
| 2.2 | 小数除法专用规则整体搬到题族模块，只在该题族注入 | `learning/decimal-division-policy.ts`、`workspace-teaching-decision.ts` | 小数除法场景下生成的提示词与搬迁前逐条等价（只移动不删改），现有测试全过 | M | 🟡 逐字等价已验证，未独立提交 |
| 2.3 | 通用提示词改为判断框架：三条总原则、四步 analysis、八个动作各一行、选动作对应表 | `workspace-teaching-context.ts`、`workspace-teaching-decision.ts` | 通用部分明显短于现状；总长度在通道上限内 | M | 🟡 框架存在，通用大幅精简待做 |
| 2.4 | 通用纪律下沉到校验层：`utterance` 不出现动作术语；`childMove` 的证据必须是本轮表达或本轮图片 | `validateTeachingDecision` | 每条新规则有正反两个测试 | S | ✅ 含负证据与误拦回归 |
| 2.5 | `acknowledge`：孩子纠正老师且历史里确有老师发言时进入该状态；校验要求话里有承认、不布置新的计算任务 | `teaching-decision.ts`（focus 枚举）、`nextFocus`、`validateTeachingDecision`、`workspace-voice-route.ts` 的权限映射 | "5 到 10 米间隔"样本通过；孩子纠正的是自己而不是老师时不误触发 | M | ✅ 纠正/自纠正已验证 |
| 2.6 | 验收：v2 样本上对比 M1 | 探针脚本 | T1、T2 平均不低于 1.5，硬失败为 0 | S | ⛔ 未完成完整质量验收 |

2.2 必须先于 2.3，并且单独提交。这样提示词重构出问题时，可以确认不是搬迁造成的。

### M3 数学真值层（方案 P1，可与 M1、M2 并行）

| 编号 | 任务 | 改动位置 | 完成标准 | 规模 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 3.1 | 精确十进制运算，替换小数除法里的浮点 `a / b` | `learning/decimal-division-policy.ts` | 现有除法测试全过；补充浮点会出错的用例 | S | ✅ 已完成 |
| 3.2 | 题族求解器接口：`parse(题干)`、`solve(参数)`；首批五个题族：小数除法、小数乘法、植树、平行四边形面积、一步方程 | 新增 `learning/families/` | 每个题族有解析和求解测试；解析不了时返回空，链路退回现状 | L | ✅ 五题族49测试通过 |
| 3.3 | 知情复核器：把求解结果注入复核提示词；范围从抢答扩到数学错误和画面断言；对所有题族触发 | `workspace-teaching-decision.ts` | 消融里 B 的面积续聊（主动报 40 和 24）被拦下；孩子已说出的数不误拦 | M | ✅ 全题族复核已接；不保证零错误 |
| 3.4 | 画面断言校验：本轮没有附图时，禁止现在时的"你画了 / 我看到你现在" | `validateTeachingDecision` | C 组"说成已画三棵"的样本被拦下；"你原来写的是"这类过去时不误拦 | S | ✅ 无图现在时断言门禁 |
| 3.5 | `solve(variant)`：决策可附带一个结构化的 `probe`（老师拟用的小例子的题族和参数），host 求解后交给复核器 | `teaching-decision.ts`、`learning/families/` | 能确认"10 米路每 5 米一棵"这类小例子的结果；解析不了时记录为未验证，不阻断 | M | ✅ 小例求解/未知不伪造 |

### M4 P2 第二批（依赖 M2 和 M3）

| 编号 | 任务 | 改动位置 | 完成标准 | 规模 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 4.1 | 顺着孩子的想法检验：非标准做法或错误规则默认走 `specialize` / `justify`，小例子经 3.5 验证 | 提示词、复核规则 | "12 ÷ 0.5 只改一边"样本通过；另加一条孩子用了正确的非课本方法的样本，老师必须承认成立 | M | 🟡 规则接入，真实效果未全过 |
| 4.2 | 过程信号：先确认 workspace 链路能否拿到笔画时序；拿不到则由 iPad 在提交时附带事实摘要（擦除次数、最长停顿、书写顺序） | `StrokeDiff.swift`、`WorkspaceClient.swift`、`TeachingInput` | 摘要只含事实；能据此填出"涂改后重写"的 `childMove` | M～L | 🟡 接线/事实冻结已测，语义效果未评 |
| 4.3 | 思维动作账本：按孩子记录每个动作的最近证据和撤手等级 | 见第四节决策 3 | 证据只来自 `childMove`；随作品删除和家长更正生效 | L | 🟡 投影已测，跨作品最近时序待补 |
| 4.4 | 撤手与唤起：把账本摘要注入决策；等级 2 以上的动作只问"你想先怎么试"；唤起只能引用账本里存在的证据 | 提示词、`validateTeachingDecision` | 唤起引用了不存在的证据时被拦下 | M | ✅ 引用/撤手/删除回归通过 |

### M5 画布上的小实验（方案 P2 第 7 条）

| 编号 | 任务 | 完成标准 | 规模 | 状态 |
| --- | --- | --- | --- | --- |
| 5.1 | 第一期只用现有线段图：决策可请求一个线段图邀请，用于植树和小数乘法的 `specialize` / `represent` | 沿用现有的同意和撤回流程 | M | ✅ 邀请/同意门禁已验证 |
| 5.2 | 可压扁的平行四边形等新对象 | 单独立项，不在本计划内 | — | — 明确不在本计划内 |

### M6 真实孩子会话验收

- 统计 T3 和"孩子未经提示做出的动作次数"，这两项只有真实会话才有意义。
- 对照同一个孩子在 M1 之前的存档，看 `look_back` 和自发动作是否出现。
- 需要你安排真实使用场次，这一步我无法代做。

## 四、需要你定的四件事

每项给了建议，不定的话按建议执行。

1. **`analysis` 是否落盘。** 建议落盘，作为会话工作记忆，随作品删除，不下发 iPad，不给家长看。它是评审决策质量的主要依据。
2. **等待时是否播承接语。** 建议第一版不播，只显示思考态，真机测后再定。
3. **思维动作账本放哪。** 建议先在 workspace 存储里做一个独立的轻量账本，复用成长账本的删除和保留规则；是否并入成长账本和家长视图，等 M6 有真实数据后再定。直接并入会牵动家长视图、保留期和旧 kernel 链路。
4. **通过线。** T1、T2 平均不低于 1.5，硬失败为 0，每条多轮样本做对后至少一次 `look_back`。这是建议值。

## 五、可以立即开始、不依赖上述决定的任务

0.1、0.2、0.3、1.1、1.2、3.1。它们都不改变生产行为：评测只读，1.2 的默认值保持 `realtime`。
