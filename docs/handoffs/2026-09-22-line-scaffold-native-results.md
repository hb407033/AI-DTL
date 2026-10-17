# 线段辅助教学：原生接线与验证

日期：2026-09-22；分支 `codex/ipad-arrival-plan`。未提交或推送；保留工作区原有修改。

## 已实现

- Swift 原生邀请卡：明确同意后生成，拒绝不生成；独立提示区可点选等分、查看精确数量、隐藏、纠正。
- 提示不写 PKDrawing。提交图片新增独立的老师提示记录区域，标注状态、整体、等分和孩子在提示上的选择，不冒充独立解法。
- 当前作品/题意/证据/反馈绑定；旧 journal 不覆盖新版本；撤下标记本机持久化，网络迟到和重开不复活。
- 语音收到 scaffold 事件更新提示；后续教学上下文区分老师提示与孩子原稿，隐藏/失效不可继续使用。

## 实际发现并修复

1. 设备原地址 `169.254.121.209` 已失效，当前 Mac USB 地址 `169.254.42.167`；8791 无进程。已恢复家庭宿主，健康检查 ok。真机因锁屏未成功启动，新地址尚未在 App 内确认。
2. 真实千问连续返回全 null 字段，不能靠重试当作通过。旧文本提取路径把材料仅放 session.instructions，提交静音音频。改为 `conversation.item.create` 的 `input_text` 用户消息后，同一真实探针通过；保留图片识别原协议。新增协议测试先失败再通过。不换模型、不使用预制图兜底。
3. SwiftUI 父级 accessibilityIdentifier 覆盖子按钮，UI 自动化定位失败。移除父级标识后，原用例完整通过。

## 验证及证据

- 后端 7 文件 38 项通过，typecheck 通过：`evidence/2026-09-22-line-scaffold/ai-dtl-scaffold-backend-complete.log`。
- 原生选定测试共 13 项：11 通过、2 项原有条件跳过，不算全量通过。含 4 项提示状态、4 项快照测试及语音相关测试。日志 `ai-dtl-line-final-tests.log`。
- 真实千问探针：whole=1、unit=升、partitions=2、来源引用保留、精确每份1/2。`ai-dtl-line-probe-input-text.log`。
- 模拟器 UI 用例 36.970 秒通过：真实千问理解→原生同意→真实生成→选中半升→隐藏→重开无提示且未开麦；另一作品同意后立即纠正→重开无旧邀请/图。
- UI 后检查权威存档：`line-ui-hide` revision5/status hidden/selectedParts[0]；`line-ui-correct` revision3/status invalidated/无生成图形。测试目录 `/var/folders/h0/9hs2mkcj5tsd_v8nvjb9jy5r0000gn/T/ai-dtl-line-ui-uFiQuL`。
- 截图在 `evidence/2026-09-22-line-scaffold/ui/`。这是合成表达+真实上游+原生界面，不是连续真人语音或 Pencil 教育效果证明。测试照片是空白占位图，不是 OCR 验证。
- 真机 build 通过，首次新版安装成功；随后启动因 CoreDevice4016，连接恢复后得到明确 Locked 拒绝。最终辅助功能修正版再次安装成功（databaseSequenceNumber 2928），不把安装等同真机验收。

## 继续任务

1. 真机解锁后启动并确认新USB地址，保留家庭照片；测试结束恢复家庭宿主，不让隔离会话污染家庭目录。
2. 同一个真实语音求助过程验证邀请投递、Pencil继续表达、隐藏后的迁移表达，而非仅预置合成证据的UI测试。
3. 补离线撤销的主机补偿重试：当前本机撤下可持久化且不会复活，但失败时没有自动后台补偿队列。不得宣称离线撤销已与主机同步。
4. 目前快照含提示的文本结构/状态，不含提示的几何截图；继续验证模型实际区分提示与笔迹，不以提示选择算独立掌握。
5. 解决宿主退出/USB地址漂移造成的日常可用性问题，避免再次让孩子面对无服务的入口。

家庭宿主已从隔离测试切回 `node --env-file-if-exists=.env.ai.local --import tsx apps/agent-host/src/ai/learning-tutor.ts`，日志 `/tmp/ai-dtl-family-host-sep22-restored.log`。再次接手须重新查服务和USB地址，不能使用旧PID或假定地址固定。

17:49最终检查：设备恢复可启动；最终修正版已在真机启动。USB地址再次从169.254.42.167变为169.254.232.183，后者健康检查ok。用新地址启动后直接截图核实输入框为169.254.232.183，用户原来的24×0.8照片完整保留，状态为“已恢复本机原稿；没有自动连接老师”。截图 `/tmp/ai-dtl-ipad-line-installed.png`。这关闭安装/启动阻塞，但没有替代整套真机教学验收。

协议参考：[阿里云实时模型文档](https://www.alibabacloud.com/help/zh/model-studio/realtime)。是否可用以本次相同配置下真实探针结果为准。
