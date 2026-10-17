# 2026-10-09 Photo Closure Review — 5 Blocker Fixes

**Implementer**: Pi (modelarts/glm-5.2)
**Verifier**: Codex
**Date**: 2026-10-09
**Base**: `e2a14d1e43446c3e9c85b96dbd7693616b22219c` on `codex/ipad-arrival-plan`
**Repo**: mini `hb-mini@10.10.10.6:/Users/hb-mini/Documents/Codex/2026-08-29/wo-yo`

## 5 Blockers → Status

### Blocker 1: PendingPhotoRecognition host binding ✅
- `PendingPhotoRecognition` 新增 `host: String?` 字段（optional，旧缓存解码兼容）。
- `usePhoto()` 创建 pending 时绑定 `host: hostTrimmed`。
- 重试前检查 `pending.host != hostTrimmed`：
  - `pending.host == nil`（旧缓存）→ 清 pending，保留照片，提示"旧缓存缺主机，照片保留"。
  - `pending.host != hostTrimmed`（换主机）→ 清 pending，保留照片，提示"已换主机，照片保留"。
  - 两种情况都不发送任何 HTTP 请求。

### Blocker 2: Recognize receipt validation ✅
- `usePhoto()` 收到 recognize 回执后校验：
  1. `sessionId == pending.sessionId`
  2. `photoId == pending.photoId`
  3. `source == "camera"`
  4. `curriculum.currentUnit == pending.unit`
  5. `statement.confirmed == false`
- 任一不匹配 → throw `WorkspaceError.invalidRecord`，不清除 pending，不设置 record。

### Blocker 3: Upload injection → Transport ✅
- 删除 `Upload` typealias、`upload` 属性、`uploadPhoto` 静态方法。
- 新增 `typealias Transport = @MainActor (URLRequest) async throws -> (Data, URLResponse)`。
- `init(transport: Transport? = nil, ...)` — 默认用 `URLSession.shared.data(for:)`。
- `request` 拆为三层：
  - 实例 `private func request(...)` → 委托 `Self.request(..., transport: self.transport)`
  - 静态 `static func request(...)` → 默认 transport（`InquiryJournalModel` 等外部调用者用）
  - 静态 `static func request(..., transport: Transport)` → 实际实现
- `saveRecord` 改为 `private static func saveRecord(..., transport: Transport)`。
- 默认 `save`/`fetch` 闭包捕获 `transport` 值（非 `self`），避免 init 顺序问题。

### Blocker 4: `server(Int, String?)` backward compatibility ✅
- 新增 `static func server(_ code: Int) -> WorkspaceError { .server(code, nil) }`。
- 旧 `.server(409)` 调用自动走单参数重载。
- 已更新的两参数 `.server(409, reason)` 不受影响。
- 全仓库无残留单参数 `.server(` 调用（grep 确认）。

### Blocker 5: New offline unit tests ✅
- 新增 `WorkspacePhotoRetryOfflineTests.swift` — 9 个离线可控单测：

| # | 测试 | 覆盖 |
|---|------|------|
| 1 | `testUploadSuccessRecognizeFailRetryReusesSession` | 上传成功+识别失败→重试复用同一 session/photoId/previewId，不重复上传 media |
| 2 | `testRestartFromCacheReusesPending` | 重启后从缓存恢复 pending，继续重试 recognize |
| 3 | `testSwitchHostClearsPending` | 换主机不发送旧 session，清 pending，保留照片 |
| 4 | `testRejectBadSessionIdInReceipt` | 回执 sessionId 不匹配→拒绝，不清 pending |
| 5 | `testRejectBadPhotoIdInReceipt` | 回执 photoId 不匹配→拒绝 |
| 6 | `testRejectBadCurriculumInReceipt` | 回执课程不匹配→拒绝 |
| 7 | `testRejectConfirmedInReceipt` | 回执已 confirmed→拒绝 |
| 8 | `testOldCacheWithoutHostClearsPending` | 旧缓存缺 host→清 pending，保留照片，不发请求 |
| 9 | `testHappyPathClearsPending` | 正常流程→回执校验通过→清 pending，设 record |

## Test Results

### 新增/修改的定向测试（全部通过）
```
WorkspacePhotoRetryOfflineTests: 9 tests, 0 failures ✅
WorkspacePhotoRetryTests:         4 tests, 0 failures ✅
WorkspaceConfigGuidanceTests:     3 tests, 0 failures ✅
ProblemCaptureTests:              8 tests, 0 failures ✅
InquiryJournalTests:              7 tests, 0 failures ✅
LineScaffoldTests:                6 tests, 1 skipped, 0 failures ✅
```

### 后端全量（无回归）
```
agent-host: 226/226 pass (47 files) ✅
```

### ScholarPadTests 全量
```
181 tests, 5 skipped, 23 failures
```
**23 failures 全部来自 `TutorAudioTests`**（3 个测试方法的多次断言）。
- `TutorAudioTests` 和 `SimpleTutorClient` 不引用 `ProblemCaptureModel`、`WorkspaceError`、`WorkspaceModels`、`WorkspaceCache` 等本次修改的任何文件。
- `TutorAudioTests.swift` 和 `SimpleTutorView.swift` 是未跟踪文件（git status `??`），在 HEAD `e2a14d1` 时不存在，由前序会话创建。
- 失败原因是模拟器音频时序敏感（`Task.sleep` + 录音/播放状态切换），与本次代码改动无关。
- **无法对 HEAD 基线运行**：这些测试文件在 HEAD 时不存在。
- `SessionProtocolTests`（前序会话曾报 4 失败）现在 6/6 通过。

## Files Changed (this session)

| File | Change |
|------|--------|
| `WorkspaceModels.swift` | `PendingPhotoRecognition.host` 字段; `static func server(Int)` 兼容重载 |
| `ProblemCaptureModel.swift` | `Transport` 注入; 删除 `Upload`; `request` 三层拆分; `saveRecord` static; host 绑定+换主机检查; 回执校验 5 项 |
| `WorkspaceCache.swift` | (前序会话已加 `pendingPhotoRecognition` 字段) |
| `ProblemCaptureTests.swift` | `testNoUnitDoesNotSendPhoto` 改用 `transport` 注入 |
| `WorkspacePhotoRetryTests.swift` | `PendingPhotoRecognition(host:)` 签名更新 |
| `WorkspacePhotoRetryOfflineTests.swift` | **新增** 9 个离线可控单测 |

## Git State
- HEAD: `e2a14d1e43446c3e9c85b96dbd7693616b22219c` (unchanged)
- Branch: `codex/ipad-arrival-plan` (unchanged)
- 186 changed files (was 185, +1 new test file)
- No commit/push/reset/clean

## Remaining (not in scope)
- Real-device USB UI verification (Codex)
- A1 LaunchAgent TCC grant (user GUI)
- A3–A5, A8 real iPad end-to-end
