# AI-DTL 拍照选题与标题布局验收（2026-10-10）

## 本次变更

- 识别结果区分单题、多题、看不清。多题不写入题干、不替孩子选择；前端先选题，再修改、核对、确认。
- “请重新拍照”等服务说明不得保存、修改或确认为题干。候选夹入说明时整次识别失败，不静默删掉坏候选后替孩子选题。
- 多题候选持久化；重启可以接着选择。选择回执丢失后重试同一事件，不能切换另一候选误配回执，也不重新调用识别。
- 历史错误说明不会自动改写。界面明确提示重新核对，可保留照片和原笔迹修正；确认之前不进入学习画布。
- 取消工作区顶部“AI-DTL · 一起探索”导航栏。横屏仅在左栏现有栏头显示小号“AI-DTL · 当前探索”；竖屏没有单独品牌标题栏。正式名称仍为“AI 学科心智学习系统”。
- 题意编辑保存按钮改为明显按钮，保存过程及拒绝条件提供反馈，不静默无响应。

## 已取得证据

- 后端 `workspace-route.test.ts` 先出现 4 个回归失败，修复后 9 项通过。
- 后端最终命令因 pnpm 参数透传实际执行 agent-host 全套：48 文件、235 项通过。类型检查仍被既有的 `photo-learning-closure.test.ts:9,11` 两个未使用 `@ts-expect-error` 阻断，未修改无关基线。
- 真机 `photo-final-verification.xcresult`：21 项单元测试、2 项 UI 测试通过。涵盖多题重启、选择回执丢失、修改、确认、查看原照；横竖屏画布首屏面积均不小于 55%。此轮 HTTP 路由真实运行，识别器为固定合成结果。
- 另对真实 Qwen3.8 Omni Flash Realtime 运行三张合成图：单题 single/1，多题 multiple/2，空白 unreadable/0 均通过。单题样本中题号与数字存在黏连（`1.2.4`），因此仍必须人工核对，不能宣称 OCR 零误差。
- 真机自动化初次有启动超时；编辑测试遇到光标、系统全选浮层与等待条件问题，已改为实际全选、退出选择状态、等待保存后的准确题干。没有削弱题意修改断言。
- 最后换成真实 Qwen 识别器，`photo-real-qwen-device.xcresult` 真机 UI 测试通过：iPad 上传合成双题图 → 真实千问识别 → 选择第二题 → 重启保留候选 → 修改 → 确认 → 查看原照。测试服务统计 recognitions=1；持久化记录 phase=exploring、statement=`3.6 / 0.6 = ?`、revision=1、confirmed=true，photoId 保留。不是仅靠模拟识别完成验收。
- `devicectl device install app` 成功，随后无测试环境变量正常启动 `com.houbin.aischolar.pad` 成功；安装原件 `/tmp/ai-dtl-photo-final.7bIlHG/derived/Build/Products/Debug-iphoneos/ScholarPad.app`。

## 隔离、运行与边界

- 合成样本和 DEBUG UUID 草稿隔离在独立目录；未删除家庭照片、草稿或错题记录，未自动修正历史题意。
- 真机 UI 测试主机使用 8797 独立 WorkspaceStore，不占用家庭 8791 记录。DEBUG 端口覆盖仅在有效 UUID 测试环境下启用，正常启动不生效。
- 家庭学习主机当前仍是笔记本 `macbookpro.local:8791`；与 mini 的本次后端源码哈希一致后，已仅重启 `com.houbin.ai-dtl.learning-tutor`，`/healthz` 返回 configured=true。没有迁移主机或更改模型。
- mini 主源码目录 `/Users/hb-mini/Documents/Codex/2026-08-29/wo-yo`，分支 `codex/ipad-arrival-plan`，原有大量未提交变更，未设上游；`twin-status --no-fetch` 报告无法通过旧主机名连接笔记本。精确同步本次文件，不把历史未提交文件批量提交或推送。
- 本次验证不代表儿童教学效果、任意试卷 OCR 准确率、真人连续语音或 Pencil 手感已经重新验收。

## 证据位置

本机 `/Users/houbin/Library/Application Support/ai-dtl/acceptance/2026-10-10-photo-selection/`；构建及 xcresult 原件 `/tmp/ai-dtl-photo-final.7bIlHG/`。
