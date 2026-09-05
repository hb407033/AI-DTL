# AI 学科心智学习系统阶段 0 原生 iPad 门禁实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在正式学习系统编码前，用完整原生 Swift iPad App 验证 PencilKit、实时音频、本地打断、家庭局域网 HTTP/WS、Codex 订阅实时路径和教学闭环。

**Architecture:** iPad 端完全原生，不使用 PWA、WebView、Capacitor 或 React Native；SwiftUI 负责界面，PencilKit 保存儿童笔迹，独立 SwiftUI Canvas 显示 Agent 语义对象，AVAudioEngine 负责录音播放和本地打断，URLSessionWebSocketTask 通过家庭局域网明文 WebSocket 连接 Mac mini。Mac mini 使用 Node.js/TypeScript 承载验证网关和 Codex app-server 探针，所有长期档案与真实家庭结果只保存在本地未跟踪目录。阶段 0 不实现 TLS、配对和会话令牌。

**Tech Stack:** Xcode 26.6、Swift 6.3.3、iPadOS 18+、SwiftUI、PencilKit、AVFoundation、CryptoKit、URLSessionWebSocketTask、XCTest、XcodeGen、Node.js 22、pnpm 11、TypeScript、Fastify、Vitest、Codex CLI 0.144.1。

---

## 0. 固定边界和门禁

- iPad App 是正式技术路线的最小切片，不是网页验证页。
- PencilKit 儿童笔迹层与 Agent 语义层物理分离；Agent 永远不能改写 `PKDrawing`。
- iPad 只保存当前验证会话的临时缓存，不保存 Codex 长期凭据和成长档案。
- 麦克风 PCM 只在内存和实时链路中存在，不进入结果文件。
- Mac mini 的 Codex app-server 只通过 stdio 或回环地址访问。
- iPad 到 Mac mini 使用 `http://` 与 `ws://`；只允许家庭局域网，不开放公网，不实现 TLS、配对和会话令牌。
- 儿童数据与模型侧数据保留暂不作为阶段 0 阻断项，长期档案仍只落 Mac mini 本地。
- Codex 实时验证必须使用 ChatGPT 登录身份；出现 API key 身份即 `BLOCKED`。
- 任一门禁未通过，不进入单挑战机器原型，也不偷偷切换第三方模型或公开 Realtime API。

| 指标 | 通过阈值 |
|---|---:|
| Pencil 触摸事件到下一可提交画面 | P95 ≤ 50 ms |
| 检测到孩子开始说话到本机停止播放 | P95 ≤ 200 ms |
| iPad 事件到 Mac mini 确认 | P95 ≤ 150 ms |
| 松开说话按钮到 iPad 收到首段 Agent 音频 | P50 ≤ 1500 ms，P95 ≤ 3000 ms |
| Mac mini 语义画布动作在 iPad 出现 | P95 ≤ 300 ms |
| 网络恢复到 WebSocket 重新确认 | ≤ 5000 ms |
| Codex 实时会话成功率 | 至少 19/20 |

## 1. 文件结构

```text
.
├── apps/
│   └── ipad/
│       └── ScholarPadProbe/
│           ├── project.yml
│           ├── ScholarPadProbe/
│           │   ├── App/ScholarPadProbeApp.swift
│           │   ├── App/ProbeDashboardView.swift
│           │   ├── Audio/AudioProbeEngine.swift
│           │   ├── Audio/VoiceActivityDetector.swift
│           │   ├── Canvas/PencilLatencyCanvasView.swift
│           │   ├── Canvas/SemanticOverlayView.swift
│           │   ├── Metrics/MetricModels.swift
│           │   ├── Metrics/MetricRecorder.swift
│           │   ├── Network/AudioFrameCodec.swift
│           │   ├── Network/ProbeWebSocket.swift
│           │   └── Resources/Assets.xcassets
│           └── ScholarPadProbeTests/
│               ├── AudioFrameCodecTests.swift
│               ├── MetricRecorderTests.swift
│               ├── ProbeWebSocketTests.swift
│               └── VoiceActivityDetectorTests.swift
├── apps/
│   └── gate-server/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/audio-frame-codec.ts
│       ├── src/codex-relay.ts
│       ├── src/server.ts
│       ├── test/audio-frame-codec.test.ts
│       └── test/probe-protocol.test.ts
├── packages/
│   └── gate-contracts/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/index.ts
│       ├── src/metrics.ts
│       ├── src/schemas.ts
│       └── test/metrics.test.ts
├── tools/
│   ├── codex-realtime-probe/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/app-server-client.ts
│   │   ├── src/live-probe.ts
│   │   ├── src/realtime-contract.ts
│   │   └── test/app-server-client.test.ts
│   └── gate-report/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/evaluate.ts
│       └── test/evaluate.test.ts
├── validation/
│   ├── README.md
│   ├── results/.gitkeep
│   └── wizard-of-oz/
│       ├── session-guide.md
│       └── session-template.json
├── scripts/
│   └── snapshot-codex-schema.sh
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Task 1：初始化仓库与原生 iPad 工程

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `apps/ipad/ScholarPadProbe/project.yml`
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/App/ScholarPadProbeApp.swift`
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/App/ProbeDashboardView.swift`

- [ ] **Step 1：确认并初始化工作分支**

Run:

```bash
pwd
git rev-parse --show-toplevel
git init -b feat/phase-0-native-ipad-gates
git rev-parse --abbrev-ref HEAD
```

Expected: 当前目录为 `/Users/houbin/Documents/Codex/2026-08-29/wo-yo`；初始化前不是其他 Git 仓库；最终分支为 `feat/phase-0-native-ipad-gates`。

- [ ] **Step 2：记录本机工具基线**

Run:

```bash
xcodebuild -version
swift --version
node --version
pnpm --version
```

Expected: Xcode `26.6`、Swift `6.3.3`、Node `22.x`、pnpm `11.x`。若版本不同，记录实际值并先验证项目生成和测试命令，不能假装与计划一致。

- [ ] **Step 3：安装可重复生成 Xcode 工程的工具**

Run:

```bash
brew install xcodegen
xcodegen --version
```

Expected: `xcodegen` 返回版本号。安装只影响开发机，不进入 iPad App。

- [ ] **Step 4：写入 Mac mini 工具工作区**

```json
{
  "name": "ai-scholar-learning-system",
  "private": true,
  "packageManager": "pnpm@11.1.2",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "pnpm -r --if-present typecheck",
    "gate:server": "pnpm --filter @ai-scholar/gate-server start",
    "gate:codex": "pnpm --filter @ai-scholar/codex-realtime-probe start",
    "gate:report": "pnpm --filter @ai-scholar/gate-report start"
  }
}
```

```yaml
packages:
  - apps/gate-server
  - packages/*
  - tools/*
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true
  }
}
```

以上三段分别写入 `package.json`、`pnpm-workspace.yaml` 和 `tsconfig.base.json`。`.gitignore` 必须排除 `node_modules/`、`dist/`、`DerivedData/`、`validation/results/*`、`.superpowers/` 和生成的 Codex schema，同时保留 `validation/results/.gitkeep`。

Run:

```bash
pnpm add -Dw typescript vitest tsx @types/node
```

Expected: 生成 `pnpm-lock.yaml`，命令退出码为 0。

- [ ] **Step 5：写入 iPad-only 工程定义**

```yaml
# apps/ipad/ScholarPadProbe/project.yml
name: ScholarPadProbe
options:
  bundleIdPrefix: com.houbin.aischolar
  deploymentTarget:
    iOS: "18.0"
settings:
  base:
    SWIFT_VERSION: "6.0"
    TARGETED_DEVICE_FAMILY: "2"
    CODE_SIGN_STYLE: Automatic
targets:
  ScholarPadProbe:
    type: application
    platform: iOS
    sources:
      - ScholarPadProbe
    info:
      path: ScholarPadProbe/Info.plist
      properties:
        UILaunchScreen: {}
        NSMicrophoneUsageDescription: "用于孩子与学习 Agent 进行实时语音互动。"
        NSLocalNetworkUsageDescription: "用于连接家中的 Mac mini 学习主机。"
        NSAppTransportSecurity:
          NSAllowsLocalNetworking: true
        UISupportedInterfaceOrientations~ipad:
          - UIInterfaceOrientationLandscapeLeft
          - UIInterfaceOrientationLandscapeRight
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.houbin.aischolar.probe
  ScholarPadProbeTests:
    type: bundle.unit-test
    platform: iOS
    sources:
      - ScholarPadProbeTests
    dependencies:
      - target: ScholarPadProbe
```

- [ ] **Step 6：创建最小 SwiftUI App**

```swift
// ScholarPadProbeApp.swift
import SwiftUI

@main
struct ScholarPadProbeApp: App {
    var body: some Scene {
        WindowGroup {
            ProbeDashboardView()
        }
    }
}
```

```swift
// ProbeDashboardView.swift
import SwiftUI

struct ProbeDashboardView: View {
    var body: some View {
        NavigationStack {
            Text("原生 iPad 门禁")
                .font(.largeTitle.bold())
                .navigationTitle("ScholarPad Probe")
        }
    }
}
```

- [ ] **Step 7：生成并构建模拟器工程**

Run:

```bash
cd apps/ipad/ScholarPadProbe
xcodegen generate
xcodebuild -project ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' build
```

Expected: `** BUILD SUCCEEDED **`。真实 iPad 安装前由用户在 Xcode 中选择自己的 Development Team，不把账号或签名凭据写进仓库。`NSAllowsLocalNetworking` 只用于家庭局域网 `.local` 主机，不设置全局 `NSAllowsArbitraryLoads`。

- [ ] **Step 8：提交工程骨架**

```bash
git add .gitignore package.json pnpm-workspace.yaml tsconfig.base.json apps/ipad docs
git commit -m "初始化原生iPad验证工程"
```

## Task 2：建立跨端门禁指标契约

**Files:**
- Create: `packages/gate-contracts/package.json`
- Create: `packages/gate-contracts/tsconfig.json`
- Create: `packages/gate-contracts/src/index.ts`
- Create: `packages/gate-contracts/src/metrics.ts`
- Create: `packages/gate-contracts/src/schemas.ts`
- Create: `packages/gate-contracts/test/metrics.test.ts`
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/Metrics/MetricModels.swift`
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/Metrics/MetricRecorder.swift`
- Test: `apps/ipad/ScholarPadProbe/ScholarPadProbeTests/MetricRecorderTests.swift`

- [ ] **Step 1：创建 TypeScript 契约包**

先写入包清单、TypeScript 配置和出口文件：

```json
{
  "name": "@ai-scholar/gate-contracts",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```ts
// packages/gate-contracts/src/index.ts
export * from "./metrics.js";
export * from "./schemas.js";
```

Run:

```bash
pnpm --filter @ai-scholar/gate-contracts exec pwd
pnpm add --filter @ai-scholar/gate-contracts zod
```

Expected: 第一条输出以 `/packages/gate-contracts` 结尾，两条命令退出码均为 0；若显示“No projects matched”，先修包清单，不继续安装。

- [ ] **Step 2：先写 Swift 百分位失败测试**

```swift
import XCTest
@testable import ScholarPadProbe

final class MetricRecorderTests: XCTestCase {
    func testNearestRankSummary() throws {
        let samples = (1...20).map { MetricSample(metric: .penRender, elapsedMs: Double($0), success: $0 != 20) }
        let summary = try MetricRecorder.summarize(samples)
        XCTAssertEqual(summary.p50Ms, 10)
        XCTAssertEqual(summary.p95Ms, 19)
        XCTAssertEqual(summary.successCount, 19)
    }

    func testEmptySamplesAreRejected() {
        XCTAssertThrowsError(try MetricRecorder.summarize([]))
    }
}
```

- [ ] **Step 3：运行测试确认失败**

Run:

```bash
xcodebuild -project apps/ipad/ScholarPadProbe/ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
```

Expected: FAIL，提示 `MetricSample` 或 `MetricRecorder` 未定义。

- [ ] **Step 4：实现 Swift 指标模型**

```swift
import Foundation

enum MetricName: String, Codable {
    case penRender = "pen_render_ms"
    case localInterrupt = "local_interrupt_ms"
    case lanAck = "lan_ack_ms"
    case firstAudio = "first_audio_ms"
    case remoteCanvas = "remote_canvas_ms"
    case reconnect = "reconnect_ms"
}

struct MetricSample: Codable, Equatable {
    let metric: MetricName
    let elapsedMs: Double
    let success: Bool
}

struct MetricSummary: Codable, Equatable {
    let count: Int
    let successCount: Int
    let p50Ms: Double
    let p95Ms: Double
    let maxMs: Double
}
```

```swift
import Foundation

enum MetricError: Error { case emptySamples }

enum MetricRecorder {
    static func summarize(_ samples: [MetricSample]) throws -> MetricSummary {
        guard !samples.isEmpty else { throw MetricError.emptySamples }
        let values = samples.map(\.elapsedMs).sorted()
        func nearestRank(_ percentile: Double) -> Double {
            let index = max(0, Int(ceil(percentile * Double(values.count))) - 1)
            return values[index]
        }
        return MetricSummary(
            count: samples.count,
            successCount: samples.filter(\.success).count,
            p50Ms: nearestRank(0.50),
            p95Ms: nearestRank(0.95),
            maxMs: values.last!
        )
    }
}
```

- [ ] **Step 5：在 TypeScript 侧实现相同 nearest-rank 契约**

TypeScript 的 `MetricName` 字面量必须与 Swift raw value 完全一致。Vitest 用同一组 1...20 样本断言 P50=10、P95=19、successCount=19，防止跨端报告算法漂移。

- [ ] **Step 6：运行 Swift 与 TypeScript 测试**

Run:

```bash
xcodebuild -project apps/ipad/ScholarPadProbe/ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
pnpm vitest run packages/gate-contracts/test/metrics.test.ts
```

Expected: 两端测试均通过。

- [ ] **Step 7：提交指标契约**

```bash
git add apps/ipad/ScholarPadProbe packages/gate-contracts package.json pnpm-lock.yaml
git commit -m "建立原生端与服务端门禁指标契约"
```

## Task 3：实现 PencilKit 儿童笔迹层与独立语义层

**Files:**
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/Canvas/PencilLatencyCanvasView.swift`
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/Canvas/SemanticOverlayView.swift`
- Modify: `apps/ipad/ScholarPadProbe/ScholarPadProbe/App/ProbeDashboardView.swift`

- [ ] **Step 1：实现 PencilKit 包装器**

`PencilLatencyCanvasView` 必须包装 `PKCanvasView`，设置：

```swift
canvasView.drawingPolicy = .pencilOnly
canvasView.tool = PKInkingTool(.pen, color: .label, width: 4)
canvasView.backgroundColor = .systemBackground
canvasView.isOpaque = true
```

子类在 `touchesMoved` 中读取 `UITouch.timestamp`，使用 `CADisplayLink` 在下一次画面提交时记录毫秒差；至少保留 100 个 `.penRender` 样本。该测量是应用管线指标，真实像素延迟再用 240fps 手机慢动作抽查 5 次。

- [ ] **Step 2：实现不可写入笔迹的语义 Overlay**

```swift
import SwiftUI

struct SemanticCircle: Equatable {
    let center: CGPoint
    let radius: CGFloat
}

struct SemanticOverlayView: View {
    let circles: [SemanticCircle]

    var body: some View {
        Canvas { context, _ in
            for circle in circles {
                let rect = CGRect(
                    x: circle.center.x - circle.radius,
                    y: circle.center.y - circle.radius,
                    width: circle.radius * 2,
                    height: circle.radius * 2
                )
                context.stroke(Path(ellipseIn: rect), with: .color(.blue), lineWidth: 3)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
```

界面使用 `ZStack`：底层 `PencilLatencyCanvasView`，顶层 `SemanticOverlayView`。任何远端动作只能改变 `circles`，不得取得 `PKCanvasView.drawing` 写权限。

- [ ] **Step 3：加入可见门禁状态**

页面显示：Apple Pencil 样本数、P50、P95、最大值、当前是否达到 50ms 门禁，以及“清空本次探针”按钮。清空语义层和清空笔迹层必须是两个不同操作。

- [ ] **Step 4：在真实 iPad 上验证**

用 Xcode 安装到目标 iPad，连续书写至少 100 个采样点并导出结果。模拟器只验证构建和布局，不能替代 Apple Pencil 门禁。

- [ ] **Step 5：提交双层画布**

```bash
git add apps/ipad/ScholarPadProbe
git commit -m "实现PencilKit笔迹与语义对象双层画布"
```

## Task 4：用 TDD 实现 AVAudioEngine 录音、播放和本地打断

**Files:**
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/Audio/VoiceActivityDetector.swift`
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/Audio/AudioProbeEngine.swift`
- Test: `apps/ipad/ScholarPadProbe/ScholarPadProbeTests/VoiceActivityDetectorTests.swift`

- [ ] **Step 1：先写语音活动检测失败测试**

```swift
import XCTest
@testable import ScholarPadProbe

final class VoiceActivityDetectorTests: XCTestCase {
    func testThreeConsecutiveFramesTriggerInterruption() {
        var detector = VoiceActivityDetector(threshold: 0.05, requiredFrames: 3)
        XCTAssertFalse(detector.push(rms: 0.08))
        XCTAssertFalse(detector.push(rms: 0.09))
        XCTAssertTrue(detector.push(rms: 0.07))
    }

    func testQuietFrameResetsSequence() {
        var detector = VoiceActivityDetector(threshold: 0.05, requiredFrames: 3)
        _ = detector.push(rms: 0.08)
        _ = detector.push(rms: 0.01)
        XCTAssertFalse(detector.push(rms: 0.09))
    }
}
```

- [ ] **Step 2：运行测试确认失败**

Run:

```bash
xcodebuild -project apps/ipad/ScholarPadProbe/ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
```

Expected: FAIL，提示 `VoiceActivityDetector` 未定义。

- [ ] **Step 3：实现纯 Swift 检测器**

```swift
struct VoiceActivityDetector {
    let threshold: Float
    let requiredFrames: Int
    private var consecutiveFrames = 0

    mutating func push(rms: Float) -> Bool {
        consecutiveFrames = rms >= threshold ? consecutiveFrames + 1 : 0
        return consecutiveFrames >= requiredFrames
    }
}
```

- [ ] **Step 4：接入 AVAudioEngine**

`AudioProbeEngine` 必须：

- 配置 `AVAudioSession` 为 `.playAndRecord`、`.voiceChat`、允许蓝牙但默认使用 iPad 麦克风和扬声器；
- 在 `inputNode` 安装 tap，计算 Float32 PCM RMS；
- 使用 `AVAudioPlayerNode` 播放本地 30 秒测试音；
- 检测器触发时先同步调用 `playerNode.stop()`，再通知网络层；
- 用 `ContinuousClock` 记录首次越过阈值到 stop 调用的耗时；
- 连续测量 20 次；
- 不把输入 PCM 写入文件。

- [ ] **Step 5：验证录音权限、回放与中断恢复**

在真实 iPad 上完成 10 次 5 秒录音回放、20 次本地打断、5 次锁屏唤醒后恢复。原始音频只在内存循环缓冲区中保留，完成一次回放后立即清空。

- [ ] **Step 6：运行测试并提交**

Run:

```bash
xcodebuild -project apps/ipad/ScholarPadProbe/ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
```

Expected: 所有 XCTest 通过。

```bash
git add apps/ipad/ScholarPadProbe
git commit -m "实现原生音频与本地语音打断"
```

## Task 5：实现家庭局域网 HTTP/WS

**Files:**
- Create: `apps/gate-server/package.json`
- Create: `apps/gate-server/tsconfig.json`
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/Network/ProbeWebSocket.swift`
- Test: `apps/ipad/ScholarPadProbe/ScholarPadProbeTests/ProbeWebSocketTests.swift`
- Create: `apps/gate-server/src/server.ts`
- Test: `apps/gate-server/test/probe-protocol.test.ts`

- [ ] **Step 1：创建 Mac mini 网关包**

```json
{
  "name": "@ai-scholar/gate-server",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```bash
pnpm --filter @ai-scholar/gate-server exec pwd
pnpm add --filter @ai-scholar/gate-server @ai-scholar/gate-contracts@workspace:* fastify @fastify/websocket zod
```

Expected: 第一条输出以 `/apps/gate-server` 结尾，两条命令退出码均为 0。

- [ ] **Step 2：实现明文家庭局域网端点**

`server.ts` 固定监听 `0.0.0.0:8787`，提供 `GET /healthz` 和 WebSocket `/probe`。iPad 使用 `ws://<Mac-LocalHostName>.local:8787/probe`，不直接连接 Codex app-server。阶段 0 不生成证书、不做配对、不发送 bearer token，也不得把网关端口映射到公网。

终端 A：

```bash
pnpm gate:server
```

终端 B：

```bash
device_host="$(scutil --get LocalHostName).local"
curl "http://${device_host}:8787/healthz"
```

Expected: 返回 `{"status":"ok"}`。随后在同一 Wi-Fi 的 iPad Safari 打开相同 health URL，确认系统弹出并允许本地网络权限。

- [ ] **Step 3：先写重连策略测试**

```swift
import XCTest
@testable import ScholarPadProbe

final class ProbeWebSocketTests: XCTestCase {
    func testReconnectDelayCapsAtOneSecond() {
        XCTAssertEqual((0...4).map(ProbeWebSocket.reconnectDelayMs), [100, 200, 400, 800, 1000])
    }
}
```

实现：

```swift
static func reconnectDelayMs(attempt: Int) -> Int {
    min(1000, 100 * (1 << attempt))
}
```

- [ ] **Step 4：实现 100 次确认和 20 次语义动作**

iPad 用 `URLSessionWebSocketTask` 连接 `/probe`，顺序发送带 `id`、`clientSeq` 的 JSON；Mac 返回相同字段和 `serverReceivedAt`。确认后才发送下一条。语义动作只能解码为本地 `SemanticCircle` 并更新 overlay；未知类型拒绝并记一次失败。

- [ ] **Step 5：验证断线恢复**

真实 iPad 上关闭 Wi-Fi 10 秒再开启，共 5 次。每次从网络恢复到收到新确认必须 ≤5000ms；队列按 `clientSeq` 重放，服务端同一 id 只确认一次。

- [ ] **Step 6：运行测试并提交**

```bash
xcodebuild -project apps/ipad/ScholarPadProbe/ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
pnpm vitest run apps/gate-server/test/probe-protocol.test.ts
git add apps/ipad/ScholarPadProbe apps/gate-server
git commit -m "实现原生iPad家庭局域网连接"
```

## Task 6：准备 Wizard-of-Oz 三次家庭试用

**Files:**
- Create: `validation/wizard-of-oz/session-guide.md`
- Create: `validation/wizard-of-oz/session-template.json`
- Create: `validation/results/.gitkeep`

- [ ] **Step 1：写固定提示卡**

提示顺序严格为：L0 安静观察 30 秒；L1“你现在已经确定了什么？”；L2“0.3还能换成什么说法？”；L3 画十等份空长条；L4 演示 `2 × 0.3` 后擦掉，让孩子重建 `2.4 × 0.3`。

- [ ] **Step 2：记录真实证据**

每次记录：首个表示、开始有效行动时间、最高提示等级、恢复生产性的话术、讲回证据、`3.5 × 0.4` 是否无提示迁移、孩子是否暂停/异议/愿意继续。禁止写“粗心”“不聪明”等人格判断。

- [ ] **Step 3：完成一周内三次可比挑战**

最高提示等级不升且至少一次无提示迁移，才允许教学门禁 `PASS`。孩子选择停止或家庭时间不足记为 `BLOCKED`，不得算孩子失败。

- [ ] **Step 4：提交模板，不提交真实家庭结果**

```bash
git add validation/wizard-of-oz validation/results/.gitkeep
git commit -m "新增教学闭环家庭验证材料"
```

## Task 7：实现 Codex app-server 身份与实时探针

**Files:**
- Create: `scripts/snapshot-codex-schema.sh`
- Create: `tools/codex-realtime-probe/package.json`
- Create: `tools/codex-realtime-probe/tsconfig.json`
- Create: `tools/codex-realtime-probe/src/app-server-client.ts`
- Create: `tools/codex-realtime-probe/src/live-probe.ts`
- Create: `tools/codex-realtime-probe/src/realtime-contract.ts`
- Test: `tools/codex-realtime-probe/test/app-server-client.test.ts`

- [ ] **Step 1：创建 Codex 探针包**

```json
{
  "name": "@ai-scholar/codex-realtime-probe",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/live-probe.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```bash
pnpm --filter @ai-scholar/codex-realtime-probe exec pwd
pnpm add --filter @ai-scholar/codex-realtime-probe @ai-scholar/gate-contracts@workspace:*
```

Expected: 第一条输出以 `/tools/codex-realtime-probe` 结尾，两条命令退出码均为 0。

- [ ] **Step 2：用假 app-server 写失败测试**

测试必须覆盖：`initialize.params.capabilities.experimentalApi === true`、收到 initialize 响应后才发送 `initialized`、按 JSON-RPC id 匹配响应、收集 `thread/realtime/started`、请求超时和子进程正常关闭。另写一个失败用例：省略 `experimentalApi` 时，假服务返回 `<descriptor> requires experimentalApi capability`。假服务不得访问网络或真实 Codex 配置。

- [ ] **Step 3：固定与本机版本匹配的实验协议契约**

先运行 `codex --version`。本计划基线是 `codex-cli 0.144.1`，对应 OpenAI Codex 仓库标签 `rust-v0.144.1` 的 `app-server-protocol/src/protocol/v2/realtime.rs`。把当前用到的最小请求和通知类型写入 `realtime-contract.ts`；不得从 `main` 分支复制，也不得假设生成 schema 已包含全部实验请求。

本机 `0.144.1` 已验证：`generate-json-schema` 会生成 realtime 通知结构，但没有导出 `thread/realtime/start`、`appendAudio` 等实验客户端请求定义。因此 `snapshot-codex-schema.sh` 除保存 schema 与 SHA-256 外，还必须记录 `codex --version`；若版本不等于契约记录版本，探针直接 `BLOCKED`，先升级契约和测试，不能带着旧类型继续运行。

- [ ] **Step 4：实现无 shell 的 stdio 客户端**

使用 `spawn("codex", ["app-server", "--enable", "realtime_conversation", "--stdio"])`，禁止 `shell: true`。启动后先发送：

```json
{
  "method": "initialize",
  "id": 1,
  "params": {
    "clientInfo": {
      "name": "ai_scholar_probe",
      "title": "AI Scholar Probe",
      "version": "0.1.0"
    },
    "capabilities": {
      "experimentalApi": true
    }
  }
}
```

收到 `id: 1` 的成功响应后发送 `{"method":"initialized","params":{}}`。随后请求顺序固定为：`account/read`、`account/rateLimits/read`、`thread/start`、`thread/realtime/listVoices`、`thread/realtime/start`、`thread/realtime/appendText`、`thread/realtime/stop`。

`--enable realtime_conversation` 打开服务端 feature；`capabilities.experimentalApi: true` 打开当前客户端连接的实验协议能力。二者缺一不可。

- [ ] **Step 5：执行准入门禁**

只有 `account.type === "chatgpt"` 且 `OPENAI_API_KEY` 不存在时继续。功能不可用、鉴权失败、API key 身份或用量归属未知均生成 `BLOCKED`，不继续上层开发。

- [ ] **Step 6：连续执行 20 次音频输出会话**

每次发送“请只说：你好，我们开始验证。”，记录 `appendText` 到首个 `thread/realtime/outputAudio/delta`；至少 19 次成功。保存 Codex 版本、schema 哈希、前后 rate limits、首包 P50/P95 和错误摘要。

- [ ] **Step 7：运行测试和 schema 预检**

```bash
pnpm vitest run tools/codex-realtime-probe/test/app-server-client.test.ts
bash scripts/snapshot-codex-schema.sh
codex features list | rg '^realtime_conversation\s+under development\s+false$'
```

Expected: 单元测试通过；schema 有 SHA-256；快照中的 Codex 版本与 `realtime-contract.ts` 记录版本一致；功能仍明确标记为 under development 且默认关闭。默认关闭是预期状态，探针进程通过 `--enable` 只为当前启动临时开启，不修改用户全局配置。

- [ ] **Step 8：提交 Codex 探针**

```bash
git add tools/codex-realtime-probe scripts/snapshot-codex-schema.sh
git commit -m "实现Codex订阅实时能力探针"
```

## Task 8：实现 iPad—Mac mini—Codex 端到端 PCM 中继

**Files:**
- Create: `apps/ipad/ScholarPadProbe/ScholarPadProbe/Network/AudioFrameCodec.swift`
- Test: `apps/ipad/ScholarPadProbe/ScholarPadProbeTests/AudioFrameCodecTests.swift`
- Create: `apps/gate-server/src/audio-frame-codec.ts`
- Test: `apps/gate-server/test/audio-frame-codec.test.ts`
- Create: `apps/gate-server/src/codex-relay.ts`

- [ ] **Step 1：固定二进制音频帧协议**

每个帧头为 14 字节：ASCII `ASAU` 4 字节、版本 1 字节、声道 1 字节、big-endian sampleRate 4 字节、big-endian samplesPerChannel 4 字节；随后是 PCM16 little-endian 数据。版本固定为 1、声道固定为 1、采样率固定为 24000。

- [ ] **Step 2：两端先写相同夹具测试**

输入 480 个交替的 `Int16.max`/`Int16.min` 样本；Swift 和 TypeScript 编码结果的 SHA-256 必须相同，解码后 sampleRate=24000、channels=1、samplesPerChannel=480、PCM 字节完全一致。

- [ ] **Step 3：实现实时链路**

iPad 的 AVAudioEngine 数据重采样为 24kHz PCM16，经家庭局域网明文 WebSocket 二进制帧发送。Mac 解码后调用 `thread/realtime/appendAudio`，参数固定为 `{ threadId, audio: { data, sampleRate: 24000, numChannels: 1, samplesPerChannel } }`，其中 `data` 是 PCM16 字节的 base64。Codex `thread/realtime/outputAudio/delta` 的 `audio` 对象按相同字段解析，解码后封装成局域网二进制帧返回；iPad 用 `AVAudioPlayerNode` 顺序播放。

- [ ] **Step 4：实现语音结束与本地打断控制**

松开“按住说话”时发送 JSON 控制消息 `utterance-end`。Mac 先补 800ms 静音给服务端 VAD；这只是首个验证值，不是既成协议。连续 5 次若任一次不能在 5 秒内得到 transcript done 或首个输出事件，则依次改测 1200ms、1600ms，各 5 次；记录能 5/5 成功的最小值。三个值都失败时将 Codex 音频输入标记为 `BLOCKED`，不得用无限补静音绕过。孩子再次开口时，iPad 必须先停止本地播放器，再发送 `stop-output`；不能等待 Codex 往返。

- [ ] **Step 5：真实测量 20 次首音频**

从松开按钮到 iPad 收到并调度首个 PCM 块，记录 `.firstAudio`。Mac 端首包只能作为诊断子指标，不能冒充端到端结果。

- [ ] **Step 6：运行跨端测试并提交**

```bash
xcodebuild -project apps/ipad/ScholarPadProbe/ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
pnpm vitest run apps/gate-server/test/audio-frame-codec.test.ts
git add apps/ipad/ScholarPadProbe apps/gate-server
git commit -m "实现iPad到Codex的实时音频中继"
```

## Task 9：生成统一门禁报告

**Files:**
- Create: `tools/gate-report/package.json`
- Create: `tools/gate-report/tsconfig.json`
- Create: `tools/gate-report/src/evaluate.ts`
- Test: `tools/gate-report/test/evaluate.test.ts`
- Modify: `apps/ipad/ScholarPadProbe/ScholarPadProbe/App/ProbeDashboardView.swift`

- [ ] **Step 1：创建报告包**

```json
{
  "name": "@ai-scholar/gate-report",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/evaluate.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```bash
pnpm --filter @ai-scholar/gate-report exec pwd
pnpm add --filter @ai-scholar/gate-report @ai-scholar/gate-contracts@workspace:*
```

Expected: 第一条输出以 `/tools/gate-report` 结尾，两条命令退出码均为 0。

- [ ] **Step 2：先写阈值失败测试**

测试覆盖：Pencil 51ms 失败、本地打断 201ms 失败、LAN 151ms 失败、首音频 P95 3001ms 失败、19/20 会话通过、18/20 失败、API key 身份 `BLOCKED`、用量归属未知 `BLOCKED`。

- [ ] **Step 3：实现 iPad 结果导出**

iPad 导出 JSON 只包含设备型号、系统版本、App build、传输类型 `ws-local`、指标样本和人工慢动作抽查结果；不得包含 PCM、录音文件、完整笔迹或家庭环境信息。使用系统分享面板交给家长保存到 Mac mini。

- [ ] **Step 4：实现总状态规则**

三项门禁分别判定。任何 `BLOCKED` 使总状态为 `BLOCKED`；没有 blocked 但有 `FAIL` 时为 `FAIL`；只有三项全通过才是 `PASS`。报告必须写明失败指标的样本数、P50/P95、阈值和原始结果文件。

- [ ] **Step 5：运行全部自动化验证**

```bash
xcodebuild -project apps/ipad/ScholarPadProbe/ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
pnpm test
pnpm typecheck
```

Expected: XCTest、Vitest 和 TypeScript 类型检查全部通过。

- [ ] **Step 6：提交报告器**

```bash
git add tools/gate-report apps/ipad/ScholarPadProbe
git commit -m "实现原生iPad阶段0门禁报告"
```

## Task 10：在真实家庭环境执行 Go/No-Go

**Files:**
- Create locally, do not commit: `validation/results/wizard/wizard-run-2026-09-07.json`
- Create locally, do not commit: `validation/results/device/ipad-native-2026-09-07.json`
- Create locally, do not commit: `validation/results/codex/codex-2026-09-07.json`
- Create locally, do not commit: `validation/results/gate-report-2026-09-07.md`

- [ ] **Step 1：安装到目标 iPad**

在 Xcode 中选择家长自己的 Development Team 和目标 iPad，安装 `ScholarPadProbe`。账号凭据只在 Xcode/Keychain 中处理，不写入项目文件或命令日志。

- [ ] **Step 2：完成原生设备测量**

执行：100 个 PencilKit 样本、20 次本地打断、100 次 LAN 确认、20 次远端语义圆、20 次端到端首音频、5 次 Wi-Fi 断线恢复、5 次锁屏恢复。设备型号和 iPadOS build 必须进入结果。

- [ ] **Step 3：完成 Codex 和用量归属验证**

```bash
env -u OPENAI_API_KEY pnpm gate:codex
```

运行前后查看 Codex Settings → Usage、`/status` 和 API Usage。只有 Codex Usage 出现可解释变化且 API 无对应调用，才标记 `usageAttribution=codex`；尚未刷新或无法解释时保持 `BLOCKED`。

- [ ] **Step 4：完成三次教学试用并生成报告**

三次 Wizard-of-Oz、原生 iPad 结果和 Codex 结果缺一不可。报告器缺少任一输入必须退出失败，不能生成绿色的部分报告。

- [ ] **Step 5：执行停止规则**

- `PASS`：单独编写“原生 iPad 单挑战机器原型”计划。
- PencilKit、音频或网络 `FAIL`：只修对应原生子系统后复测，不改回网页。
- 教学 `FAIL`：修改提示阶梯和独立探索规则后复测。
- Codex `FAIL/BLOCKED`：停在桥接层报告，不切换模型或 API 计费。

- [ ] **Step 6：最终检查**

```bash
git status --short
xcodebuild -project apps/ipad/ScholarPadProbe/ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
pnpm test
pnpm typecheck
```

Expected: 代码无未提交改动，家庭结果目录被忽略，全部自动化测试通过。

## 自检映射

| 已确认要求 | 任务 |
|---|---|
| 完整原生 Swift App | Task 1–5 |
| PencilKit 儿童笔迹 | Task 3 |
| Agent 语义层不能覆盖笔迹 | Task 3 |
| AVAudioEngine 与本地 200ms 打断 | Task 4 |
| URLSessionWebSocketTask 与家庭局域网 HTTP/WS | Task 5 |
| 三次真实教学验证 | Task 6、Task 10 |
| Codex ChatGPT 身份与实验接口 | Task 7 |
| iPad—Mac—Codex 端到端音频 | Task 8 |
| 三项独立报告与停止规则 | Task 9、Task 10 |
