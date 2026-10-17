# AI-DTL 第一版第一阶段实施计划：稳定、自然的一题学习闭环

> **For agentic workers:** 使用 `superpowers:executing-plans` 按任务执行。遵循目标项目 AGENTS.md；不得由本计划推断多 agent 委托权限。步骤使用 `- [ ]` 跟踪，完成当前交付后停止，不扩展新平台。

**Goal:** 让孩子在真实 iPad 上完成拍题、写画、连续交流、纠正、暂停和再次打开继续学习，不需要家长处理技术问题。

**Architecture:** iPad 本地响应写画和保存草稿；Mac mini 的一个 AI-DTL 宿主负责权威存档、教学策略与现有 Omni 调用。复用 `LearningWorkspaceView`、`WorkspaceClient`、`WorkspaceStore`，不重建平台、不切换模型、不把 Hermes 作为前提。

**Tech Stack:** Swift 6、SwiftUI、PencilKit、AVAudioEngine；现有 pnpm workspace、TypeScript、Fastify/WebSocket、Zod、文件工作区存储；macOS LaunchAgent。

**Scope:** [范围调整](../specs/2026-10-07-ai-dtl-v1-scope-reset.md)。本计划是新的唯一第一阶段交付清单；旧计划作为历史与回归资料，不再叠加其未完成项。

---

## 0. 执行位置、现状与边界

- 主机：SSH `hb-mini@10.10.10.6`。
- 主仓库：`/Users/hb-mini/Documents/Codex/2026-08-29/wo-yo`。
- 笔记本参考副本：`/Users/houbin/Documents/Codex/2026-08-29/wo-yo`。不得两端同时改同一分支；笔记本可按固定版本构建、安装、测试。
- 检查时两端已知基线为 `codex/ipad-arrival-plan` / `e2a14d1`；工作区有大量既有改动，不能直接暂存全部文件、reset、清理或覆盖。
- mini 的 `twin-status --no-fetch` 已运行，但报 `rel…: unbound variable`，不能用它证明同步成功。执行时先重跑；仍失败则人工比较 HEAD、分支和本任务文件 SHA-256，记录限制，不因辅助脚本故障直接重建仓库。
- mini 的 Hermes 0.21.5、个人 default profile、飞书与 9119 管理服务保持原样；检查时 8791 未监听。不要停止 Hermes，也不要启用其 API。
- 当前模型配置 ID 为 `qwen3.5-omni-flash-realtime`；执行前以当前配置核实，不根据旧文档切换模型。密钥由用户在目标系统输入，不读取、回显、复制密钥或把它放进 plist/证据。
- 本文编写只产生文档。下面的部署、调用、安装及代码步骤均待实施，不算已经完成。

## 1. 发布门槛与停止扩展规则

| 编号 | 第一阶段必须满足 | 证据 |
| --- | --- | --- |
| A1 | 主机启动后自动提供 8791；iPad 首次选择主机后无需日常手填地址 | healthz、hostId、真实局域网连接、托管进程状态 |
| A2 | 已确认题目在横竖屏都能首屏直接书写，主机/单元设置不占儿童画布 | 同一构建两种方向截图、画布四区域触控回归 |
| A3 | 点击一次开启对话后连续五轮，不重新连接、不要求固定求助口令 | 真实路由记录、原生录音播放日志、实际输出音频 |
| A4 | 明确纠正一次，旧反馈/提示失效；打断后不播放迟到音频 | 取消时间、异议记录、旧 responseId 丢弃证据 |
| A5 | 暂停后继续写画；退出重开保留原图、题意、原稿，不自动开麦 | 本机缓存与主机存档往返、重开录像/截图 |
| A6 | 主机短时不可达时原稿仍能编辑与本机保存；重连后显式同步，冲突不覆盖 | 故障注入、未同步标志、原稿前后摘要 |
| A7 | 完成调用能记录实际 usage；缺失、失败调用如实标记，重放不重复累计 | 合成 usage 契约测试、真实调用元数据账本 |
| A8 | 一份可安装 App 与对应宿主版本/源码指纹；不靠编辑源代码临时救场 | 发布清单、安装启动、完整流程结果 |

性能门槛：点击/状态反馈不超过 200ms；本机按钮打断实际停止播放不超过 300ms；20 轮有效试验中“孩子最后一个有声采样→iPad 首段老师音频开始播放”的 P95 不超过 6 秒，优化目标 3 秒。轮数小于 20 不报告 P95；网络/模型异常单列并报告失败率，不能排除失败后声称所有互动流畅。所有数值都是新验收目标，不是历史已通过结果。

半双工、不能靠语音随时插话为明确限制。真实孩子学习效果与跨周提示下降不在本次工程通过声明内，但后续儿童试用不可省略。

不为完成这八项新增平台、替换存储或构建通用图形引擎。不通过时定位当前链路并修复，不以开发下一模块补进度。

## 2. 文件地图

| 任务 | 现有修改入口 | 新增小文件 |
| --- | --- | --- |
| T0 部署基线 | `package.json`、`apps/agent-host/src/ai/learning-tutor.ts`（只为必要健康信息） | `scripts/run-learning-host.sh`、`deploy/macos/com.houbin.ai-dtl.learning-tutor.plist` |
| T1 画布优先 | `apps/ipad/ScholarPad/ScholarPad/Session/LearningWorkspaceView.swift` | 同目录 `WorkspaceParentSettingsView.swift` |
| T2 对话授权 | `packages/session-contracts/src/workspace-learning.ts`、`apps/agent-host/src/ai/workspace-voice-route.ts`、`workspace-teaching-context.ts`、`apps/ipad/ScholarPad/ScholarPad/Session/WorkspaceClient.swift` | `apps/agent-host/src/learning/conversation-policy.ts` |
| T3 回合体验 | `TutorTurnDetector.swift`、`TutorAudioIO.swift`、`WorkspaceClient.swift` | 不新建另一套音频客户端 |
| T4 用量/时延 | `workspace-voice-provider.ts`、`workspace-voice-route.ts`、`WorkspaceClient.swift`、`TutorAudioIO.swift` | `apps/agent-host/src/ai/workspace-usage.ts` |
| T5 恢复/发布 | `ProblemCaptureModel.swift`、`WorkspaceCache.swift`、`HostDiscovery.swift`（仅暴露的缺陷） | `tools/phase1-release-manifest.mjs`、最终交付记录 |

下文 Swift 文件未写目录时，均位于 `apps/ipad/ScholarPad/ScholarPad/Session/`。新增文件只在本任务确实需要时创建；不得把“文件地图”当成允许重构整个目录。

## 3. T0：先建立可运行基线与常驻宿主

**检查/修改文件：** `package.json`、`apps/agent-host/src/ai/config.ts`、`learning-tutor.ts`；新增上述启动脚本和 plist。这一步不改教学。

- [ ] 在 mini 仓库运行 `twin-status --no-fetch`、`git branch --show-current`、`git status --short`、`git rev-parse HEAD`。脚本失败按 §0 人工核实；对端领先/不同则先同步本任务相关内容，不能覆盖任何既有差异。
- [ ] 盘点当前 8791 监听者、数据目录与 host-id；保存原配置/服务状态。确认默认工作区目录 `~/Library/Application Support/ai-dtl/workspaces-v2`，不另建空目录假装数据已恢复。
- [ ] 运行现有最小回归，记录基线失败，禁止把既有失败算成新改动：

```sh
pnpm --filter @ai-scholar/agent-host test test/workspace-store.test.ts test/host-discovery.test.ts test/workspace-voice-route.test.ts
pnpm --filter @ai-scholar/agent-host typecheck
```

- [ ] 在 mini 检查 Node、pnpm、可选 Xcode 可用性；普通缺包按现有 lockfile 自行安装，不反复询问。执行 `pnpm install --frozen-lockfile`，不能为了通过安装随手改 lockfile。
- [ ] 准备启动脚本，按实际 `command -v node` 固定运行时，不依赖 SSH/登录 shell 的 PATH。脚本核心为：

```sh
#!/bin/sh
set -eu
cd /Users/hb-mini/Documents/Codex/2026-08-29/wo-yo
exec node --env-file-if-exists=.env.ai.local --import tsx apps/agent-host/src/ai/learning-tutor.ts
```

部署时 plist 的 `PATH` 必须包含实际 Node 目录；用 `plutil -lint` 验证。设置 `RunAtLoad=true`、`KeepAlive=true`、`ThrottleInterval=10`、明确 WorkingDirectory 与独立 stdout/stderr 日志；不得复制凭据到 plist。用 `sh -n scripts/run-learning-host.sh` 验证脚本。

- [ ] 托管服务前检测重名 LaunchAgent。存在则先记录并备份，不创建第二个争用端口的进程。安装后检查 `launchctl print gui/$(id -u)/com.houbin.ai-dtl.learning-tutor` 和 `curl --fail --max-time 5 http://127.0.0.1:8791/healthz`；必须看到 `status=ok`、`configured=true`、稳定 `hostId`。
- [ ] 本机与局域网检查各一次。模拟当前服务进程退出，确认托管恢复且原 hostId 不变。主机重启需先确认无其他活跃工作受影响；未做整机重启只能记为“进程恢复通过”。LaunchAgent 是用户登录后运行，不宣称无需登录即可服务。

**通过：** 同一个常驻宿主可达，不开 App/麦克风也不产生模型调用。凭据缺失时仅该真实调用门槛受阻，继续所有无云依赖任务；不读取旧机器凭据、不偷偷换模型。

## 4. T1：把画布放回第一屏

**修改：** `LearningWorkspaceView.swift`；新增 `WorkspaceParentSettingsView.swift`。
**测试：** `ScholarPadUITests/LearningWorkspaceUITests.swift`、`ScholarPadTests/WorkspaceResumeTests.swift`。

- [ ] 先新增 `testConfirmedWorkStartsWithVisibleCanvas`：复用现有合成题与隔离目录夹具，在横屏、竖屏分别断言 `childCanvas.isHittable`，不允许先滚动寻找画布。断言以下布局目标：确认后画布可见高度至少占内容区 55%，题目可展开，主机输入字段不在儿童首屏。

```swift
let canvas = app.scrollViews["childCanvas"]
XCTAssertTrue(canvas.waitForExistence(timeout: 10))
XCTAssertTrue(canvas.isHittable)
XCTAssertGreaterThanOrEqual(canvas.frame.height, app.frame.height * 0.55)
XCTAssertFalse(app.textFields["workspaceHost"].exists)
```

- [ ] 运行该用例并记录红灯；不删去“首屏无需滚动”断言来适应旧布局。
- [ ] 确认后的学习空间不再把大段介绍、设置、原图和恢复卡纵向堆在画布之前。使用同一页面的紧凑题目区、可展开原图、独立画布、底部语音状态/操作区；首次拍照及题意确认仍展示原图核对。恢复入口缩小但保留三个既有选择。
- [ ] 设置通过单个“家长设置”sheet 打开，绑定现有 `model.host` / `model.currentUnit`，保留已有 Bonjour 选择，不新建配置仓库。保留品牌“AI 学科心智学习系统”，不改 logo。

```swift
.sheet(isPresented: $showParentSettings) {
    WorkspaceParentSettingsView(host: $model.host, currentUnit: $model.currentUnit)
}
```

在 `LearningWorkspaceView` 新增 `@State private var showParentSettings = false`；新 View 定义 `@Binding var host: String` 与 `@Binding var currentUnit: String`，使用 `Form` 和原字段标识 `workspaceHost` / `workspaceUnit`，关闭按钮 dismiss。对话期间禁用改地址/题目，不能中途转到其他主机。

- [ ] 回归相机取消、题意修改、恢复卡、横竖屏；分别在画布四区域画线，验证都留下笔迹。导出同一构建的整屏截图，不能以截图裁剪掩盖滚动/遮挡。

**通过：** 已确认题目不滚动即可书写；原图原稿仍完整保存。自动触控验证不冒充 Apple Pencil 压感验收。

## 5. T2：一次开启，自然连续交流

**修改：** 文件地图中的协议/路由/客户端；新增 `conversation-policy.ts`。
**测试：** `packages/session-contracts/test/workspace-learning.test.ts`、`apps/agent-host/test/conversation-policy.test.ts`、`workspace-voice-route.test.ts`、`workspace-natural-loop.test.ts`、`ScholarPadTests/WorkspaceClientTests.swift`。

- [ ] 先为旧 hello 默认行为、新对话模式、否定/暂停优先、题意版本改变后失效写失败用例。新增 hello 可选字段 `conversationMode: z.enum(["independent", "dialogue"]).optional()`，旧 hello 解释为 independent；schemaVersion 保持 2，拒绝不认识的模式。

```ts
expect(workspaceCommandSchema.parse({ schemaVersion: 2, type: "hello", sessionId: "s" }).conversationMode).toBeUndefined();
expect(workspaceCommandSchema.safeParse({ schemaVersion: 2, type: "hello", sessionId: "s", conversationMode: "auto-answer" }).success).toBe(false);
```

- [ ] 新纯函数按以下契约实现，并用当前 `explicitVoiceAction` 保留严格的显式求助，不把所有开放问法升级为 hint：

```ts
import { explicitVoiceAction } from "./teaching-policy.js";
export type ConversationMode = "independent" | "dialogue";
export function conversationAction(mode: ConversationMode, transcript: string) {
  const phrase = transcript.replace(/[\s，。！？、,.!?]/gu, "");
  if (/^(暂停|停一下|等一下|我想休息|我先想一想|我想自己想一想|不要给我提示)$/u.test(phrase)) return "pause" as const;
  const explicit = explicitVoiceAction(transcript);
  if (explicit !== "uncertain") return explicit;
  return mode === "dialogue" && phrase ? "review" as const : "uncertain" as const;
}
```

```ts
expect(conversationAction("dialogue", "这里的每米是什么意思？")).toBe("review");
expect(conversationAction("dialogue", "我觉得是7.2，因为我先算24乘3。")).toBe("review");
expect(conversationAction("dialogue", "不要给我提示。")).toBe("pause");
expect(conversationAction("independent", "我觉得是7.2。")).toBe("uncertain");
```

这是回应权限选择，不是判断内容正确。明确否定与暂停直接停止本轮，不能被后续默认 review 覆盖。其余含糊表达只允许老师核对含义，不能凭一个“不会”子串自动给解法。

- [ ] 宿主 hello 载入作品后，把模式绑定当前 problemId/statement.revision，仅保存在连接内。题目/版本不匹配、退出、明确暂停、连接中断必须失效。打断或纠正只取消旧回复，不撤销当前题的对话模式。`voiceEnd` 使用 `conversationAction` 选择 action；遇 pause 则取消生成、发送 `paused`，客户端关闭收音并回到独立模式。
- [ ] Swift `WorkspaceClient.connect(host:microphone:)` 增加明确模式参数并发送 hello：用户点击“和老师聊”传 dialogue；恢复作品/自动发现绝不调用 connect。`paused` 入站走 `pause()`，不自动重连开麦。
- [ ] 对话模式中非空普通表达通过现有 review→evidence→authorize 路径自动回应；仍绑定当前画布快照与题意版本。保留 authorize 的 evidence 约束，不把客户端的 review 当成绕过宿主校验的许可。未确认题意不能教学；无法采集快照则显示具体错误并保留作品，不偷偷授予 hint。
- [ ] 修改 `expressionFirstGuidance`：一处简短回应，最多一个问题或一步提示；已回答的问题不机械重复；缺少依据先问清。普通 review 不能给最终答案；不以孩子未画图判定不会，不输出根因/掌握结论。保留 `OneAnswerFollowup` 作为旧 independent 路径回归，不能让它限制 dialogue 只能续接一轮。
- [ ] 真实路由替身测试连续五轮开放表达，确认同一 session、五次可回应、无重复作品写入；纠正时旧回答被标 contested、迟到结果丢弃。用现有线段辅助图用例回归，不改其同意与原稿隔离机制。

**通过：** 一次开启后开放提问和回答都能交流，不依赖“看看我的想法”等固定口令；不把持续对话授权扩展为长期记录或自动提示升级。

## 6. T3：修复停顿、打断和回合反馈

**修改：** `TutorTurnDetector.swift`、`TutorAudioIO.swift`、`WorkspaceClient.swift`。
**测试：** `TutorTurnDetectorTests.swift`、`TutorAudioTests.swift`、`WorkspaceVoiceTests.swift`、`WorkspaceClientTests.swift`。

- [ ] 把 1.2 秒端点阈值改成可注入的 `silenceBytes`，保持 16kHz/PCM16 的明确单位。默认使用 2 秒（64000 bytes），前滚/最短发声/最长 30 秒边界保持；先测试 1.2 秒思考停顿不会切断，而 2 秒停顿会结束。

```swift
private let silenceBytes: Int
init(silenceBytes: Int = 64_000) { self.silenceBytes = silenceBytes }
// append 内以 quietBytes >= silenceBytes 判断结束；重置不能丢掉配置。
// 原 self = Self() 改为 self = Self(silenceBytes: silenceBytes)。
```

- [ ] 用合成 PCM 测试前滚、短噪声、1.2 秒内部停顿、结束静音、30 秒上限和 reset 保留参数。不得称 RMS 检测器为语义 VAD，也不声称能区分电视人声。
- [ ] 启用对话一次后继续采用实际播放 drain→400ms 保护→重新听音。处理/播放不要求重新点击；音频失败与网络失败分开显示。进入后台或明确暂停后不得 rearm。
- [ ] 常驻“打断”立即停止本地播放，再沿现有 interrupt/cancel 路径取消上游；迟到片段不得恢复播放。按钮结束后界面明确提供继续听音，而不是更换题目或丢原稿。
- [ ] 固定显示“我在听 / 正在想 / 老师在说 / 已暂停 / 主机未连接”，不把静音当网络故障。老师说话期间说明点打断即可说话，不承诺语音直接打断。
- [ ] 同一真实 iPad 测普通音量、孩子式内部停顿、连续五轮与按钮打断；标明声学输入来自真人或外放合成音频。若默认 2 秒使延迟超过门槛，先测分段耗时，再针对最慢边界优化，不直接调回切断思考的阈值。

**通过：** 停顿与麦克风状态一致；任何暂停/取消/后台切换都不会重新开麦或播放上一轮。

## 7. T4：补齐当前主路径的用量与端到端时间

**修改：** `workspace-voice-provider.ts`、`workspace-voice-route.ts`、`WorkspaceClient.swift`、`TutorAudioIO.swift`；新增 `workspace-usage.ts`。
**测试：** `workspace-voice-provider.test.ts`、`workspace-usage.test.ts`、`workspace-voice-route.test.ts`。

- [ ] 在现有假 WebSocket 的 `response.done` 夹具加入真实结构的合成 usage；先断言 provider 发出一次用量记录，重复 done 不重复计数，缺失 usage 不是 0。新增纯函数按以下最小契约归一化：

```ts
export interface UsageRecord {
  sessionId: string; turnId: string; callId: string; responseId?: string;
  purpose: "transcription" | "teaching";
  model: string; status: "completed" | "failed" | "cancelled";
  usage: Record<string, unknown> | null;
  estimatedCostCny: number | null;
}
export function completedUsage(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : null;
}
```

```ts
expect(completedUsage(undefined)).toBeNull();
expect(completedUsage({ input_tokens: 42, output_tokens: 21 })).toEqual({ input_tokens: 42, output_tokens: 21 });
```

- [ ] provider 的已有关联 response.done 分支增加完成回调；以 callId+responseId 去重。保留原始 usage 结构，不臆造不存在的音频/图片拆分；转写未返回 usage 时记录 null，失败/重试单列。用量回调不能改变原语音返回类型或让统计失败中断孩子交流。
- [ ] 宿主写入独立元数据 JSONL；只含模型、用途、时间、字节/Token 计数、状态与标识，不存 PCM、照片、密钥、完整转写。缓存命中等字段按实际返回值保留。token-only 累计只用于已知项，不称完整账单；价格缺失或未知 ASR 费用时 `estimatedCostCny=null`，不能显示“免费”。
- [ ] 对话每轮记录客户端最后有声样本时间、端点提交、宿主转写完成、首音频收到、iPad 实际开始播放；用 turnId 关联。检测器仅在 voiced=true 时更新最后有声时间，不能把结束静音计成有声；播放器在第一段 PCM 实际开始播放时报告，不能以收到数据代替。跨机器时钟不直接相减；主发布时延指标使用同一 iPad 的单调时钟。宿主分段用自身单调时钟，作为定位而非端到端替代。
- [ ] 做一轮真实调用，确认供应商 usage、实际模型 ID、当前用途一致；不在儿童界面显示 Token 表，首期由家长交付记录提供已知用量及缺失状态，不新增费用页面或统计 API。重连/重复 done/重放不能重复累计。

**通过：** 我们可以解释这次学习调用了什么、哪些用量已知、哪里在等待；尚不能核实的费用明确列为未知，不假造总成本。

## 8. T5：保存恢复、同一版本整机验收与交付

**修改/测试：** `ProblemCaptureModel.swift`、`WorkspaceCache.swift`、`HostDiscovery.swift` 仅修复验收暴露的问题；`WorkspaceCacheTests.swift`、`WorkspaceResumeTests.swift`、`HostDiscoveryTests.swift`、`LearningWorkspaceUITests.swift`；后端 `workspace-store.test.ts`、`workspace-voice-route.test.ts`、`workspace-natural-loop.test.ts`。

- [ ] 先补真实故障测试：写画后主机不可达、退出重开本地草稿仍在、恢复联网后 eventId 幂等重放、版本冲突返回后两份稿都保留、离线撤销不复活旧教师提示。复用既有机制，不建设多设备同步平台。
- [ ] 客户端明确区分“已保存到本机 / 等待同步 / 已保存到学习主机 / 发现冲突”。服务端回执前不能显示已同步；网络失败不清空缓存。冲突时保留本地及主机版本，交由家长核对，禁止静默覆盖。
- [ ] source manifest 只枚举明确源码目录、配置模板与锁文件并计算 SHA-256，记录 Git HEAD 和 dirty 标记；必须排除 `.env*`（仅 `.env.ai.example` 模板例外）、auth 文件、Keychain、工作区数据、证据中的个人内容、缓存/node_modules/构建产物。记录构建产物自己的 SHA-256，但不把产物作为源码。
- [ ] 新增 `tools/phase1-release-manifest.mjs`，用 `node:fs` / `node:crypto` 实现上述白名单遍历与确定性排序；在 `apps/agent-host/test/phase1-release-manifest.test.ts` 为两次无改动生成相同源码摘要、源码变更摘要变化、模拟 secret 文件不会被枚举写测试。manifest 至少符合下方字段契约，值由运行时读取或计算，不手填测试结论：

```ts
interface ReleaseManifest {
  stage: "v1-stage-1";
  sourceHead: string; // git rev-parse HEAD 的实际结果
  dirty: boolean;
  sourceFingerprint: string; // 白名单源码路径与文件 SHA-256 的总摘要
  hostPort: 8791;
  appBundleId: "com.houbin.aischolar.pad";
  model: string; // 本次部署实际配置，不包含凭据
  limitations: ["half-duplex"];
}
```

- [ ] mini 有 Xcode 则在 mini 构建；只有笔记本有开发工具时，仅同步经过校验的构建源码快照到新的隔离目录构建，不在笔记本并行编辑或覆盖旧工作区。使用现有签名 Team，设备由 `xcrun devicectl list devices` 实时选择，不能硬编码历史 UDID。
- [ ] 运行下列相关测试。目标结果 0 失败、未因环境缺失跳过必需用例；设备锁屏/签名/钥匙串问题单列，不反复靠重装猜测。

```sh
pnpm --filter @ai-scholar/session-contracts test test/workspace-learning.test.ts
pnpm --filter @ai-scholar/agent-host test test/conversation-policy.test.ts test/workspace-usage.test.ts test/workspace-voice-provider.test.ts test/workspace-voice-route.test.ts test/workspace-natural-loop.test.ts test/workspace-store.test.ts test/host-discovery.test.ts test/phase1-release-manifest.test.ts
pnpm --filter @ai-scholar/agent-host typecheck
cd apps/ipad/ScholarPad
xcodegen generate
```

在同一 shell 设置 `AI_DTL_TEST_DEVICE` 为实时确认的测试 iPad ID，再运行：

```sh
xcodebuild -project ScholarPad.xcodeproj -scheme ScholarPad -destination "platform=iOS,id=$AI_DTL_TEST_DEVICE" -destination-timeout 30 -derivedDataPath /tmp/ai-dtl-v1-stage1 -only-testing:ScholarPadTests/WorkspaceClientTests -only-testing:ScholarPadTests/WorkspaceVoiceTests -only-testing:ScholarPadTests/TutorTurnDetectorTests -only-testing:ScholarPadTests/TutorAudioTests -only-testing:ScholarPadTests/WorkspaceCacheTests -only-testing:ScholarPadTests/WorkspaceResumeTests -only-testing:ScholarPadTests/HostDiscoveryTests test
```

- [ ] 安装这一构建后，执行 §9 的整机流程，结束时启动普通 App，撤除测试注入；关闭测试夹具服务，保留 mini 正式宿主，不停止 Hermes。
- [ ] 仅暂存本任务明确文件及已核实的直接关联改动；不 `git add .`、不把全部既有变更强行合并。发布记录源码指纹，提交/推送遵守现有授权及 remote：本仓库已知为私有 GitHub，不凭“GitLab”约定擅自新增 remote。不合并 main、不公开发布。无明确推送授权时先保留本地交付与清单。
- [ ] 收工重跑 `twin-status --no-fetch`；仍失败人工核对并记录。不能凭 HEAD 相同声称未提交源文件也一致。

## 9. 整机剧本：不能拼接独立探针冒充通过

采用一张合成纸面题：“每米彩带 2.4 元，买 0.3 米多少钱？请说明理由。”不使用家庭私人题图。全程同一 iPad App 构建、同一 mini、同一 workspace。

1. 普通启动，自动发现 mini；拍照核对数字、单位和问题，修改一次候选题意再确认。
2. 先不开麦，在画布四区域写画；横竖屏切换，原稿不变。
3. 点击一次“和老师聊”。五轮输入：“每米是什么意思？”→“我先按24乘3算，得到72。”→“我觉得应该比2.4小，你怎么看？”→“我刚才没听懂，你换个说法。”→“你理解错了，我说的是0.3米。”
4. 老师逐轮回应当前表达，不重复连接；不自动给最终答案。至少一次答复中点击打断，立即停声，然后继续一轮交流。
5. 明确说“我先想一想”，回到独立状态；继续画一笔。短时使本测试连接不可达，验证本机保存；恢复后补同步，原稿未被旧服务器副本覆盖。
6. 退出 App，再打开同一作品，原图、题意、笔迹存在，不开麦、不补播；用户选择继续交流后才收音。
7. 导出每轮标识、取消记录、完成/未知用量、原稿摘要和首音频时间；补足 20 轮测时延。不能让真实模型每轮精确说固定文本，只验语义约束和必要行为。

工程声学测试可用外部扬声器播放合成句子，由 iPad 真实麦克风收音，并验证 iPad 扬声器实际有老师语音；纯 PCM 注入单列。真实 Apple Pencil 和孩子实际使用分别列待验/通过事实，不能把手指自动拖动或成人/合成表达写成孩子掌握。

## 10. 唯一交付清单与后续入口

实施结束创建 `docs/handoffs/2026-10-07-ai-dtl-v1-stage-1-results.md`；证据放 `docs/handoffs/evidence/2026-10-07-ai-dtl-v1-stage-1/`，使用实际运行时间区分批次。

记录 A1–A8 的实际状态、源码/构建指纹、mini 服务标签、数据目录、App 安装、测试命令与原始日志、时延分布与失败率、已知/未知用量、已知限制、未完成项。表项仅允许“通过 / 未通过 / 未执行”，不使用“基本完成”代替证据。

版本回退：保留上次可安装 App、宿主源码快照及部署配置；回退前先备份当前家庭数据，不覆盖数据目录、不用旧数据副本倒灌；本阶段不做存储迁移。一次测试结束必须恢复正式宿主与普通 App 状态。

本阶段八项完成后停止功能扩展，进入短期真实孩子试用。记录他能否独立开始、是否反复卡在交互、是否能解释与检验；此时再决定第二阶段最值得做的教学改进。Hermes、长期成长与全双工只有在实际问题证明必要时，另写小计划接入。
