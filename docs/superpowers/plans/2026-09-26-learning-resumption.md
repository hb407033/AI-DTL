# 跨次学习接续 Implementation Plan

**Goal:** 重新打开作品时，孩子能回看上次表达并自主选择继续写画、查看历程或接着交流；老师获得同题同版本的既有表达。

**Architecture:** 复用 WorkspaceRecord、本地缓存、作品历程和现有语音连接。接续卡是事实投影，不新增数据库、学习评级或自动任务。历史表达与本轮表达分开，不能借旧记录自动授权讲解。

**Tech Stack:** SwiftUI / PencilKit / TypeScript / 现有千问 Omni。

已确认的下一步在原目录串行执行，不另设平台、不自动提交。

## 步骤与验收

- [x] `WorkspaceResumeSummary.swift` / `WorkspaceResumeTests.swift`：纯函数从已确认题目中选择最新同题同版本的孩子表达，去除内部附加的转写上下文；没有表达时不补造。
- [x] `ProblemCaptureModel.swift`：缓存恢复和作品重开显示接续卡；新拍照清除接续标记；“继续想一想”只改变显示状态，原稿字节不变。
- [x] `WorkspaceResumeView.swift` / `LearningWorkspaceView.swift`：复用历程与对话入口。不开麦、不自动生成图、不丢原稿；按钮有可访问标识。
- [x] `workspace-resumption.ts` / `workspace-resumption.test.ts`：给现有语音上下文补充有编号、受长度限制的历史孩子表达，过滤旧题/旧版本；提示明确不能把历史当今天的新尝试或已掌握。
- [x] Swift 单测 9 项、相关宿主回归 13 项、类型检查、模拟器 UI 1 项通过；真机构建通过。结果见 `docs/handoffs/2026-09-26-learning-resumption-results.md`。
- [ ] 真机安装体验：本轮 iPad 不可用，未安装；待设备重连验收。

不在此批做自动错题判断、间隔复习调度、学科能力图谱；后续可用真实试用结果决定。恢复原稿不代表恢复同意，旧提示仍沿用已有失效/撤销规则。
