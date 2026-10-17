# AI-DTL 拍照体验修复与真机验证

日期：2026-10-08。品牌保持“AI 学科心智学习系统”。

## 问题与修复

1. 已确认问题的画布界面把拍照藏在“查看照片”的弹窗里。现在操作栏常驻蓝色“拍照”按钮，触控区域 44 × 44 pt，横竖屏直接可见；换题前仍确认并保留旧作品。
2. 工程未声明中文应用语言，系统相机确认页显示英文。XcodeGen 的 developmentLanguage、CFBundleDevelopmentRegion、CFBundleLocalizations 明确为 zh-Hans。无需改 iPad 系统语言或自制相机。
3. 拍照只保存本机预览，需要另外确认发送，但下一步没有突出显示。现在拍完显示“照片已拍好”、原图、本机保存且未发送的状态，以及“识别这道题”。新照片变更时回到页面顶部；识别中的进度和失败状态在原图上方展示。

保留确认发送边界：点系统相机“使用照片”不会自动上传；点应用“识别这道题”才请求主机核对题意。这是明确的下一步，不是已经完成识别。教学模型、后端、密钥和家庭档案未改。

## 真机证据

设备：珩pad，iPad14,3，UDID 00008112-000509D9268A201E。

最终命令的限定测试：

- ScholarPadTests/ProblemCaptureTests：8 项通过。
- ScholarPadUITests/PhotoEntryUITests：2 项通过。
- ScholarPadUITests/CameraLocalizationUITests：1 项通过，实际打开系统相机、按快门、确认并回到本机预览，没有上传画面。
- ScholarPadUITests/CodexCanvasPersistenceUITests：1 项通过，两种方向各四区域画线、重开保留八笔及原照。
- ScholarPadUITests/CodexResumeControlsUITests：1 项通过，两种方向的恢复入口、不开麦、画布可见面积至少 55%。

合计 13 个不同测试通过；xcodebuild 退出 0，**TEST SUCCEEDED**。单测进程在该测试运行中有重复执行，不能累计当作新增覆盖。

系统相机按钮实测日志：`Cancel:重拍`、`Done:使用照片`；未出现英文 Retake / Use Photo。

所有 UI 场景使用 UUID 隔离测试草稿，不替换家庭学习稿；系统相机测试仅留在本地隔离草稿。未运行新照片云端识别，因此这里不宣称识别准确率、识别耗时或完整教学闭环重新验收。

## 回归过程

新增测试先在旧代码上失败：常驻拍照入口不存在、没有“照片已拍好”，下一步按钮及未发送状态不清楚。

曾把相机入口放到顶部，真机测试发现恢复场景画布面积降低到 53.48%；收紧后仍为 54.61%，增加不生效的画布下限也未解决。没有放宽 55% 验收线。最终改为复用既有操作栏高度，移除顶部入口和无效下限，原回归测试通过。

## 文件与归档

主仓库：Mac mini `/Users/hb-mini/Documents/Codex/2026-08-29/wo-yo`。

分支：`codex/ipad-arrival-plan`，保留原有未提交工作，未批量提交、推送或切换主干。

本次变更：

- `apps/ipad/ScholarPad/ScholarPad/Session/LearningWorkspaceView.swift`
- `apps/ipad/ScholarPad/ScholarPad/Session/ProblemCaptureModel.swift`
- `apps/ipad/ScholarPad/project.yml`
- `apps/ipad/ScholarPad/ScholarPad/Info.plist`（XcodeGen 生成）
- `apps/ipad/ScholarPad/ScholarPadUITests/PhotoEntryUITests.swift`
- `apps/ipad/ScholarPad/ScholarPadUITests/CameraLocalizationUITests.swift`（模拟器明确跳过相机硬件测试）

在笔记本的独立源码快照构建；与 mini 上上述生产源码 SHA-256 已逐一核对一致。构建签名团队保持 YZQ2T35W5C，codesign 严格校验通过。

归档目录（两台机器对应的用户 Library）：`Library/Application Support/ai-dtl/acceptance/2026-10-08-photo-flow`。

开发安装包：`AI-DTL-photo-flow-development.ipa`，SHA-256：`3f50dcfa6c659dce6afc062655e818087859861f804eaf88bfc192fd59c8d3ea`。

最终版本已通过 devicectl 覆盖安装并正常启动 `com.houbin.aischolar.pad`，没有删除应用或家庭数据。

主机归档 `source-before` 留有本次修改前四个生产文件的副本，不覆盖其他未提交变更。日志同时保留红灯、布局回归失败与最终通过的证据；不复制 Xcode 自动收集的设备诊断压缩包。

主机 `/healthz` 检查仍为 learning-tutor、configured=true。已知 twin-status 脚本存在 unbound variable 错误，不能把它报告为双机同步检查通过；本次采用明确路径与源码哈希核对。
