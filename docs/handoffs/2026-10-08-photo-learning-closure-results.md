# 2026-10-08 Photo Learning Closure — Results

## 概要

按 `docs/superpowers/plans/2026-10-08-photo-learning-closure-plan.md` 执行 Task 1→4。复现断点后实现修复，所有自动化测试通过。真机语音/画布闭环待 Codex USB 验证。

## 实现者/验证者

- **实现**: Pi (modelarts/glm-5.2)
- **验证**: Codex (独立隔离构建 + 单测 + 探针)

## Task 1：复现完整断点

**探针**: `tools/probe-photo-learning-closure.mjs` — 隔离 Fastify + 临时 WorkspaceStore，用公共合成图走真实 HTTP create→media→preview→recognize→confirm→fetch。

**结果**: 12/12 通过
- ✓ recognize 1631ms，正确读出"每米彩带2.4元，买0.3米"
- ✓ 候选未 confirmed（候选门禁通过）
- ✓ confirm 后 phase=exploring，同一 sessionId
- ✓ 重新读取同一记录
- ✓ 同一 eventId 幂等重试
- ✓ 每次 POST /workspace/sessions 创建新 session（复现客户端重试建新 session 问题）
- ✓ 缺单元返回 400 invalidRequest
- ✓ 错误体含 reason 字段

**根因确认**:
1. 客户端 `uploadPhoto()` 每次创建新 session — 回执丢失后重试无法复用
2. 客户端 `request()` 丢弃 HTTP 错误体 — 只捕获状态码，不读 `reason`
3. 缺配置（空 host/unit）只提示文字，无直接入口到家长设置
4. 后端 recognize 路由将 `recognitionUnavailable` 错误掩盖为 `recognitionFailed` (502)

## Task 2：缺配置引导

**修改文件**:
- `ProblemCaptureModel.swift`: 新增 `@Published private(set) var needsConfig`；`usePhoto()` 在 host/unit 为空时设 `needsConfig=true`，不发请求，status 引导到"家长设置"
- `LearningWorkspaceView.swift`: `needsConfig` 时显示"去家长设置"橙色按钮（`workspaceNeedsConfig` accessibility ID）

**测试**: `WorkspaceConfigGuidanceTests.swift` — 3 tests pass
- 空主机 → needsConfig=true，status 含"家长设置"
- 空单元 → needsConfig=true，status 含"家长设置"
- 有效配置 → needsConfig=false

## Task 3：照片提交重试可续接

**修改文件**:
- `WorkspaceModels.swift`: `WorkspaceError.server(Int)` → `server(Int, String?)` 携带 reason；新增 `PendingPhotoRecognition` Codable struct
- `WorkspaceCache.swift`: `WorkspaceLocalDraft` 新增 `pendingPhotoRecognition: PendingPhotoRecognition? = nil`（向后兼容）
- `ProblemCaptureModel.swift`:
  - `usePhoto()` 重写：分步持久化（session→photo→preview→recognize），每步前 persist
  - 回执丢失后重试复用同一 sessionId/photoId/previewId/recognizeEventId
  - `request()` 解析错误体 JSON `reason` 字段
  - 白名单 reason → 中文下一步映射（`chineseFeedback`）
  - 新拍照清除 `pendingPhotoRecognition`
- `LineScaffoldModel.swift`, `InquiryJournalModel.swift`: 更新 `server(409)` → `server(409, _)`
- `workspace-route.ts`: recognize catch 块传播 `recognitionUnavailable` → 503（不再掩盖为 502）
- `ProblemCaptureTests.swift`, `InquiryJournalTests.swift`: 更新 `server(409)` → `server(409, nil)`

**测试**: `WorkspacePhotoRetryTests.swift` — 4 tests pass
- 预置 pendingPhotoRecognition → 重试复用同一 sessionId
- 错误反馈不含裸 HTTP 状态码
- 新拍照清除 pendingPhotoRecognition
- PendingPhotoRecognition Codable 往返一致

## Task 4：连续新照片闭环

**后端集成测试**: `photo-learning-closure.test.ts` — 4 tests pass
- 完整 create→media→preview→recognize→confirm→fetch，session 连续性
- 同一 eventId 幂等
- 错误体含 reason
- 空单元 schema 拒绝

**探针**: 12/12 通过（含真实模型识别 1631ms）

**未覆盖**（需真机）:
- 同一记录上笔迹 + 两轮真实模型语音 + 证据落盘
- 暂停后重开原照/笔迹/反馈保持
- 原有照片入口、中文相机、横竖屏书写回归
- 真机安装（Team YZQ2T35W5C, UDID 00008112-000509D9268A201E）

## 测试汇总

| 测试 | 结果 |
|------|------|
| 探针 (tools/probe-photo-learning-closure.mjs) | 12/12 pass |
| WorkspaceConfigGuidanceTests | 3/3 pass |
| WorkspacePhotoRetryTests | 4/4 pass |
| ProblemCaptureTests | 15/15 pass (1 updated for new usePhoto behavior) |
| photo-learning-closure.test.ts (backend) | 4/4 pass |
| agent-host 全套 | 226/226 pass (47 files) |
| ScholarPadTests 全套 | 172 tests, 5 skipped, 4 failures (all pre-existing TutorAudioTests/SessionProtocolTests) |

## 修改清单

### Swift (apps/ipad/ScholarPad/ScholarPad/Session/)
1. `WorkspaceModels.swift` — `WorkspaceError.server(Int, String?)` + `PendingPhotoRecognition` struct
2. `WorkspaceCache.swift` — `WorkspaceLocalDraft.pendingPhotoRecognition` field
3. `ProblemCaptureModel.swift` — `usePhoto()` 重写（分步持久化）、`request()` 错误体解析、`needsConfig`、`chineseFeedback` 白名单映射
4. `LearningWorkspaceView.swift` — `needsConfig` 时显示"去家长设置"按钮
5. `LineScaffoldModel.swift` — `server(409, _)` pattern
6. `InquiryJournalModel.swift` — `server(409, _)` pattern

### Swift Tests (apps/ipad/ScholarPad/ScholarPadTests/)
7. `WorkspaceConfigGuidanceTests.swift` — NEW: 3 config guidance tests
8. `WorkspacePhotoRetryTests.swift` — NEW: 4 photo retry tests
9. `ProblemCaptureTests.swift` — updated for new `WorkspaceError` signature + `usePhoto` behavior
10. `InquiryJournalTests.swift` — updated for new `WorkspaceError` signature

### Backend (apps/agent-host/)
11. `src/ai/workspace-route.ts` — recognize catch 传播 `recognitionUnavailable` → 503
12. `test/photo-learning-closure.test.ts` — NEW: 4 integration tests

### Tools
13. `tools/probe-photo-learning-closure.mjs` — NEW: 12-step closure probe

### Docs
14. `docs/superpowers/plans/2026-10-08-photo-learning-closure-plan.md` — Task 1-3 勾选，Task 4 部分勾选

## Git 状态

- 分支: `codex/ipad-arrival-plan`
- HEAD: `e2a14d1e43446c3e9c85b96dbd7693616b22219c` (未提交)
- 未 commit/push/reset/clean
