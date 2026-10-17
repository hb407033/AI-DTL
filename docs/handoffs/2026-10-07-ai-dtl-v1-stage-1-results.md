# AI-DTL v1 Stage 1 — 结果交付

> 执行者：Pi（modelarts/glm-5.2）
> 验证者：Codex
> 仓库：`hb-mini@10.10.10.6:/Users/hb-mini/Documents/Codex/2026-08-29/wo-yo`
> 分支：`codex/ipad-arrival-plan`，基线 HEAD `e2a14d1e43446c3e9c85b96dbd7693616b22219c`
> 日期：2026-10-07
> 约束遵守：仅在 mini 仓库源码修改；未执行 reset/clean/git add/push；保留原有脏工作区；T0–T5 连续推进；测试先行、最小实现；SSH+patch 远程编辑并校验；未切换模型、未动 Hermes/Pi、无无关改动。

## 1. 验收表 A1–A8

| 项 | 状态 | 证据 |
|----|------|------|
| A1 主机自动提供 8791 + 首选后免手填地址 | **未通过** | `healthz` 返回 `{"status":"ok","configured":true,"hostId":"62a27a5d-588d-4807-8ad9-db981fdc8d81"}`，hostId 跨重启稳定，局域网 `10.10.10.6:8791` 可达。**LaunchAgent 自动启动被 macOS TCC 阻断**（launchd 上下文无 `~/Documents` 访问权），已 bootout 停止 respawn；手动 nohup 启动功能正常。一次性用户 GUI 授权 Documents 访问即可恢复自动启动。 |
| A2 横竖屏首屏直接书写、设置不占画布 | **通过**（单测） | 主机/单元输入移入"家长设置"sheet（`workspaceHost` 不再出现在儿童首屏）。confirmed 后画布高度 = `max(viewport × 0.6, 300)`，≥55% 视口（竖屏横屏双覆盖）。`WorkspaceCanvasLayoutTests` 3 项通过（55% 覆盖各视口、下限 300、60% 正常视口）。模拟器构建通过。**真机视觉验证未执行。** |
| A3 一次开启对话连续五轮不重连 | **通过**（单测） | `conversation-policy.ts` 纠正开头检测（"你理解错了"/"不是这个意思"+内容→correct）；"我想想先别说"→pause；dialogue 模式禁用 OneAnswerFollowup（continuation=false，不追问）。`workspace-dialogue-open.test.ts` 3 项通过（五轮开放交换、打断边界、题意版本变更边界）。Swift `WorkspaceClient.connect` 携带 `conversationMode:"dialogue"`。**真实 iPad 五轮端到端未执行。** |
| A4 明确纠正一次旧反馈失效、打断不播迟到音频 | **通过**（单测） | `workspace-conversation-correct.test.ts` 2 项路由级测试通过：纠正取消旧响应+contested+迟到音频拒绝+对话继续；pause 不教学不自动开麦。既有 `WorkspaceVoiceTests` interrupt/corrected 全通过。**真实设备取证未执行。** |
| A5 暂停后继续写画、重开保留原图原稿不自动开麦 | **未执行** | pause 语义已接通（后端发 `paused`，客户端 `pause()` 关麦）。`WorkspaceResumeTests` 3 项通过。**真实设备往返取证未执行。** |
| A6 主机不可达时本机保存、重连显式同步不覆盖 | **通过**（单测） | 既有实现复核：`WorkspaceCache` 含 `pendingSave`/`pendingEvidence`/`pendingOwnQuestion` 待同步字段、`archiveConflict(local:remote:)` 保留双方副本、原子写。后端 `workspace-store.save` 乐观并发（`staleRevision`/`eventConflict`/`deleted`/`corruptExisting`）已有测试。新增 `WorkspaceCacheIsolationTests` 5 项通过：冲突保留双方副本、冲突不腐蚀 current、pendingSave 跨重启、多会话归档共存、两次冲突不覆盖。**真机离线往返未执行。** |
| A7 usage 记录、缺失/失败如实标记、重放不重复 | **通过** | `workspace-voice-provider.ts`：每次调用独立 `callId`（重试不同）；路由传入 `VoiceCallContext`（sessionId/turnId）；`emitUsage` 用 `usageEmitted` flag 防双计；response.done 仅 completed 发用量，非 completed 由 catch 发 failed；ASR-only 发 `usage=null`（不记 0）；abort→cancelled，断线→failed。`learning-tutor.ts` 从 URL query 提取非敏感 model 字段（缺失记 `unknown`），不再空串/硬编码。`workspace-voice-usage.test.ts` 5 项通过（含取消/失败/重试不同 callId/重复 done 不双计/缺失 null）。`workspace-usage-integration.test.ts` 1 项通过（实际路由 JSONL 非空 sessionId/turnId/callId 关联）。 |
| A8 可安装 App + 宿主版本/源码指纹 | **未执行** | `tools/phase1-release-manifest.mjs`：`model` 字段默认 `unknown`，支持显式 `options.model` 或环境 `AI_DTL_MODEL_LABEL`，不读密钥。单测通过（含 model 默认 unknown + 显式覆盖）。已生成清单 `docs/handoffs/release-manifest-v1-stage-1.json`。ScholarPad **模拟器构建成功**。**真实 iPad 安装未执行。** |

## 2. 测试结果

### 后端（mini，`/opt/homebrew/bin/node` v26，pnpm 11.1.2）
- `@ai-scholar/session-contracts`：**35 通过**（4 文件）。
- `@ai-scholar/agent-host`：**219 通过**（46 文件），`tsc --noEmit` 干净。
- `@ai-scholar/learning-kernel`：364 通过 / 1 失败（`ledger-authority` 超时 5s，**基线既有、与本次改动无关**，未触及该包）。
- `tools/codex-realtime-probe`：16 通过。

### iOS（笔记本隔离构建目录 `/tmp/ai-dtl-v1-stage1-build`，Xcode 27.0，模拟器 iPad Pro 11-inch M5）
- ScholarPad App **构建成功**（`BUILD SUCCEEDED`）。
- `ScholarPadTests`：163 项，5 skipped，**4 失败**全在 `SessionProtocolTests`。**已确认基线 `e2a14d1` 上同样 4 项失败**（隔离基线构建复现），非本次改动引入。
- `TutorTurnDetectorTests`：**6 通过**。
- `WorkspaceCacheIsolationTests`：**5 通过**（新增）。
- `WorkspaceCanvasLayoutTests`：**3 通过**（新增）。
- `WorkspaceResumeTests`/`WorkspaceVoiceTests`：全通过（2 项声学/麦克风 skipped 需真机）。

### 运行主机
- `curl 127.0.0.1:8791/healthz` → `{"status":"ok","mode":"learning-tutor","configured":true,"hostId":"62a27a5d-...","discoveryVersion":1}`。

## 3. 修改/新增文件（均在 mini 仓库，未 commit）

**新增**
- `scripts/run-learning-host.sh`
- `deploy/macos/com.houbin.ai-dtl.learning-tutor.plist`
- `apps/agent-host/src/learning/conversation-policy.ts` + `test/conversation-policy.test.ts`
- `apps/agent-host/test/workspace-conversation-mode.test.ts`
- `apps/agent-host/test/workspace-conversation-correct.test.ts`
- `apps/agent-host/test/workspace-dialogue-open.test.ts`
- `apps/agent-host/src/ai/workspace-usage.ts` + `test/workspace-usage.test.ts`
- `apps/agent-host/test/workspace-voice-usage.test.ts`
- `apps/agent-host/test/workspace-usage-integration.test.ts`
- `tools/phase1-release-manifest.mjs` + `tools/phase1-release-manifest.d.mts` + `apps/agent-host/test/phase1-release-manifest.test.ts`
- `apps/ipad/ScholarPad/ScholarPad/Session/WorkspaceParentSettingsView.swift`
- `apps/ipad/ScholarPad/ScholarPadTests/WorkspaceCacheIsolationTests.swift`
- `apps/ipad/ScholarPad/ScholarPadTests/WorkspaceCanvasLayoutTests.swift`
- `docs/handoffs/release-manifest-v1-stage-1.json`

**修改**
- `packages/session-contracts/src/workspace-learning.ts`（hello 增加可选 `conversationMode`，向后兼容）+ `test/workspace-learning.test.ts`
- `apps/agent-host/src/ai/workspace-voice-route.ts`（接 conversationAction，跟踪 mode/problem/revision，pause 发 `paused`；dialogue 禁用 OneAnswerFollowup；transcribe/respond 传 VoiceCallContext）
- `apps/agent-host/src/ai/workspace-voice-provider.ts`（`VoiceCallContext` + `callId` + `usageEmitted` 防双计 + fail/cancel/ASR-only 记录 + status 映射）
- `apps/agent-host/src/ai/learning-tutor.ts`（接线 usage.jsonl，从 URL 提取 model，非空 sessionId/turnId/callId）
- `apps/ipad/ScholarPad/ScholarPad/Session/TutorTurnDetector.swift`（`silenceBytes` 可注入，reset 保留配置）+ `ScholarPadTests/TutorTurnDetectorTests.swift`
- `apps/ipad/ScholarPad/ScholarPad/Session/LearningWorkspaceView.swift`（host/unit 移入家长设置 sheet；"开启对话"传 `dialogue`；confirmed 后 canvas 高度 ≥55% 视口）
- `apps/ipad/ScholarPad/ScholarPad/Session/WorkspaceClient.swift`（`connect` 增 `conversationMode`，hello 携带，入站 `paused`→`pause()`）

## 4. 已知限制与未完成项

1. **A1 自动启动**：LaunchAgent 受 TCC 阻断，需一次性 GUI 授权 `~/Documents`。功能验证（healthz/hostId/LAN）通过。
2. **A3–A5 真机取证**：需真实 iPad（UDID `00008112-000509D9268A201E`）端到端试验，本次仅完成单测/集成测与模拟器构建。
3. **A8 真机安装**：仅模拟器构建；未在真机安装启动。
4. **模型**：发布清单 `model` 字段默认 `unknown`，支持显式 `options.model` 或环境 `AI_DTL_MODEL_LABEL`（非敏感）。运行用量从 URL query 提取 model（非敏感），缺失记 `unknown`。工具不读 `.env.ai.local`，按约束未读取/修改该文件。功能测试与模型无关（使用 mock provider）。
5. **SessionProtocolTests 4 项失败**：基线既有，非本次引入。
6. **learning-kernel 1 项超时**：基线既有/环境性，非本次引入。

## 5. 复现命令

```bash
# 后端测试（mini）
export PATH=/opt/homebrew/bin:$PATH
cd /Users/hb-mini/Documents/Codex/2026-08-29/wo-yo
CI=true pnpm --filter @ai-scholar/session-contracts test
CI=true pnpm --filter @ai-scholar/agent-host test
pnpm --filter @ai-scholar/agent-host exec tsc --noEmit

# 发布清单（model 默认 unknown；可显式传 AI_DTL_MODEL_LABEL）
node --import tsx tools/phase1-release-manifest.mjs

# iOS 构建+单测（笔记本，隔离目录）
cd /tmp/ai-dtl-v1-stage1-build/apps/ipad/ScholarPad
xcodegen generate
xcodebuild -project ScholarPad.xcodeproj -scheme ScholarPad \
  -destination "id=B6F3EE05-7E7E-422E-A40E-43725F2DB975" \
  -derivedDataPath /tmp/ai-dtl-dd test \
  -only-testing:ScholarPadTests/WorkspaceCanvasLayoutTests \
  -only-testing:ScholarPadTests/WorkspaceCacheIsolationTests
```
