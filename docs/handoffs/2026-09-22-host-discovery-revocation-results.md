# 自动发现主机、离线撤销补同步：实现与验证

## 交付

- 分支 `codex/ipad-arrival-plan`，当前工作区实现，未提交/推送，保留其他未提交工作。
- Mac 在实际学习宿主启动后广播 `_ai-dtl._tcp`，使用系统 `dns-sd`，无新增依赖。持久编号位于工作区数据目录 `host-id`，USB/Wi-Fi 地址变化不改变编号。healthz 增加 `hostId` / `discoveryVersion` 并禁止缓存；关闭服务时撤回广播。
- iPad Foundation NetService 搜索、解析并验证 healthz；认回已选主机，没有已选主机且旧地址不可用时选择唯一候选。多个候选要求显式选择。保留手填地址，正在对话/处理作品时不切换，不自动开麦。
- 隐藏/撤下提示先原子保存到本地 outbox，立即隐藏；事件包含原主机、作品、提示、动作及稳定 eventId。前台每 15 秒、切换作品、恢复前台/地址改变时补同步，后台不持续轮询。
- 重试先取最新 revision，409 最多重试三次；确认隐藏/失效才出队。回执丢失可从已隐藏状态确认，不再写一次。墓碑始终保留，迟到响应不会复活提示。重启可继续发送其他作品的待办。
- 兼容旧 Set 墓碑格式；文件损坏保留原文件并停用可选提示，不影响孩子画布。自动化缓存和家庭缓存隔离。

## 实际证据

### 18:44 真机补验完成

- 用户解锁后，珩pad `00008112-000509D9268A201E` 上 `HostDiscoveryTests` 2 项通过：真实发现 Bonjour 并核对主机身份。
- 经 USB 地址 `169.254.232.183` 运行 `LineScaffoldTests` + `ScaffoldRevocationTests`，9 项全部通过，无跳过。含持久化队列恢复、离线故障注入、409、成功回执丢失、补同步不重复写入。
- `HostDiscoveryUITests` 真机 1 项通过，自动填入 `.local` 地址，不自动开麦。截图 `evidence/2026-09-22-host-sync/bonjour-device.png`。
- 共 12 项真机测试通过。此前锁屏阻塞已解除。家庭 LaunchAgent 已恢复，USB 地址 healthz 已验证正常。
- 边界：网络不可用由隔离服务器故障注入；没有实体拔插 USB。Bonjour 测试未禁用其他网络，因此不称作“关闭 Wi-Fi 后纯 USB mDNS”验收。
- xcresult：`/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.22_18-43-45-+0800.xcresult`（发现），`Test-ScholarPad-2026.09.22_18-44-12-+0800.xcresult`（补同步），`Test-ScholarPad-2026.09.22_18-44-31-+0800.xcresult`（界面）；同目录。

### 前一轮构建与模拟器记录

1. 后端：`host-discovery.test.ts` + `workspace-scaffold.test.ts`，7 项通过；宿主 TypeScript typecheck 通过。
2. Swift 原生核心测试：9 项通过，含真实 HTTP 故障注入：断网撤销 → 重建客户端 → 409 冲突 → 服务端成功但回执丢失 → 再同步确认。服务端 journal 最终 revision=5；一次并发选择、一次撤销，未重复写入。测试服务禁止调用模型，全部数据在临时目录。
3. Bonjour 实网：模拟器原生测试两项通过，真实发现 Mac 广播、解析 `.local` 并核对 healthz 编号。
4. SwiftUI 自动化：自动发现并填入 `.local` 地址，通过；截图 `evidence/2026-09-22-host-sync/bonjour-ui.png`。这是模拟器截图，不是真机截图。
5. 损坏撤销文件的回归用例先红后绿；日志一并保留。首次故障注入因测试服务器尚未成功启动而失败，修正工具依赖解析后重跑通过；首次 UI 用例错误地读取空白首页不存在的语音按钮，修正前置条件后通过。
6. 真机最终 build 成功，已安装 `com.houbin.aischolar.pad`，安装数据库序号 3000。真机 XCTest 被锁屏阻止，未记为通过；没有完成纯 USB Bonjour 真机验收，也没有拔线/插线实体测试。

日志见 `evidence/2026-09-22-host-sync/`。完整 xcresult：

- `/tmp/ai-dtl-own-question-sim/Logs/Test/Test-ScholarPad-2026.09.22_18-33-39-+0800.xcresult`：Bonjour 原生。
- `/tmp/ai-dtl-own-question-sim/Logs/Test/Test-ScholarPad-2026.09.22_18-40-34-+0800.xcresult`：发现界面。
- `/tmp/ai-dtl-own-question-sim/Logs/Test/Test-ScholarPad-2026.09.22_18-41-14-+0800.xcresult`：最终 9 项核心/故障测试。

## 运行状态与继续真机验收

已停止隔离测试服务器并恢复家庭 LaunchAgent `com.houbin.ai-dtl.learning-tutor`。家庭数据未用于故障测试。当前 USB 主机地址为 `169.254.232.183`，下次需要重新核实。

真机解锁后先打开正式 App，核对“已发现学习主机”和 `.local` 地址，不要求用户手填新 IP。多网卡/纯 USB 是否允许 mDNS 必须在该 iPad 实测；发现被网络阻止时仍可手填。

故障测试重跑：先停家庭 LaunchAgent，运行 `node --import tsx tools/serve-revocation-test.mjs`（每轮新进程，生成全新临时目录）；以 `TEST_RUNNER_AI_DTL_REVOCATION_HOST=<Mac当前USB地址>` 和合法 UUID 的 `TEST_RUNNER_AI_DTL_WORKSPACE_TEST_ID` 运行 `ScholarPadTests/LineScaffoldTests`、`ScholarPadTests/ScaffoldRevocationTests`。测试完停止该临时进程并恢复家庭 LaunchAgent，不能留下测试服务占用 8791。

## 明确边界

- 旧版本仅存 offerId 的墓碑继续阻止本机显示，但缺少作品/动作，不能凭空推断历史待同步事件。
- 尚未验证过主机编号的事件仅允许原地址重试，避免猜测发送给另一台主机；已绑定编号的事件支持地址变化。
- 原主机作品删除或无法读取时保留待同步事件，不自动重建作品，也不静默丢弃。
- 此轮只覆盖提示撤销；不声称所有学习档案编辑都具备通用离线同步。
