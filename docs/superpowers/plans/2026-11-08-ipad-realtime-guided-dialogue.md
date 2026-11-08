# iPad 端实时引导对话 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 孩子求助/提问后 2–4 秒听到老师，教学决策、把关、播放都在 iPad 上闭环，mini 只做数据后端。

**Architecture:** iPad 直连千问实时模型，一次调用拿到转写、话语类型和老师的语音+文字；声音先缓冲，用打包成 JS、在 JavaScriptCore 里跑的现有门禁把关，通过才播，不通过走慢路径（同一 JS 包里的重写 + 复核 + 合成，网络由 Swift 注入）。每轮结果后台推送到 mini，离线排队。v16 路径保留为开关回退。

**Tech Stack:** Swift/SwiftUI、JavaScriptCore、URLSessionWebSocketTask、Keychain；TypeScript、esbuild（经 tsx 依赖）、vitest、Fastify；千问 `qwen3.8-omni-flash-realtime`（实时）与 `qwen3.8-omni-flash`（慢路径文字）。

**Spec:** `docs/superpowers/specs/2026-11-08-ipad-realtime-guided-dialogue-design.md`

## Global Constraints

- JS 门禁包与所有日志、同步数据**不含密钥、不含原始录音**；录音用完即丢。
- 规则源码只有一份：`apps/agent-host/src/ai/workspace-teaching-decision.ts` 及其依赖；两端打包清单记录源文件哈希。
- 主机测试命令 `cd apps/agent-host && npx vitest run`；iPad 单元测试在模拟器 `B6F3EE05-7E7E-422E-A40E-43725F2DB975` 上 `xcodebuild test -scheme ScholarPad -only-testing:ScholarPadTests`；改 `project.yml` 后先 `xcodegen generate`。
- 真机安装用 `tools/install-ipad-company-signed.sh`（`CONFIG=Debug` 装调试版）；部署 mini 每次都要用户明确同意；家庭数据 `workspaces-v2` 必须保持不变。
- 数值（来自设计稿）：说完判定 1 秒安静；空闲关闭连接 90 秒；每 8–10 轮换会话；老师主动开口：停顿 40 秒且有新笔迹、间隔 ≥ 2 分钟、一题 ≤ 3 次；连接等待兜底 5 秒。
- 中文注释，提交信息中文，不 `git add .`。

## Review Focus

1. 模型把开头 JSON 拆成多段文字增量、或包在 ```json 围栏里——必须仍能解析，而不是把 `{"transcript"` 念给孩子（Task 3）。
2. 孩子一开口连接还没好、随后连接彻底失败——缓冲的录音必须丢弃、不落盘，孩子听到预录"没听清"，App 不崩（Task 4、7）。
3. 老师有声音但文字为空或只有 JSON 头——按格式错误处理：只应一声，不播那段声音（Task 7）。
4. 同步批次推到一半 App 被杀、重启后重推——mini 只记一次（Task 10、11）。
5. 换会话（第 8–10 轮或空闲）恰好发生在一轮进行中——进行中的那轮不能丢、不能被新会话覆盖（Task 8）。

---

## 文件结构

**主机 / 共享 TS**
- 新建 `apps/agent-host/src/ai/teaching-gates-entry.ts`：JS 包的唯一入口，纯函数 + 可注入网络的慢路径。
- 新建 `tools/build-teaching-gates-bundle.mjs`：产出 `apps/ipad/ScholarPad/ScholarPad/Session/Gates/teaching-gates.js` 与 `.manifest.json`。
- 新建 `apps/agent-host/test/fixtures/teaching-gates-samples.json`：两端共用的"应拦/不应拦"样例。
- 新建 `apps/agent-host/src/ai/workspace-sync-route.ts`：mini 接收 iPad 批次；`workspace-store.ts` 加批次台账。
- 新建 `apps/agent-host/src/ai/workspace-credential-route.ts` + `tools/allow-ipad-key-handout.sh`：一次性口令下发密钥。
- 新建 `apps/agent-host/scripts/measure-realtime-connect.ts`、`scripts/report-latency-comparison.ts`。

**iPad（新目录 `ScholarPad/Session/Realtime/`）**
- `TurnHeader.swift`：解析开头 JSON，`TurnKind`。
- `TeachingGates.swift`：JavaScriptCore 封装。
- `RealtimeSession.swift`：千问实时连接（预热、缓冲、分帧、取消、重建）。
- `SlowPath.swift`：调用 JS 慢路径，Swift 提供 `requestText` 与合成。
- `TutorConductor.swift`：一轮对话的状态机（混合节奏）。
- `SessionLifecycle.swift`：空闲关闭、开口重建、按轮换会话。
- `ProactivePrompter.swift`：老师主动开口与限频。
- `SyncOutbox.swift`：持久化同步队列。
- `RealtimeKeyStore.swift`：钥匙串 + 从 mini 领取。
- 修改 `WorkspaceClient.swift`（只加开关分流）、`LearningWorkspaceView.swift`、`WorkspaceParentSettingsView.swift`、`TutorAudioIO.swift`（暴露逐帧回调）。

---

### Task 1: 实测连接耗时与空闲超时（一次性探针）

**Files:**
- Create: `apps/agent-host/scripts/measure-realtime-connect.ts`
- Create: `docs/handoffs/2026-11-08-realtime-connect-measurements.md`

**Interfaces:**
- Produces: 文档中的两个数 `connectReadyMs`（p50/p90，各 10 次）与 `idleTimeoutSec`，供 Task 8 的默认值核对（设计稿预设 90 秒空闲关闭；若实测云端超时 < 90 秒，Task 8 用实测值减 10 秒）。

- [x] **Step 1: 写探针脚本**：用 `WorkspaceVoiceProvider` 同样的握手（`session.created` → `session.update` → `session.updated`），用 `performance.now()` 记 10 次从 `new WebSocket` 到 `session.updated` 的毫秒；然后建一条连接不发任何音频，每 15 秒记一次 `readyState`，直到收到 close，记录秒数（上限 10 分钟）。
- [x] **Step 2: 在本机运行**：`node --env-file=.env.ai.local --import tsx apps/agent-host/scripts/measure-realtime-connect.ts`。预期打印 JSON `{connectReadyMs:{p50,p90,samples:[…]}, idleTimeoutSec}`。
- [ ] **Step 3: 在 mini 上再跑一次**（家里网络），两组结果写入文档。
- [x] **Step 4: Commit** `git add apps/agent-host/scripts/measure-realtime-connect.ts docs/handoffs/2026-11-08-realtime-connect-measurements.md`

### Task 2: 纯规则入口与 JS 包

**Files:**
- Create: `apps/agent-host/src/ai/teaching-gates-entry.ts`
- Modify: `apps/agent-host/src/ai/workspace-teaching-decision.ts`（`speakDecision` 的 `Buffer` 改 `Uint8Array`；`QwenTeachingDecisionProvider` 已接受注入的 `requestText`，不改）
- Create: `tools/build-teaching-gates-bundle.mjs`
- Create: `apps/agent-host/test/fixtures/teaching-gates-samples.json`
- Test: `apps/agent-host/test/teaching-gates-bundle.test.ts`

**Interfaces:**
- Produces（全局对象 `TeachingGates`，所有参数与返回值都是 JSON 字符串，方便 JavaScriptCore 传递）：
  - `checkUtterance(utterance: string, contextJson: string): string` → `{"ok":true,"draft":TeachingDecision}` 或 `{"ok":false,"reason":string,"rewrite"?:string}`。`contextJson` 是 `TeachingInput` 去掉 `image` 后的 JSON，外加 `imageAttached: boolean`、`ocrNumbers: string[]`。快路径只有老师的一句话，所以由入口自己补齐决策骨架：`problemId/problemRevision/turnId/responseId/child` 取自 context，`focus = selectTeachingFocus(最新表达)?.focus ?? "clarify"`，`observation = child`，`evidenceIds = [turnId]`，`resolved = []`，`method = "ordinary"`，`handoff = false`；再 `validateTeachingDecision(draft, input, {softGates:true})`；抛 `questionLimit_onlyOneQuestion` 时返回 `rewrite = keepOneQuestion(...)`。
  - `matchesSpeech(actualText: string, expectedText: string): boolean`（= `matchesTeachingQuestion(mathSpeech(actual), mathSpeech(expected))`）。
  - `buildRealtimeInstructions(contextJson: string): string`：会话级指令，由 `buildDecisionPrompt` 改成语音版（题目、课程边界、教学要求、前几轮要点）。
  - `headerInstructions(): string`：每轮第一次 `response.create`（只要文字）用的指令：只输出一行 `{"transcript":"…","kind":"help|question|idea|selfTalk|finish"}`，不回答。
  - `replyInstructions(kind: string): string`：每轮第二次 `response.create`（文字+音频）用的指令：直接对孩子说话，≤ 90 字，一个问题，不念任何 JSON。
  - 之所以分两次响应：音频模式下模型会把文字念出来，头部 JSON 不能和老师的话在同一个响应里；`idea|selfTalk|finish` 根本不发第二次响应，没有音频成本。
  - `decideSlow(contextJson: string, rejectedReason: string, hooks: {requestText(instructions: string, imageBase64: string|null): Promise<string>; speak(text: string): Promise<{ok: boolean, spoken: string}>}): Promise<string>` → `{"ok":true,"utterance":string}` 或 `{"ok":false,"code":string}`。内部 `new QwenTeachingDecisionProvider(config占位, undefined, requestTextAdapter).decide(input)`，再用 `hooks.speak` 合成并 `matchesSpeech` 核对。
- 样例文件格式：`[{name, draft, context, expect:{ok, reason?}}]`，30 条，从 `test/workspace-teaching-decision.test.ts` 现有用例中抽取（抢答、口诀、多问、断言孩子写的数、重复上问、字数、正常通过各若干）。

- [x] **Step 1: 写样例文件**（30 条）。
- [x] **Step 2: 写失败测试** `teaching-gates-bundle.test.ts`：
  - `test("JS 包在没有 Buffer/require/fetch 的 vm 里对 30 条样例的判断与直接调用一致")`：用 `tools/build-teaching-gates-bundle.mjs` 导出的 `buildTeachingGates(outfile)` 构建到临时目录，`new vm.Script(code).runInNewContext({})`，对每条样例比较 `JSON.parse(ctx.TeachingGates.checkDraft(...))` 与直接 `validateTeachingDecision` 的结果。
  - `test("JS 包不含网络代码与密钥字样")`：断言包内不出现 `"ws"`、`WebSocket(`、`apiKey`、`wss://`。
  - `test("decideSlow 走注入的 requestText，不自己联网")`：hooks 记录调用，返回合法决策 JSON，断言 `ok:true` 且 `requestText` 被调用。
- [x] **Step 3: 运行，确认失败**：`npx vitest run test/teaching-gates-bundle.test.ts`，预期 "Cannot find module teaching-gates-entry"。
- [x] **Step 4: 实现 `teaching-gates-entry.ts`**，并在 `build-teaching-gates-bundle.mjs` 中：esbuild `format:"iife"`, `globalName:"TeachingGates"`, `platform:"neutral"`, `target:"es2020"`，`alias` 把 `./qwen-workspace-session.js`、`./qwen-thinking-text.js`、`ws`、`node:crypto` 指到一个抛 `Error("networkUnavailableInGates")` 的 stub；manifest 写 `sourceHashes` 与 `bundleSha256`。导出 `buildTeachingGates(outfile)` 供测试复用；作为脚本运行时写到 iPad 的 `Session/Gates/`。
- [x] **Step 5: `speakDecision` 改 `Uint8Array`**（`Buffer.alloc(6400)` → `new Uint8Array(6400)`；`chunks: Uint8Array[]`），跑全量 `npx vitest run`，预期 561+3 通过。
- [x] **Step 6: Commit** `git add apps/agent-host/src/ai/teaching-gates-entry.ts apps/agent-host/src/ai/workspace-teaching-decision.ts tools/build-teaching-gates-bundle.mjs apps/agent-host/test/fixtures/teaching-gates-samples.json apps/agent-host/test/teaching-gates-bundle.test.ts`

### Task 3: iPad 侧 TeachingGates（JavaScriptCore）与头部解析

**Files:**
- Create: `ScholarPad/Session/Realtime/TeachingGates.swift`、`ScholarPad/Session/Realtime/TurnHeader.swift`
- Create: `ScholarPad/Session/Gates/teaching-gates.js`（由 Task 2 工具生成并提交；`project.yml` 的 `ScholarPad` 源目录会把 `.js` 当资源打包）
- Modify: `project.yml`（`ScholarPadTests` 的 resources 加 `../../agent-host/test/fixtures/teaching-gates-samples.json`）
- Test: `ScholarPadTests/TeachingGatesTests.swift`、`ScholarPadTests/TurnHeaderTests.swift`

**Interfaces:**
- `enum TurnKind: String { case help, question, idea, selfTalk, finish }`
- `struct TurnHeader: Equatable { let transcript: String; let kind: TurnKind }`
- `struct TurnHeaderParser { mutating func feed(_ delta: String) -> TurnHeader?; var trailing: String }`：增量喂入头部响应的文字；首个完整 JSON 对象解析成功后返回 header，多余文字进 `trailing`（只记日志，不播）。容忍前导空白与 ```json 围栏。
- `final class TeachingGates { init() throws; func check(utterance: String, context: GateContext) throws -> GateVerdict; func matchesSpeech(_ actual: String, _ expected: String) -> Bool; func realtimeInstructions(_ context: GateContext) -> String; func headerInstructions() -> String; func replyInstructions(kind: TurnKind) -> String }`
- `struct GateVerdict: Equatable { let ok: Bool; let reason: String?; let rewrite: String?; let draftJSON: String? }`（`draftJSON` 通过时带回，供 Task 11 同步决策历史）
- `struct GateContext: Encodable`：与 Task 2 `contextJson` 字段一致（`record`, `turnId`, `responseId`, `permission`, `child`, `history`, `imageAttached`, `ocrNumbers: [String]`）。

- [x] **Step 1: 写失败测试** `TurnHeaderTests`：`testParsesHeaderSplitAcrossDeltas`（`{"transcr` + `ipt":"帮我","kind":"help"}` → header(帮我, .help)）、`testStripsJsonFence`、`testTrailingTextIsKeptOutOfHeader`、`testMalformedHeaderReturnsNil`、`testUnknownKindReturnsNil`。
- [x] **Step 2: 写失败测试** `TeachingGatesTests`：`testVerdictsMatchSharedSamples`（读 `teaching-gates-samples.json`，逐条 `check`，与 `expect` 比较）、`testMatchesSpeechTreatsChineseDigitsEqual`（"七点七" vs "7.7" → true）。
- [x] **Step 3: 运行确认编译失败**（类型不存在）。
- [x] **Step 4: 实现两个文件**；`TeachingGates.init` 从 `Bundle.main.url(forResource:"teaching-gates", withExtension:"js")` 加载到 `JSContext`，`exceptionHandler` 转成 Swift 错误。
- [x] **Step 5: 运行测试通过**：`-only-testing:ScholarPadTests/TeachingGatesTests -only-testing:ScholarPadTests/TurnHeaderTests`。
- [x] **Step 6: Commit**

### Task 4: RealtimeSession（预热、边说边传、取消、重建）

**Files:**
- Create: `ScholarPad/Session/Realtime/RealtimeSession.swift`
- Modify: `ScholarPad/Session/TutorAudioIO.swift`（加 `var onFrame: ((Data) -> Void)?`，在 tap 里每个 16k Int16 帧都回调；现有 `onTurn` 不变）
- Test: `ScholarPadTests/RealtimeSessionTests.swift`（复用 `WorkspaceTestTransport`）

**Interfaces:**
- `enum RealtimeState { case idle, connecting, ready, closed(reason: String) }`
- `final class RealtimeSession { init(url: URL, apiKey: String, transportFactory: (URLRequest) -> any WorkspaceTransport = …); var state: RealtimeState; func prewarm(instructions: String) async; func beginTurn(); func appendAudio(_ pcm16k: Data); func attachImage(_ jpeg: Data); func commitTurn() async throws; func requestHeader(instructions: String) async throws; func requestReply(instructions: String) async throws; func cancelResponse(); func close(); var onTextDelta: ((String) -> Void)?; var onAudioDelta: ((Data) -> Void)?; var onResponseDone: ((RealtimeUsage) -> Void)?; var onClosed: ((String) -> Void)? }`
- `struct RealtimeUsage: Equatable { let inputTokens: Int; let outputTokens: Int; let totalTokens: Int }`
- 协议细节沿用 `workspace-voice-provider.ts`：`session.update{modalities:["text","audio"], voice:"Tina", turn_detection:null, audio:{input pcm 16000, output pcm 24000}, instructions}`；`input_audio_buffer.append{audio:base64}`、`input_image_buffer.append{image}`、`input_audio_buffer.commit`、`response.create{response:{modalities:["text"],instructions}}`（头部）与 `response.create{response:{modalities:["text","audio"],instructions}}`（回答）、`response.cancel`；入站 `response.text.delta|response.audio_transcript.delta`、`response.audio.delta`、`response.done`。
- 行为：`appendAudio` 在 `connecting` 时缓存在内存队列（最多 60 秒音频，超出丢最旧并记日志），`ready` 后按入队顺序补发；`commitTurn` 等待缓存清空后再发 commit；`close()` 清空缓存（不落盘）。

- [x] **Step 1: 写失败测试**：`testAudioSentBeforeReadyIsFlushedInOrderAfterSessionUpdated`、`testCommitWaitsUntilBufferedFramesFlushed`、`testHeaderRequestIsTextOnlyAndReplyRequestHasAudio`、`testCancelSendsResponseCancelAndDropsLaterAudioOfThatResponse`、`testCloseDiscardsBufferedAudioAndReportsReason`、`testPrewarmTwiceReusesReadyConnection`。
- [x] **Step 2: 运行确认失败。**
- [x] **Step 3: 实现 `RealtimeSession`**；`URLRequest` 头 `Authorization: Bearer <apiKey>`（密钥只在内存）。
- [x] **Step 4: 测试通过；Commit。**

### Task 5: TutorConductor 快路径（混合节奏）

**Files:**
- Create: `ScholarPad/Session/Realtime/TutorConductor.swift`
- Test: `ScholarPadTests/TutorConductorTests.swift`（假 `RealtimeSession` 协议、假音频、真 `TeachingGates`）

**Interfaces:**
- `protocol RealtimeSessionProtocol`（抽 Task 4 的公开方法，供假实现）。
- `protocol TutorAudioPlaying { func beginResponse(); func play(_ data: Data) throws; func completeResponse(); func stopPlayback(); func say(_ text: String); var outputMuted: Bool { get } }`（`TutorAudioIO` 遵循）。
- `final class TutorConductor: ObservableObject { init(session: RealtimeSessionProtocol, gates: TeachingGates, audio: TutorAudioPlaying, context: () -> GateContext, clock: () -> Date = Date.init); @Published var phase: VoiceStateBar.Phase; @Published var status: String; @Published var messages: [WorkspaceClient.Message]; func childStartedSpeaking(); func childAudio(_ pcm: Data); func childFinishedSpeaking(); var onTurnRecorded: ((TurnRecord) -> Void)? }`
- `struct TurnRecord: Codable { turnId, transcript, kind, utterance: String?, played: Bool, path: "fast"|"slow"|"none", gateReason: String?, latencyMs: Int, usage: RealtimeUsage?, startedAt: Date }`
- 快路径规则：`childFinishedSpeaking` → `commitTurn` → `requestHeader(gates.headerInstructions())`；header 到达后：`idea|selfTalk` → 不发第二次响应，`audio.say(应答)` 轮换四句（复用 `WorkspaceClient.acknowledgements`），记录 `path:"none"`；`finish` → 记录并由上层结束对话；`help|question` → 若 `context().inkChanged` 则先 `attachImage(context().canvasJPEG)`，再 `requestReply(gates.replyInstructions(kind:))`，`audio.say` 一句应答的同时缓冲 `onAudioDelta` 与文字，`onResponseDone` 后 `gates.check(utterance: 文字)`；`ok` → `beginResponse/play.../completeResponse`，`played:true`；否则交给 Task 7 的慢路径回调 `onNeedsSlowPath(utterance, reason)`。头部响应的文字永远不进播放，也不进 `messages`。
- `GateContext` 增加 `inkChanged: Bool` 与 `canvasJPEG: Data?`（照片只在有新笔迹时附，设计稿 4.3）。

- [x] **Step 1: 写失败测试**：`testSelfTalkSendsNoReplyRequestAndAcknowledgesOnly`、`testHeaderTextIsNeverPlayedOrShown`（Review Focus 1）、`testImageAttachedOnlyWhenInkChanged`、`testHelpBuffersAudioUntilDoneThenPlaysWhenGatePasses`（断言 done 之前 `play` 没被调用，之后调用次数 = 音频增量数）、`testGateRejectionDoesNotPlayAndReportsSlowPathRequest`、`testLatencyMeasuredFromChildFinishedToFirstPlay`、`testAcknowledgementRotates`。
- [x] **Step 2: 运行确认失败。Step 3: 实现。Step 4: 通过并 Commit。**

### Task 6: 慢路径（JS `decideSlow` + Swift 网络）

**Files:**
- Create: `ScholarPad/Session/Realtime/SlowPath.swift`
- Test: `ScholarPadTests/SlowPathTests.swift`

**Interfaces:**
- `final class SlowPath { init(gates: TeachingGates, requestText: @escaping (String, Data?) async throws -> String, speak: @escaping (String) async throws -> (pcm: Data, spoken: String)); func run(context: GateContext, rejectedReason: String) async -> SlowPathResult }`
- `enum SlowPathResult { case spoken(utterance: String, pcm: Data); case failed(code: String) }`
- 默认 `requestText`：HTTPS 到与 `apps/agent-host/src/ai/qwen-thinking-text.ts` 相同的接口与模型（`qwen3.8-omni-flash`，`reasoning_effort: "medium"`），实现者按该文件照搬请求体；默认 `speak`：用一条临时 `RealtimeSession`（文字+音频，指令 `只逐字读这句话：…`）收集音频与朗读文本。
- JS 侧 `hooks` 的 Promise 由 Swift 用 `JSValue` 的 resolve/reject 桥接。

- [x] **Step 1: 写失败测试**：`testRewriteAcceptedWhenGatePassesAndSpeechMatches`（假 requestText 返回合法 JSON，假 speak 返回同文）、`testSpeechNumberMismatchRetriesOnceThenFails`、`testRequestTextErrorYieldsFailedCodeNotCrash`。
- [x] **Step 2–4: 失败 → 实现 → 通过 → Commit。**
- [x] **应用接线**：`WorkspaceClient.makeRealtimeSlowPath` 使用与 `qwen-thinking-text.ts` 相同的 HTTPS 请求，并用临时实时连接朗读。明文地址不发送密钥。取消、超时、数字不一致都不会把旧声音播出来。

### Task 7: Conductor 接慢路径、失败表、打断

**Files:**
- Modify: `TutorConductor.swift`
- Test: `TutorConductorTests.swift`

**Interfaces:**
- `TutorConductor.init` 增加 `slowPath: SlowPath`；新增 `func interrupt()`（孩子在播放中开口：`audio.stopPlayback()`、`session.cancelResponse()`、记录 `interrupted:true` 并把"上一句没说完"放进下一轮 `GateContext.history` 要点）。
- 失败表（设计稿第 6 段）落实为 `status` 文案与 `audio.say` 文案：连接失败/超时 → "刚才没听清，你再说一遍好吗？"；无 header/文字为空但有声音 → 当 `idea`；快慢都失败 → "老师刚才没想好，你再说一遍好吗？"；语音数字不一致 → 丢弃声音走慢路径。

- [x] **Step 1: 写失败测试**：`testGateRejectionRunsSlowPathAndPlaysRewrite`、`testSlowPathFailureSpeaksUnsurePrompt`、`testAudioWithoutHeaderIsTreatedAsIdea`（Review Focus 3）、`testConnectionFailureBeforeReadyDropsBufferedAudioAndSpeaksUnheard`（Review Focus 2，断言没有任何录音被写到磁盘：假音频对象记录写入次数为 0）、`testSpeechMismatchGoesSlowPath`、`testInterruptStopsPlaybackAndMarksTurn`。
- [x] **Step 2–4: 失败 → 实现 → 通过 → Commit。**

### Task 8: 连接生命周期与换会话

**Files:**
- Create: `ScholarPad/Session/Realtime/SessionLifecycle.swift`
- Test: `ScholarPadTests/SessionLifecycleTests.swift`

**Interfaces:**
- `final class SessionLifecycle { init(makeSession: () -> RealtimeSessionProtocol, instructions: () -> String, idleCloseAfter: TimeInterval = 90, rotateEveryTurns: Int = 8, clock: () -> Date); var current: RealtimeSessionProtocol?; func activityObserved(); func speechStarted(); func turnCompleted(); func turnInFlight(_ inFlight: Bool); func appEnteredForeground() }`
- 行为：`speechStarted` 时若 `current == nil` 或 `.closed` → 新建并 `prewarm`；空闲 ≥ `idleCloseAfter` 且 `!inFlight` → `close()`；`turnCompleted` 计数到 `rotateEveryTurns` 且 `!inFlight` → 下一次 `speechStarted` 前后台建新会话（旧会话播完再关）；`inFlight` 期间绝不关闭或替换 `current`（Review Focus 5）。
- 默认 `idleCloseAfter` 若 Task 1 实测云端空闲超时 < 100 秒，则改为实测值 − 10。

- [x] **Step 1: 写失败测试**：`testIdleNinetySecondsCloses`、`testSpeechStartReopensAndPrewarms`、`testRotationAfterEightTurnsCreatesNewSessionBeforeNextSpeech`、`testNoCloseOrRotateWhileTurnInFlight`、`testInstructionsRebuiltWithLatestHighlightsOnRotation`。
- [x] **Step 2–4: 失败 → 实现 → 通过 → Commit。**

### Task 9: 老师主动开口与限频

**Files:**
- Create: `ScholarPad/Session/Realtime/ProactivePrompter.swift`
- Test: `ScholarPadTests/ProactivePrompterTests.swift`

**Interfaces:**
- `final class ProactivePrompter { init(idleAfter: TimeInterval = 40, minInterval: TimeInterval = 120, maxPerProblem: Int = 3, clock: () -> Date); func inkChanged(); func childSpoke(); func newResultNumberSeen(_ number: String); func problemChanged(); var onPrompt: ((ProactiveReason) -> Void)? ; func tick() }`
- `enum ProactiveReason { case idleWithNewInk, newResultNumber(String) }`
- 触发后由 Conductor 走快路径：附照片，`child` 为空，`permission: "review"`，提示词加一句"孩子停下来了，请只就他刚写的一步问一个问题"。

- [x] **Step 1: 写失败测试**：`testIdle40sWithNewInkPrompts`、`testIdleWithoutInkDoesNotPrompt`、`testMinIntervalTwoMinutes`、`testMaxThreePerProblemResetsOnProblemChange`、`testNewResultNumberPromptsOnce`。
- [x] **Step 2–4: 失败 → 实现 → 通过 → Commit。**

### Task 10: mini 接收同步批次（幂等）

**Files:**
- Create: `apps/agent-host/src/ai/workspace-sync-route.ts`
- Modify: `apps/agent-host/src/learning/workspace-store.ts`（加 `async recordSyncBatch(id: string, batchId: string): Promise<boolean>`，台账文件 `<dir>/<id>-sync-batches.jsonl`，已存在返回 false）
- Modify: `apps/agent-host/src/ai/learning-tutor.ts`（注册路由，usage 写同一 `usage.jsonl`）
- Test: `apps/agent-host/test/workspace-sync-route.test.ts`

**Interfaces:**
- `POST /workspace/:id/sync` body `{batchId: string, record: WorkspaceRecord, expectedRevision: number, decisions: TeachingDecision[], turns: TurnRecord[], usage: UsageRecord[]}` → `200 {applied: true, revision}` / `200 {applied: false, duplicate: true}` / `409 {reason:"revisionConflict"}` / `400`。
- 实现：`recordSyncBatch` 为 false → 直接 `duplicate`；否则 `store.save(record, expectedRevision, decision)` 逐条决策（第一条带 record，其余 `expectedRevision` 递增），`turns` 追加到 `<id>-turns.jsonl`，`usage` 追加 `usage.jsonl`。
- `media` 继续走现有 `POST /workspace/:id/media`（按内容哈希去重由 `saveMedia` 现有逻辑负责；若无则本任务加：同哈希返回已有 mediaId）。

- [x] **Step 1: 写失败测试**：`test("同一 batchId 重放只应用一次")`、`test("版本倒退返回 409 且不写入")`、`test("决策与用量落盘且不含录音字段")`（body 带 `pcm` 字段时 400）。
- [x] **Step 2–4: 失败 → 实现 → 通过（全量 vitest）→ Commit。**

### Task 11: iPad SyncOutbox 与接线

**Files:**
- Create: `ScholarPad/Session/Realtime/SyncOutbox.swift`
- Modify: `TutorConductor.swift`（`onTurnRecorded` → outbox）、`ProblemCaptureModel.swift`（记录保存后入队）
- Test: `ScholarPadTests/SyncOutboxTests.swift`

**Interfaces:**
- `final class SyncOutbox { init(directory: URL, request: @escaping (String, String, Data) async throws -> (Int, Data)); func enqueue(_ batch: SyncBatch); func flush(host: String) async; var pendingCount: Int }`
- `struct SyncBatch: Codable { let batchId: String; let sessionId: String; let record: WorkspaceRecord; let expectedRevision: Int; let decisions: [TeachingDecisionRecord]; let turns: [TurnRecord]; let usage: [UsageEntry] }`
- 持久化：每批一个文件 `<directory>/<sessionId>/<seq>-<batchId>.json`，成功（200）或 `duplicate` 后删除；`409` 停止该会话队列并标记 `conflict`，由现有冲突 UI 处理；其他错误保留、下次 `flush` 重试，按文件名序。
- `usage` 记录字段与 `workspace-usage.ts` 的 `UsageRecord` 一致，`model` 填 `qwen3.8-omni-flash-realtime`，额外 `latencyMs`、`path`。

- [x] **Step 1: 写失败测试**：`testBatchesPersistAcrossRelaunchAndFlushInOrder`、`testDuplicateResponseRemovesBatch`（Review Focus 4）、`testConflictStopsSessionQueue`、`testNetworkErrorKeepsBatch`、`testNoRecordingBytesInBatchJSON`。
- [x] **Step 2–4: 失败 → 实现 → 通过 → Commit。**

### Task 12: 密钥领取与家长设置开关

**Files:**
- Create: `ScholarPad/Session/Realtime/RealtimeKeyStore.swift`
- Create: `apps/agent-host/src/ai/workspace-credential-route.ts`、`tools/allow-ipad-key-handout.sh`
- Modify: `WorkspaceParentSettingsView.swift`（"实时模式（试用）"开关 `UserDefaults "realtimeMode"`；"从主机领取密钥"输入 6 位口令）
- Test: `ScholarPadTests/RealtimeKeyStoreTests.swift`、`apps/agent-host/test/workspace-credential-route.test.ts`

**Interfaces:**
- mini：`tools/allow-ipad-key-handout.sh` 生成 6 位数字口令写入 `<AppSupport>/key-handout.json {code, expiresAt: now+10min}` 并打印；`POST /workspace/credentials/realtime {code}` → 口令匹配且未过期 → `200 {apiKey, url}` 并删除文件；否则 `403`。只监听局域网（沿用现有 host）。
- iPad：`struct RealtimeKeyStore { static func load() -> (url: URL, apiKey: String)?; static func save(url: URL, apiKey: String) throws; static func clear(); static func fetch(host: String, code: String) async throws -> Void }`，钥匙串 `kSecAttrService = "com.houbin.aischolar.pad.realtime"`。

- [x] **Step 1: 写失败测试**：主机 `test("口令正确一次有效，第二次 403")`、`test("过期口令 403")`；iPad `testSaveLoadClearRoundTrip`、`testFetchStoresKeyAndNeverLogsIt`（注入记录器断言日志不含密钥）。
- [x] **Step 2–4: 失败 → 实现 → 通过 → Commit。**

### Task 13: 接入界面（开关分流）

**Files:**
- Modify: `WorkspaceClient.swift`（`connect(...)` 开头：若 `realtimeMode` 且密钥存在，交给 `TutorConductor`，否则原逻辑；对外 `@Published` 不变）
- Modify: `LearningWorkspaceView.swift`（`VoiceStateBar` 数据源改为统一的 `phase/status/messages/micLevel`；"一起聊聊/结束对话/先停一下"按钮同时驱动两种模式）
- Modify: `TutorAudioIO.swift`（遵循 `TutorAudioPlaying`）
- Test: `ScholarPadUITests/RealtimeModeUITests.swift`

**Interfaces:**
- 启动参数 `-realtimeMode YES` 与环境 `AI_DTL_REALTIME_FAKE_URL`（指向测试用本地假实时服务，Task 14 提供）供 UI 测试与真机回归。

- [x] **Step 1: 写 UI 测试** `testRealtimeModeShowsListeningThenSpeakingAndPlaysWithinBudget`：假服务返回 header + 文字 + 音频；断言状态条依次 "正在听你说" → "老师在说话"，`workspaceVoiceStatus` 不含"没听清"。
- [x] **Step 2: 实现分流与接线；Step 3: 全量 iPad 单元测试 + 该 UI 测试通过；Step 4: Commit。**

### Task 14: 真机回归与对比实验

**Files:**
- Create: `apps/agent-host/scripts/serve-fake-realtime.ts`（供 UI 测试：按脚本回放 header/文字/音频）
- Create: `tools/device-realtime-case.sh`（复制 `device-teaching-case.sh`，加 `-realtimeMode YES`；孩子音频仍从 mini 8797 取）
- Create: `apps/agent-host/scripts/report-latency-comparison.ts`（读两份 `usage.jsonl`/`turns.jsonl`，输出：说完到出声中位数、慢路径占比、每轮 token、抢答/口诀命中数）
- Create: `docs/handoffs/2026-11-XX-realtime-vs-v16-comparison.md`

- [x] **Step 1: 写并跑假实时服务与 UI 测试（Task 13 依赖）。**
- [ ] **Step 2: `CONFIG=Debug tools/install-ipad-company-signed.sh`，用 5 类题（`jiayi` 等现有照片与台词）各跑一遍 `tools/device-realtime-case.sh` 与 `tools/device-teaching-case.sh`。**
- [ ] **Step 3: 跑 `report-latency-comparison.ts`，四项门槛：中位数 ≤ 4 秒、抢答/口诀 ≤ v16、慢路径 ≤ 30%、token ≤ v16 的 1/2；结果写入交接文档（含失败样本原话）。**
- [ ] **Step 4: 达标则把 `realtimeMode` 默认改为开（仍可在家长设置关闭），装 Release 到 iPad；未达标则列出要调的提示词/规则，不改默认。**
- [ ] **Step 5: 请家长真机开麦使用一遍并确认节奏；Commit 文档。mini 若需要新路由（Task 10、12）再经用户同意部署 v17。**
