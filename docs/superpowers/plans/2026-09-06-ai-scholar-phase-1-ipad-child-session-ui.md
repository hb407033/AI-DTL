# 阶段 1 iPad 儿童端会话界面（模拟器先行）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出孩子真正面对的那一块屏：单屏画布 + 三个常驻入口 + 说话输入 + Agent 语义层，通过家庭局域网 `ws://` 连到 `apps/agent-host`，在模拟器里用手指代替 Pencil 把 `2.4 × 0.3` 一条主路径走通。

**Architecture:** 新建独立 App 工程 `apps/ipad/ScholarPad`（正式儿童端，与阶段 0 探针 App 分开，不把探针改成产品）。协议类型按 `packages/session-contracts` 的夹具逐字对齐；笔迹层仍是 PencilKit，Agent 语义层是独立 SwiftUI Canvas，只读、不接收触摸；出站事件走幂等队列（id + clientSeq），ack 移除、nack 重放；界面状态由纯函数 reducer 从出站消息推导，便于无界面测试。

**Tech Stack:** Xcode 26.6、Swift 6（语言模式 6.0）、iPadOS 18+、SwiftUI、PencilKit、URLSessionWebSocketTask、AVSpeechSynthesizer（模拟器可发声，作为 Codex 音频未接通前的临时口播）、XcodeGen、XCTest/XCUITest。

> **回写（2026-09-06）**：Task 1–5 全部 ✅。模拟器（iPad Pro 13-inch M5，iOS 26.5）上：单测 17 个通过；UI 冒烟连本机脚本回放宿主通过（拿任务 → 画一笔 → 我卡住了 → 一级提示 → 再画 → 再求助 → 二级提示，15 s）。⚠️ 偏离：`StrokeDiff` 的 strokeId 直接由内容哈希派生（`st-<hash>`），不另生成 UUID，擦除时无需再查表；`SessionViewState.reduce` 在状态切换时顺手清掉过期的软着陆/确认弹层。❌ 未做：Pencil 真机验证（无设备）、语音输入（Codex 门禁 BLOCKED，暂用文字）。

**Spec:** `docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md` v0.4.1 第 8、11.1、11.4 节；`docs/superpowers/plans/2026-09-06-ai-scholar-phase-1-single-challenge-prototype.md` Task 1（协议）与 Task 11（网关）。

## Global Constraints

- 孩子端不显示：聊天历史、JSON、提示级别数字、状态机名、模型内部信息（8.1）。
- Agent 永远拿不到 `PKDrawing` 写权限；语义层只画 `owner == agent` 的对象（8.3、11.1）。
- 常驻入口：“我卡住了”“我想休息”“你理解错了”，任何时候可点（8.1、8.5）；另加“我做完了”。
- 明文 `ws://<host>:8788/session?sessionId=…`，模拟器默认 `localhost`，真机默认 `houbin-mbp.local`（11.4）。
- 高频触控点在客户端聚合成语义笔画再上传：一条 PKStroke 一条 `STROKE` 事件，`contentHash` 由量化后的路径点算出，擦除一条发 `ERASE`（10.2、12）。
- 语音转写尚未接通（Codex 门禁 BLOCKED）：本轮用文字输入代替“说”，`quality` 一律 `confirmed`；接通实时语音后此处替换为转写事件，界面其余部分不变。
- 不做：录音上传、断线恢复到检查点（阶段 2）、家长视图、成长记录。
- 中文注释与 commit；只在工作分支提交；`.xcodeproj` 不入库。

## 文件结构

```text
apps/ipad/ScholarPad/
├── project.yml                                  # 目标 ScholarPad / ScholarPadTests / ScholarPadUITests
├── ScholarPad/
│   ├── App/ScholarPadApp.swift                  # 入口，直接进 ChildSessionView
│   ├── Session/SessionProtocol.swift            # EvidenceEvent/EventPayload/ClientFrame/ServerFrame/ChildOutbound/CanvasAction/SemanticObject
│   ├── Session/EventOutbox.swift                # 幂等出站队列（id、clientSeq、ack 移除、nack 重放）
│   ├── Session/SessionViewState.swift           # 界面状态 + reduce(outbound) 纯函数
│   ├── Session/SessionClient.swift              # WebSocket 客户端：连接/重连/收发/把出站消息喂给 reducer
│   ├── Session/AgentVoice.swift                 # AVSpeechSynthesizer 封装：说、打断
│   ├── Canvas/StrokeDiff.swift                  # 笔画差分：上次哈希集合 vs 本次 → STROKE/ERASE
│   ├── Canvas/ChildCanvasView.swift             # PKCanvasView 包装：drawingDidChange → StrokeDiff → 事件
│   ├── Canvas/AgentLayerView.swift              # 语义层：tenthsBar / numberLine / label / arrow / highlight / areaModel / point
│   └── Session/ChildSessionView.swift           # 单屏：任务一句话、画布、说话输入、四个按钮、确认转写与软着陆弹层
├── ScholarPadTests/
│   ├── SessionProtocolTests.swift               # 夹具往返：15 种事件、2 条提案、7 种出站、两向帧
│   ├── EventOutboxTests.swift
│   ├── StrokeDiffTests.swift
│   └── SessionViewStateTests.swift
└── ScholarPadUITests/
    └── ChildSessionSmokeUITests.swift           # 连本机宿主（scripted）：拖一笔 → 点“我卡住了” → 出现 Agent 的话
```

## Task 1：工程骨架与会话协议类型

- [x] Step 1：写 `SessionProtocolTests`——读 `packages/session-contracts/fixtures/session-protocol-v1.json`（`#filePath` 上溯四级），`events` 全部能解码且 `payload` 类型集合等于 15 种；`outbound` 全部能解码；`clientFrames` 编码后再解码相等；`serverFrames` 能解码为 ack/nack/outbound/error。
- [x] Step 2：`project.yml`（bundle `com.houbin.aischolar.pad`，iOS 18，横屏，`NSAllowsLocalNetworking`，`NSMicrophoneUsageDescription`）、`ScholarPadApp.swift` 占位视图；`xcodegen generate`，确认测试因缺类型而编译失败。
- [x] Step 3：实现 `SessionProtocol.swift`：`EventPayload` 是带关联值的枚举，手写 Codable 按 `type` 分派；`EvidenceEvent` 与 TS 字段同名；`ChildOutbound` 七种；`CanvasAction` 四种；`SemanticObject.props` 用 `[String: JSONValue]`（自写 `JSONValue` 枚举）。
- [x] Step 4：`xcodebuild test -scheme ScholarPad -only-testing:ScholarPadTests/SessionProtocolTests` 通过。
- [x] Step 5：提交「初始化 ScholarPad 儿童端工程与会话协议类型」。

## Task 2：出站队列与笔画差分（纯逻辑）

- [x] Step 1：`EventOutboxTests`：`enqueue(payload)` 得到递增 `clientSeq` 与唯一 id；`acknowledge(id)` 移除；`replayFrom(seq)` 只回序号 ≥ seq 的；`pending` 保序。`StrokeDiffTests`：给定 `known = {h1,h2}`、`current = [h2,h3]` → 事件 `[ERASE h1, STROKE h3]`；重画相同内容（h1 再次出现）仍发 `STROKE h1`（是否算新策略由宿主判断）；`quantizedHash(points)` 对 1 px 内抖动稳定、对明显不同路径不同。
- [x] Step 2：实现 `EventOutbox`（`struct`，`sessionId`、`deviceId`，`enqueue(payload:quality:source:occurredAt:) -> ClientFrame`）与 `StrokeDiff`（`static func diff(known: Set<String>, current: [(hash: String, bounds: CGRect, strokeId: String)]) -> [EventPayload]`、`static func quantizedHash(points: [CGPoint], grid: CGFloat = 2) -> String`，用 SHA-256 前 16 位十六进制）。
- [x] Step 3：单测通过；提交「实现儿童端出站队列与笔画差分」。

## Task 3：界面状态 reducer 与 WebSocket 客户端

- [x] Step 1：`SessionViewStateTests`：`reduce(.stateChanged INDEPENDENT/listening)` → `presence == .listening`、`isPaused == false`；`PAUSED_CHILD/paused` → `isPaused`；`.learnerTask` 覆盖 `taskText`；`.speak` 设置 `agentLine` 并计数 `speakVersion += 1`（供 TTS 触发）；`.canvasAction upsertObject` 加进 `agentObjects`（按 id 去重）、`removeObject` 删除、`highlight` 记入 `highlightedIds`、`point` 设 `pointer`；`.confirmTranscript` 设 `pendingConfirmation`；`.softLanding` 设 `softLanding`；`.notice` 设 `notice`。
- [x] Step 2：实现 `SessionViewState`（`struct`，`static func reduce(_ state: inout SessionViewState, _ message: ChildOutbound)`）。
- [x] Step 3：实现 `SessionClient`（`@MainActor @Observable`）：`host`（模拟器 `localhost`，真机 UserDefaults `padHost` 否则 `houbin-mbp.local`）、`connect()/disconnect()`、退避重连（复用阶段 0 的 100/200/400/800/1000 ms）、`send(_ payload: EventPayload)`（入队 + 发送）、收帧：ack → 出箱确认；nack seqGap → 从 expectedSeq 重放；outbound → `reduce`；error → 计数。`sessionId` 每次启动新建（阶段 2 再做恢复）。
- [x] Step 4：`AgentVoice`：`speak(_ text:)` 先 `stopSpeaking(at: .immediate)` 再朗读（zh-CN），`interrupt()`；孩子任何输入都先打断。
- [x] Step 5：单测通过；提交「实现儿童端会话客户端与界面状态推导」。

## Task 4：儿童会话界面

- [x] Step 1：`ChildCanvasView`（`UIViewRepresentable`）：模拟器 `.anyInput`，真机 `.pencilOnly`；`PKCanvasViewDelegate.canvasViewDrawingDidChange` 里对 `drawing.strokes` 算 `(hash, renderBounds)`，交 `StrokeDiff`，把事件回调给 `onEvents`；`accessibilityIdentifier = "childCanvas"`。
- [x] Step 2：`AgentLayerView`：把 `agentObjects` 按顺序竖排在画布右侧 30% 区域，按 `kind` 画：`tenthsBar`（10 格，`filled` 格上色）、`numberLine`（0–`max` 刻度）、`label`（`text`）、`arrow`、`highlight`（黄色半透明框）、`areaModel`（`a × b` 网格）；未知 kind 画虚线框写 kind；高亮对象加描边；`pointer` 画一个小圆点；`allowsHitTesting(false)`。
- [x] Step 3：`ChildSessionView`：顶部一行任务文字（`taskText`，identifier `taskText`）与呼吸指示灯；中间 `ZStack { ChildCanvasView; AgentLayerView }`；Agent 气泡显示 `agentLine`（identifier `agentLine`）；底部：文字输入框 + “想法/答案”切换 + 发送（EXPLAIN_BACK 状态下发 `EXPLAIN`，选“答案”发 `ANSWER`，否则 `UTTERANCE`）、四个按钮“我卡住了”“我做完了”“我想休息/继续”“你理解错了”；暂停时画布盖半透明层写“休息一下”；`pendingConfirmation` 弹 alert“你是说：…？”（是 → CONFIRM_TRANSCRIPT confirmed，不是 → confirmed=false）；`softLanding` 弹三选项；`notice` 顶部横幅 3 秒。启动时自动 `connect()`；任何孩子输入先 `AgentVoice.interrupt()`；`speakVersion` 变化时朗读 `agentLine`。
- [x] Step 4：`xcodebuild build` 模拟器通过；`xcrun simctl install/launch` 起 App 截图确认单屏布局。
- [x] Step 5：提交「实现儿童端单屏会话界面」。

## Task 5：UI 冒烟与回写

- [x] Step 1：`ChildSessionSmokeUITests`：前置 `pnpm host -- --scripted --script apps/agent-host/fixtures/scripted-happy-path.json` 已运行；启动 App，等待 `taskText` 含“2.4 × 0.3”；在 `childCanvas` 上拖一笔；点“我卡住了”；等待 `agentLine` 等于“你现在已经确定了什么？”。
- [x] Step 2：跑通并记录命令与结果；`pnpm test`、`pnpm typecheck` 不受影响。
- [x] Step 3：回写本计划、设计稿 14.6（0.4.2）、交接文档；提交。
