# 跨次学习接续：实现与验证

## 本次范围

在 `codex/ipad-arrival-plan` 原工作区实现；保留既有未提交工作，未提交或推送。

- 已确认的作品从本机缓存恢复、或从作品列表重新打开后，显示“接着上次的探索”。
- 接续卡只展示最新同题同题意版本的既有孩子表达；剥离内部附加转写，最多 1000 字符，不生成能力评级或猜测遗留问题。
- 没有既有表达时明确邀请孩子自己选择继续方向，不伪造学习进度。
- “继续想一想”只收起接续卡；“回看作品历程”使用原有历程；“和老师接着聊”走原有连接入口，不自动授予教学权限。
- 新拍照清除接续标记，重新打开再次提供选择。原始照片、笔迹和既有证据格式不变。
- 语音上下文增加 `previousWork`：同题同版本、最多两条、每条最多 1000 字符，排除本轮刚提交的证据，明确历史不等于本轮表达或掌握。固定题意播报流程不变。
- 不在接续卡复制老师旧反馈：现有 feedback 缺少题意版本关联，不能据此生成跨次进度判断。

## 代码入口

- `apps/ipad/ScholarPad/ScholarPad/Session/WorkspaceResumeSummary.swift`
- `apps/ipad/ScholarPad/ScholarPad/Session/WorkspaceResumeView.swift`
- `apps/ipad/ScholarPad/ScholarPad/Session/ProblemCaptureModel.swift`
- `apps/ipad/ScholarPad/ScholarPad/Session/LearningWorkspaceView.swift`
- `apps/agent-host/src/ai/workspace-resumption.ts`
- `apps/agent-host/src/ai/workspace-voice-route.ts`

## 已取得的验证

1. 新 TS 和 Swift 测试先执行，分别暴露缺失模块、缺失接续类型与状态；随后实现。
2. 后端 resumption / voice-route / portfolio / teaching-context 共 13 项通过；`tsc --noEmit` 通过。语音测试走实际 WebSocket 和本地持久化，模型为替身；验证旧表达进入上下文、本轮证据不重复作为历史、恢复连接不自动回复。
3. Swift Resume / Portfolio / Cache 共 9 项通过，0 失败。包含同题意版本过滤、空表达不编造、关闭接续卡不改变缓存笔迹。
4. 真机目标构建成功：`/tmp/ai-dtl-device-sep20/Build/Products/Debug-iphoneos/ScholarPad.app`。这不是安装或真机体验通过。

日志：`/tmp/ai-dtl-resume-red.log`、`/tmp/ai-dtl-resume-green.log`、`/tmp/ai-dtl-resume-device-build-final.log`。

## 界面结果

`LearningWorkspaceUITests/testResumeWorkWithoutAutomaticVoice` 通过（36.214 秒，0 失败）：合成照片、自主提问、确认、画一笔、重启、历程入口、独立继续、横竖屏切换。

首次 UI 回归暴露 SwiftUI 外层标识覆盖子按钮标识；已移除外层标识，保留三个按钮独立标识，随后完整流程通过。中间一次复跑被上一轮测试进程清理中断，不计为通过；最终单独运行通过。

通过日志：`/tmp/ai-dtl-resume-ui-final.log`；原始结果：`/tmp/ai-dtl-own-question-sim/Logs/Test/Test-ScholarPad-2026.09.26_15-10-46-+0800.xcresult`。横屏 App 局部截图有旋转裁剪问题，改用整屏截图后复跑再次通过（36.161 秒）；最新日志 `/tmp/ai-dtl-resume-ui-evidence.log`，最新结果 `/tmp/ai-dtl-own-question-sim/Logs/Test/Test-ScholarPad-2026.09.26_15-12-31-+0800.xcresult`。

已导出并检查截图，均为合成测试内容：

- [横屏：恢复笔迹，未开麦](evidence/2026-09-26-learning-resumption/5E2604F4-C4B7-4784-B617-A5EFFE52A971.png)
- [竖屏：再次打开的接续选项](evidence/2026-09-26-learning-resumption/00FB1C45-ED62-472E-8EEA-3513F7697B36.png)
- [附件清单](evidence/2026-09-26-learning-resumption/manifest.json)

本轮设备清单显示真实 iPad `00008112-000509D9268A201E` unavailable；未向其他设备安装。尚未做本轮真人语音、真实 Pencil 或孩子学习效果验收，不将工程测试表述为教学效果证明。

测试服务使用 `::1:8791`、临时目录 `ai-dtl-own-question-ui-*`，不调用模型、不接触家庭资料；测试结束已停止该临时服务。家庭服务仍使用 IPv4 的 8791，已重启加载新代码，`/healthz` 返回 `status=ok, configured=true`，hostId 未变。

## 接下来

设备重新可用时安装上述包，验收实际“退出后回来继续”。后续再讨论有证据支撑的复习建议；本批不增加自动错题判定、间隔复习调度或新记忆引擎。
