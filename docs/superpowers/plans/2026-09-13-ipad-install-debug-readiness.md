# AI-DTL iPad 到货安装与联调就绪执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans 按任务与门禁执行；仅在负责人明确分派时使用 superpowers:subagent-driven-development。每步使用复选框记录实测结果。本文是执行交接，不代表下面任务已经完成。

**Goal:** 在 iPad 到手前准备可复现的真机构建、可配置宿主和隔离调试环境，到手后经家长签名/配对即可安装正式 App 与测量 App，完成可观察的本地学习闭环。

**Architecture:** 保留 SwiftUI/PencilKit、Mac 本地 SQLite、家庭 HTTP/WS、Codex 优先路线。将工程就绪、签名安装、功能联调、恢复正确性与实时音频分开验收；不将模拟器包冒充真机安装包，不以系统朗读冒充 Codex 双向语音。

**Tech Stack:** Xcode 26.6、iOS SDK 26.5、XcodeGen、Swift 6、Node.js/pnpm、Fastify、SQLite、devicectl。

---

## 0. 结论与本轮实测

基线：`e2a14d1`，已在私有 `origin/main`。本计划位于 `codex/ipad-arrival-plan`，本轮仅研究、隔离构建和编写计划，没有实施应用修改或变更 Apple 账户。

| 项目 | 2026-09-13 实测结果 | 不能推导出的结论 |
| --- | --- | --- |
| 开发工具 | Xcode 26.6 / 17F113，iPhoneOS 与 Simulator SDK 均 26.5，XcodeGen 已安装 | 不保证支持尚未看到的 iPadOS 版本 |
| 真机发现 | `xcrun devicectl list devices`：No devices found | 尚未配对，更未安装 |
| 正式 App 真机目标 | `generic/platform=iOS`、Debug、禁用签名构建退出 0；可执行文件为 arm64，平台 iPhoneOS | 不是已签名 App，也不是可安装 IPA |
| 联调 App 真机目标 | 同一参数构建退出 0 | 不代表麦克风/Pencil 真机通过 |
| 签名 | 工程 Automatic；有效构建设置未见 DEVELOPMENT_TEAM；正式产物 `codesign -dv` 报未签名 | 不据此断言用户没有 Apple 账户/会员；本轮未读取账户凭据或钥匙串 |
| 品牌 | AI-DTL / AI 学科心智学习系统，原图已打包 | 尚未新增方形 AppIcon；不阻塞 Xcode 本机开发调试 |
| 正式端主机配置 | 真机默认 `houbin-mbp.local`，模拟器固定 localhost；正式界面没有主机地址入口 | 旧清单中「在 iPad 输入主机名」当前不可执行 |
| 重开后的事件 | SessionClient 恢复 sessionId，但新建 EventOutbox 从 seq=1 开始 | 画布恢复成功不等于后续事件可正常提交 |
| 协议复现 | 已接收 seq=1 后，新 eventId 再发送 seq=1，宿主返回 `nack/seqGap/expectedSeq=2` | 这是协议级复现，尚未进行真实 iPad 强退复现 |
| Codex 音频 | 最近已知准入仍 BLOCKED，见既有交接 | 本轮没有重新调用模型，也没有更换鉴权 |

本轮产物（临时构建目录，不入 Git）：

- `/tmp/ai-dtl-ipados-readiness/Build/Products/Debug-iphoneos/ScholarPad.app`
- `/tmp/ai-dtl-probe-ipados-readiness/Build/Products/Debug-iphoneos/ScholarPadProbe.app`

两次构建均提示横屏/多任务方向 warning。本轮没有 App Store 发布目标；第一天验收全屏横屏，分屏/窗口化另列，不为消除 warning 随意改变布局或启用不支持的能力。

### 安装路线裁决

首选 **USB → Xcode 签名 → Run 安装**，不需要先制作 IPA，更不需要等 App Store 或 TestFlight。

免费 Apple 账户也可通过 Personal Team 在个人设备开发测试，但需要周期性重新签名安装；Apple 当前说明 provisioning profile 有效期 7 天，并有设备/App 数限制。付费会员才考虑后续分发便利性，不把购买会员列为第一天硬门槛。[Apple 账户说明](https://developer.apple.com/help/account/basics/about-your-developer-account)

如用户另行选择 Ad Hoc IPA，则必须有合适会员、证书、包含目标设备的 profile；设备到手前既没有设备标识也没有已验证签名，不能承诺现在交付通用可安装包。TestFlight 涉及上传和分发，**不在本计划默认范围**。

## 1. 执行权限与工作分配

- 不改品牌、Bundle ID、默认学习库、模型路线，不公开仓库，不修改许可证。
- Apple 登录、密码/验证码、条款确认、设备信任和 Developer Mode 由家长亲自操作；agent 不读取或记录凭据，不自动创建/吊销证书。
- 本计划授权范围是后续经用户派发的本地实现与隔离验收；不因计划中的命令推断继续推送/部署授权。
- 所有新增材料、录音、笔迹仅用成人/合成测试样本；真实孩子使用另行告知。测试目录被忽略，真实档案不拿来测试删除。
- 建议负责人 A 管 Task 1–3（原生）；负责人 B 管 Task 4（Mac 启动包）；负责人 A 串行完成 Task 5–7。不要同时启动多个模拟器抢资源。
- 文学插件、开放协议、课程生成、插件市场全部延后；本计划不做架构重建。

开始时执行：

```sh
cd /Users/houbin/Documents/Codex/2026-08-29/wo-yo
git status --short --branch
git log -3 --oneline
git branch -vv
```

保留本计划及其他未提交改动。实施分支建议 `codex/ipad-device-readiness`；从核实后的 main 加本计划开始，不直接在 main 提交。独立 agent 并行实施时各自明确文件范围，禁止同时切共享目录分支。

## Task 1：可复现的两套真机构建（到货前）

**Files:** 读取 `apps/ipad/ScholarPad/project.yml`、`apps/ipad/ScholarPadProbe/project.yml`；产物写入 `outputs/ipad-readiness/`，最终验证记录写 `docs/handoffs/2026-09-13-ipad-debug-results.md`。

- [ ] 检查 `xcodebuild -version`、`xcodebuild -showsdks`、`xcrun devicectl list devices`。只记录工具版本/设备可用性，报告不复制个人设备序列号。
- [ ] 在两个工程目录各执行 `xcodegen generate`，只将 project.yml 和必要 Info.plist 改动纳入 Git，不提交 xcodeproj。
- [ ] 在根目录运行以下命令，逐条确认退出码；缺依赖可以正常安装项目已声明依赖，不升级版本。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
xcodebuild build-for-testing -project apps/ipad/ScholarPad/ScholarPad.xcodeproj -scheme ScholarPad -destination 'generic/platform=iOS Simulator' -derivedDataPath outputs/ipad-readiness/simulator CODE_SIGNING_ALLOWED=NO
xcodebuild build -project apps/ipad/ScholarPad/ScholarPad.xcodeproj -scheme ScholarPad -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath outputs/ipad-readiness/device CODE_SIGNING_ALLOWED=NO
xcodebuild build -project apps/ipad/ScholarPadProbe/ScholarPadProbe.xcodeproj -scheme ScholarPadProbe -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath outputs/ipad-readiness/probe-device CODE_SIGNING_ALLOWED=NO
```

- [ ] 对两个 `.app` 的 Info.plist 读取 CFBundleIdentifier、CFBundleDisplayName、MinimumOSVersion、CFBundleSupportedPlatforms；主 App 必须是 `com.houbin.aischolar.pad` / AI-DTL / iPhoneOS。核对 `brand/ai-dtl-logo.png` 与仓库原图 SHA256 相等。
- [ ] 使用 `file` 和 `codesign -dv` 明确标注 `unsigned-device-build`；不要把该目录压缩改名成 IPA 后宣称可安装。
- [ ] 记录构建退出码、警告、Git SHA、产物绝对路径、是否签名。此任务不提交二进制。

## Task 2：让正式 App 能配置 Mac 地址（到货前，优先）

**Files:** 修改 `apps/ipad/ScholarPad/ScholarPad/Session/SessionClient.swift`；新增 `Session/HostConfiguration.swift` 与 `ScholarPadTests/HostConfigurationTests.swift`；更新旧到货清单。不改 Probe，它已在「网络」页提供地址输入。

第一版仅做 Debug 启动配置，使用 Xcode Scheme 的 Environment Variables 设置 `SCHOLARPAD_HOST`，从而不必每换一台 Mac 就改源码。暂不增加儿童主屏设置按钮。采用 `.local` 主机名，不将 `http://`、端口或路径放入变量；IPv4/IPv6 与 ATS 特例留到确有需要时单独验证。

- [ ] 先添加下列失败测试，并只运行 HostConfigurationTests，确认因缺实现失败：

```swift
import XCTest
@testable import ScholarPad

final class HostConfigurationTests: XCTestCase {
    func testOverrideAndSavedHost() {
        XCTAssertEqual(HostConfiguration.resolve(override: " family-mac.local ", saved: nil, simulator: false), "family-mac.local")
        XCTAssertEqual(HostConfiguration.resolve(override: nil, saved: "family-mac.local", simulator: true), "family-mac.local")
        XCTAssertEqual(HostConfiguration.resolve(override: nil, saved: nil, simulator: true), "localhost")
    }
    func testInvalidOverrideDoesNotBecomeURL() {
        for value in ["http://mac.local", "mac.local:8788", "mac.local/path", "localhost", "127.0.0.1"] {
            XCTAssertNil(HostConfiguration.localName(value))
        }
    }
}
```

- [ ] 最小实现 `HostConfiguration.swift`：

```swift
import Foundation

enum HostConfiguration {
    static func localName(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return value.range(of: #"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$"#, options: .regularExpression) == nil ? nil : value
    }
    static func resolve(override: String?, saved: String?, simulator: Bool) -> String {
        localName(override) ?? localName(saved) ?? (simulator ? "localhost" : "houbin-mbp.local")
    }
}
```

- [ ] 将 SessionClient.init 中当前 `#if targetEnvironment(simulator)` 的 host 初始化块替换为：

```swift
#if targetEnvironment(simulator)
let isSimulator = true
#else
let isSimulator = false
#endif
#if DEBUG
let hostOverride = ProcessInfo.processInfo.environment["SCHOLARPAD_HOST"]
#else
let hostOverride: String? = nil
#endif
host = HostConfiguration.resolve(override: hostOverride,
                                 saved: UserDefaults.standard.string(forKey: "padHost"),
                                 simulator: isSimulator)
UserDefaults.standard.set(host, forKey: "padHost")
```

- [ ] 在执行机运行 `scutil --get LocalHostName`，将结果加 `.local` 后由操作人填入 Xcode Scheme；Scheme 环境值不入版本库。第一次更换宿主必须同时使用已有 `--fresh-session` 参数，避免把其他宿主的旧会话标识复用。之后同一宿主恢复测试必须去掉该参数。
- [ ] 验证无效输入测试通过；模拟器连接真实临时宿主收到任务；重开后使用保存地址。文档明确第一版不支持随时跨宿主切换或漫游学习记录。
- [ ] 单独提交此改动，不混入后续持久化修复。

## Task 3：事件恢复阻断的红测、最小修复和专项评审（到货前可做）

**Files:** `Session/EventOutbox.swift`、`Session/SessionClient.swift`、`ScholarPadTests/EventOutboxTests.swift`；新增 `ScholarPadTests/SessionRestartTests.swift`；服务端回归放 `apps/agent-host/test/session-gateway.test.ts`。若增加文件存储，独立为 `Session/EventOutboxArchive.swift`，不得塞进画布存储或改宿主序号校验。

本任务涉及新的持久化证据副本，执行者应先用测试锁定下面契约，再完成最小实现和数据生命周期评审。不得为了赶安装，把 host 的 seqGap 检查关掉，或将所有重开都改成新会话。

- [ ] 复现：发送并确认一条事件，保存 sessionId，销毁客户端并重建；下一条新事件应 seq=2，而不是 1。另测未收到 ack 时退出，重建后须重放原 id/seq/payload，而不是重新生成 id。
- [ ] 对 EventOutbox 先加入以下快照 round-trip 测试；拟采用的序列化接口是 Swift `Codable`，不是新增跨网络协议：

```swift
func testSnapshotKeepsSequenceAndPendingIdentity() throws {
    var original = EventOutbox(sessionId: "restart", deviceId: "fixture")
    let first = original.enqueue(.helpRequest, source: .childButton, occurredAt: 1)
    original.acknowledge(id: first.id)
    let pending = original.enqueue(.done, source: .childButton, occurredAt: 2)
    let bytes = try JSONEncoder().encode(original)
    var restored = try JSONDecoder().decode(EventOutbox.self, from: bytes)
    XCTAssertEqual(restored.pending, [pending])
    XCTAssertEqual(restored.enqueue(.resumeRequest, source: .childButton, occurredAt: 3).clientSeq, 3)
}
```

- [ ] 最小值类型改动为 `struct EventOutbox: Codable`；但 **只有 round-trip 通过不算完成**，SessionClient 必须实际从快照恢复，并在 enqueue/ack 后保存。
- [ ] 存储实现按以下严格顺序：复制当前 outbox → 修改副本 → 原子写入新快照 → 更新内存 → 才允许 transmit。ack 同样先成功保存再替换内存；保存失败时保留旧队列、暂停发送并显示可重试的保存错误。不能 `try?` 后继续发送。快照至少保存版本、host/session/device 作用域、nextSeq、pending 完整帧；文件在 Application Support 且 excludedFromBackup。
- [ ] 验证磁盘集成的具体断言：1）ack 后重开下一 seq 正确；2）断网退出保留 pending 原帧；3）服务端已接收但 ack 丢失后重放仅产生一条证据；4）不同 host/session 不串队列；5）损坏或版本未知快照停止恢复而不是从 1 继续；6）模拟原子写失败不发送事件。
- [ ] 检查旧安装迁移：已有 sessionId 却无 outbox 快照时不可假装可续传。保留旧本地数据和宿主记录，显示「旧会话无法安全续传，请开始新一题」并等待明确选择；首次从无任何旧会话的新安装可以创建空快照。
- [ ] 数据生命周期专项评审：只保留恢复所需 pending，不把已确认事件永久复制到 iPad；作品/会话被删除时阻止排队事件重放复活内容，离线设备在联机得知删除后清理相应副本。不得把 pending 新存储排除在既有删除契约之外。补「删除→迟到重放」断言。
- [ ] 运行 SessionRestartTests、EventOutboxTests、DrawingArchiveTests 及宿主回归，再由非实现者检查保存失败/损坏/删除路径。通过前只允许「新会话单次操作调试」，不宣布恢复闭环已通过。

## Task 4：准备隔离 Mac 联调启动入口（到货前）

**Files:** 新增 `tools/ipad-debug/host.mts`；验证 `apps/agent-host/src/parent-channel.ts`、`apps/agent-host/src/server.ts`；不改变生产默认启动命令。

注意：单设 `AI_SCHOLAR_DATA_DIR` 只隔离学习库，当前 `loadParentToken()` 默认仍走家目录。联调入口应显式传入独立 parentToken，避免测试触碰真实家庭凭据。

- [ ] 使用以下完整入口。唯一输出是访问地址、数据目录及凭据文件路径，不打印凭据内容：

```typescript
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { buildHostServers } from "../../apps/agent-host/src/server.js";
import { loadParentToken } from "../../apps/agent-host/src/parent-channel.js";

const dataDir = process.env.AI_DTL_DEBUG_DIR
  ? resolve(process.env.AI_DTL_DEBUG_DIR)
  : mkdtempSync(join(tmpdir(), "ai-dtl-ipad-debug-"));
const { childApp, parentApp } = await buildHostServers({
  bridge: "parent", dataDir, parentToken: loadParentToken(dataDir),
});
try {
  await parentApp.listen({ host: "127.0.0.1", port: 8789 });
  await childApp.listen({ host: "0.0.0.0", port: 8788 });
} catch (error) {
  await childApp.close();
  throw error;
}
const localName = execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim();
console.log(JSON.stringify({ dataDir, childHost: `${localName}.local`,
  parentURL: "http://127.0.0.1:8789/parent", tokenFile: join(dataDir, "parent-token") }));
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await childApp.close();
}
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
```

- [ ] 根目录用 `node --import tsx tools/ipad-debug/host.mts` 启动；`.mts` 明确使用 ESM，避免根 package.json 未声明 type 时将顶层 await 转为 CJS。记录实际命令，不把启动尝试当启动成功。
- [ ] 验证 `curl --fail http://127.0.0.1:8788/healthz` 返回 parent 桥接；家长页面可达，匿名 `/parent/sessions` 为 401；8789 仅回环监听。端口占用时先报告所属服务，不杀占用进程。
- [ ] 家长自己在 Mac 打开控制台，自己从刚创建的临时目录凭据文件复制到控制台，不发到聊天、不写入报告。agent 可以提供文件路径，但不读取其内容。
- [ ] 同时需要 Probe 网络测量时另开终端 `pnpm gate:server`，确认端口 8787。Probe 不能连接正式宿主 8788；正式 App 不能连接探针 8787。
- [ ] 将 dataDir 路径记录在本地忽略文件中。重启宿主测试必须使用同一个 `AI_DTL_DEBUG_DIR`，不再新建空库；测试结束停止自己的服务，不自动删除数据以便复核。

## Task 5：模拟器预验收与安装资料准备（到货前）

**Files:** 新增结果记录 `docs/handoffs/2026-09-13-ipad-debug-results.md`；原始截图/日志放 `validation/results/` 或 `outputs/`，不入 Git。

- [ ] `xcrun simctl list devices available` 选择现有 iPad 模拟器；只运行一个。使用实测标识设置 `IPAD_SIMULATOR_ID`，它来自命令输出，不照抄旧文档 UUID。

```sh
test -n "$IPAD_SIMULATOR_ID"
xcodebuild test -project apps/ipad/ScholarPad/ScholarPad.xcodeproj -scheme ScholarPad -destination "platform=iOS Simulator,id=$IPAD_SIMULATOR_ID" -parallel-testing-enabled NO -only-testing:ScholarPadTests -only-testing:ScholarPadUITests/BrandingUITests -only-testing:ScholarPadUITests/MemoryAssentSmokeUITests -only-testing:ScholarPadUITests/ChildRightsSmokeUITests
```

- [ ] 正式端连接 Task 4 临时宿主，查看新品牌、首次告知、任务、输入、画布、四个常驻入口及家长预览。宿主地址配置和 Task 3 必须有真实网络联动测试，不只测试固定 UI fixture。
- [ ] 测试宿主启动长时间不动时检查本任务日志和机器负载；两次同因失败后换方法，不能持续开新模拟器。无法执行断言就记 `NOT_RUN`，只报告编译结果。
- [ ] 结果表固定列：Git SHA、系统/设备、检查项、样本数、PASS/FAIL/BLOCKED/NOT_RUN、证据路径、未解决问题。不要上传带孩子内容的截图或个人设备标识。
- [ ] 到货前资料包仅包含源码入口、已验证构建命令、Mac 主机名、端口、资料路径和签名操作说明；不包含 Apple 凭据、开发私钥或生产家长 token。

## Task 6：家长签名、设备配对与首次安装（到货后）

**Files:** 原则上不改源码。Xcode 本地签名选择不入 Git；若需可复现命令行配置，使用环境变量提供用户已选择的 Team ID，不把账户信息硬编码到 project.yml。

- [ ] 家长在 Xcode > Settings > Apple Accounts 登录。若只有 Personal Team，按免费开发测试路线继续；不要要求先购买会员。
- [ ] iPad 完成基本设置、解锁，用可传数据的 USB-C 线连接 Mac；家长在设备端确认信任，在 Xcode 的 Device Hub/设备管理中确认配对。
- [ ] 配对后，家长在 iPad「设置 → 隐私与安全 → 开发者模式」开启，按提示重启并再次确认。该入口可能在发起配对之前不显示，不据此要求还原设备。
- [ ] 核对真实 iPadOS 与当前 Xcode 的设备支持。遇到缺组件/设备系统过新，记录 Xcode 提示；不猜支持范围，不自动升级操作系统或清除设备。
- [ ] 打开 `ScholarPad.xcodeproj`，Signing & Capabilities 选择家长团队并自动签名，Run destination 选真实 iPad，点击 Run。保持 Bundle ID；如果该 ID 不能注册，报告实际冲突，由负责人决定可恢复的改法，不能偷偷换 ID 造成新安装和数据分叉。
- [ ] 首次运行允许本地网络访问。正式端尚无双向录音入口，不因为 Info.plist 有麦克风声明就声称收音完成。Probe 的音频页由家长允许麦克风后测成人录放音。
- [ ] 对 Probe 重复签名安装，显示名应为 AI-DTL 联调；正式端为 AI-DTL。

可选命令行安装仅用于 **已经签名、设备已配对** 的 `.app`。操作人从设备列表设置 `IPAD_DEVICE_ID`，从 Xcode 构建结果设置 `SIGNED_APP_PATH`，先检查变量和签名：

```sh
test -n "$IPAD_DEVICE_ID" && test -d "$SIGNED_APP_PATH"
codesign --verify --deep --strict "$SIGNED_APP_PATH"
xcrun devicectl device install app --device "$IPAD_DEVICE_ID" "$SIGNED_APP_PATH"
xcrun devicectl device process launch --device "$IPAD_DEVICE_ID" com.houbin.aischolar.pad
```

`codesign --verify` 成功只是必要条件，仍要确认 development profile 对应团队、Bundle ID、目标设备与有效期；安装及运行成功才是最终证据。绝不拿 Task 1 的未签名产物执行本步骤。

## Task 7：第一天真机联调（顺序固定，失败分支独立记录）

- [ ] **连通性**：同一家庭 Wi-Fi；先在 iPad Safari 打开 `http://Mac主机名.local:8788/healthz`，再测正式 App；Safari 成功不替代 App 的本地网络授权。打不开依次查主机是否运行、端口、Wi-Fi 客户端隔离、mDNS、App 权限；不关闭全局防火墙或配置公网转发。
- [ ] **学习闭环**：首次告知 → 孩子/成人测试者独立画图 → 请求提示 → 家长控制台给一个受预算限制的提示 → iPad 显示并系统朗读 → 讲回/迁移 → 成长记录同意/异议。先用成人虚构材料，不先拿孩子测失败恢复。
- [ ] **笔迹闭环**：画图 → 家长授权预览同笔迹 → 重开恢复 → 断网新增 → 恢复上传 → 同库宿主重启 → 清空后仍为空 → 新会话不混画布。
- [ ] **事件闭环**：重开 App 后再点「我卡住了」，Mac 必须 ack 新事件，不能仅因为旧画面出现就通过；断网强退后待传事件恢复，ack 丢失重放不重复记证据。
- [ ] **删除闭环**：只对临时测试作品申请/确认删除；画布、预览、新增事件队列及迟到响应都不能复活被删内容；离线端重新联机后再核对本地清理。
- [ ] **硬件测量**：Probe 采集 Pencil 100 次、LAN ack 100 次、语义动作 20 次、本地打断 20 次、断网恢复 5 次；以代码中的 GateThresholds 为口径。P95 目标分别为 50/150/300/200/5000 ms。Pencil 探针测应用帧调度下界，不是实际屏幕像素延迟；有 240fps 设备时补慢动作验证，没有则保留像素延迟未验收。
- [ ] **音频边界**：Probe 本地录放音和打断可以先测；iPad→Mac→Codex→iPad 需真实准入后单独测。旧身份仍被拒时保留 BLOCKED，不切第三方模型，不自动寻找 API key。
- [ ] **重装风险**：不以卸载重装排查缓存问题。开发签名到期时优先保持同一 Bundle ID 重新 Run；删除 App 会影响本机数据，须先说明和确认。

## 8. 完成判据与交接

分开报告，不填一个总完成率：

1. **BUILD_READY**：两真机目标构建通过、资源一致、签名状态准确。
2. **INSTALL_READY**：真实设备已配对、开发者模式、有效签名，两 App 安装且可启动。
3. **LOCAL_LOOP_READY**：正式 App 与隔离宿主连接，笔迹/事件重启与删除验收通过。
4. **VOICE_READY**：真实 Codex 双向音频及口径正确的端到端延迟通过；未满足则 BLOCKED，不影响前三项单独交付。

最后只提交本任务源码、测试和脱敏结果文档；保留原始结果在忽略目录。合并/推送按用户后续授权执行，不因本计划自动公开仓库。更新 `docs/handoffs/2026-09-13-ipad-arrival-checklist.md`：删除当前不可执行的“iPad 输入地址”表述，写明实际配置方式与签名边界。

### 可直接给执行 agent 的指令

> 在 `/Users/houbin/Documents/Codex/2026-08-29/wo-yo` 读取本计划并核实 Git 状态。先执行 Task 1–5 的到货前准备，优先解决 Debug 宿主地址配置和重开事件序号问题；不更换模型、不改品牌、不接触正式学习库。签名、信任和开发者模式由我本人操作。设备未到时不要虚报安装完成；每步交付测试证据和可继续的下一步，原生数据持久化改动必须专项评审。不要自行公开仓库或推送未授权改动。

## 9. 官方依据

- [Apple：真机运行与自动签名](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
- [Apple：Developer Mode、配对与重启确认](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)
- [Apple：免费 Personal Team 的测试能力与 7 天限制](https://developer.apple.com/help/account/basics/about-your-developer-account)

官方页面已读取对应 Markdown 正文；命令参数以本机 Xcode 26.6 的 `devicectl --help` 实查为准。账户/会员状态尚待家长确认，计划已覆盖免费和付费两条路径。
