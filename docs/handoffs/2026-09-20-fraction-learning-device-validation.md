# 分数探索：2026-09-20 真机接续验证

## 范围与基线

- 沿用已确认的分数学习闭环和千问 Omni，不替换模型/平台。
- 分支 `codex/ipad-arrival-plan`，接手 HEAD `e2a14d1`。工作区有其他 agent 大量已修改及未跟踪文件，全部保留；本轮不提交、不推送。
- 本记录补充 `2026-09-17-fraction-learning-integration.md`，不是整套学习系统已验收声明。
- 设备：珩pad，`00008112-000509D9268A201E`；Bundle `com.houbin.aischolar.pad`；Team `YZQ2T35W5C`。
- Xcode 已在 `/Applications/Xcode.app/Contents/Developer`，旧 Downloads 路径失效。不要照旧记录设置 DEVELOPER_DIR。
- 本次 USB Mac 地址 `169.254.187.130`（en22），不是固定配置；每轮先确认可达地址。
- 本轮启动并在修复后重启的只有 `pnpm host:learning`（8791）；密钥由现有本地配置加载，不回显、不写入文档。

## 本轮修复

### 1. 后台返回必须回到手动继续入口

`FractionLearningModel.leaveForBackground()` 原先保存并断开后仍停留在 active 页面，用户无法从页面恢复连接。

现在取消延迟保存、保存草稿、断开连接、切回 entry 并准备恢复摘要。重新进入 App 不自动连接，点击继续才恢复。

- 新测试 `testBackgroundReturnsToManualResumeEntryAndKeepsDraft` 先失败（stage 仍为 active、摘要为空），修复后通过。
- 真机 UI 测试实际执行开始 → 加纸 → Home → 重新激活 → 手动继续 → 再次连接成功。

### 2. 按钮提交图片的真实 Omni 协议错误

模拟服务原先接受图片后立即 response.create，因此漏掉真实上游约束。真实提交复现：宿主 accepted 后关闭，直连上游得到 `Error append image before append audio.`。

现在按钮提交按顺序执行：

1. 无已有音频时先放 200ms/6400 bytes PCM16 16kHz 静音作为协议载体；不作为孩子发言或学习证据保存。
2. 图片追加与结构化文字证据发送。
3. audio buffer commit。
4. 等 `input_audio_buffer.committed` 后才 response.create。

新增 committing 状态；等待确认期间打断则不生成回答，迟到确认不会重新启动回答；等待期间不接受新的提交/求助。

- 两个协议回归测试先红后绿；模拟上游现在模拟 committed 确认。
- 真实 8791 → Omni 合成白图提交返回 completed、26 个音频片段和可见转写。
- 注意：该白图探针中模型仍推测了孩子未实际表达的意图，**链路通过不代表证据约束/教学质量通过**。下一轮需验证空白/含糊证据先澄清，禁止把题干当成孩子想法。

### 3. 真机测试入口

UI 测试改用 `TEST_RUNNER_AI_DTL_TEST_HOST`，缺少环境变量时显式跳过，不再硬编码过期 USB 地址。
恢复后新增一次真实按钮提交、等待可见老师回复的检查；会发生一次实际模型调用。

## 验证记录

| 项目 | 本轮证据 |
| --- | --- |
| 后端相关回归 | 6 文件 68 项通过：fraction-session、restore、store、learning-tutor、tutor-store、actions |
| 后端类型检查 | `pnpm --filter @ai-scholar/agent-host typecheck` 通过 |
| 真机原生单元测试 | FractionBoard 17 + Client 11 + Cache 14 + View 9 = 51 项通过；随后含新后台回归的 View 套件 10 项通过 |
| 真机连接/后台/手动恢复 UI | 1 项通过，日志 `/tmp/ai-dtl-sep20-ui-final.log` |
| 真机按钮提交/可见回复 UI | 1 项通过，0 失败，29.668 秒；实际点击后收到非空 fractionReply。测试只等待首段可见回复，不声称整段语音现场听验通过 |
| 真实模型返回音频 | 合成证据探针收到 26 个音频片段；不等于现场听音验收 |
| 真人教学、Pencil 手感、实际扬声器听音 | 本轮未验收 |

日志：`/tmp/ai-dtl-sep20-unit.log`、`/tmp/ai-dtl-sep20-background-red.log`、`/tmp/ai-dtl-sep20-background-green.log`、`/tmp/ai-dtl-sep20-ui-submit.log`。临时路径会清理，关键结论保存在本文。第一次 UI 测试与单元测试同时安装同一个设备 App，导致 UI 会话被终止；串行重跑通过，不能把该次环境冲突记作产品崩溃。

已导出并人工查看自动化截图 `/tmp/ai-dtl-sep20-attachments/678CAACD-04F6-4882-9870-8755B98F71A8.png`：画布保留一个两列未涂色矩形，回复为“我看到你把纸分成了两半，但没有涂色。你是想先看看这两张纸是不是一样大吗？”说明实际截图证据进入回复，但后半句仍是待孩子确认的推测，不能记为学习事实。截图中有黑色留白，本轮没有据此验收横竖屏适配。

## 复跑入口

仓库根启动 `pnpm host:learning`，确认 `http://127.0.0.1:8791/healthz` configured=true。确认 iPad 解锁、地址可达。在 `apps/ipad/ScholarPad` 执行（HOST 替换为本次地址）：

```sh
TEST_RUNNER_AI_DTL_TEST_HOST=HOST xcodebuild -project ScholarPad.xcodeproj -scheme ScholarPad -destination 'platform=iOS,id=00008112-000509D9268A201E' -destination-timeout 30 -derivedDataPath /tmp/ai-dtl-device-sep20 -only-testing:ScholarPadUITests/FractionLearningSmokeUITests DEVELOPMENT_TEAM=YZQ2T35W5C test
```

不要在同一设备并行跑多条 xcodebuild test。测试最后回到桌面释放云连接，不保持计费会话。

## 后续优先级与未完成边界

1. **教学证据校准**：空白画布不得虚构孩子的想法；具体画图证据下先复述，再小步澄清/提示。用成人连续多轮验证，而不是仅检查存在回复。
2. **恢复数据正确性**：宿主 ready 当前不返回画布/笔迹；本地无草稿不能完整恢复。当前宿主提交路径把合成图片保存至 childInkBase64，不是 PencilKit PKDrawing 数据，需区分证据图片与可编辑原稿，补往返恢复测试后再验收。
3. **退出与删除的确认**：检查 finish 后立即断开能否可靠收到保存确认；删除 API 的失败不能被 UI 吞掉并显示成功。现有测试不足以证明这些真机路径。
4. **分数模式语音输入**：仍未接通实际录音提交链路；voiceIntent 只是通知并要求确认，不等于口语学习闭环已完成。
5. **真机多轮、提示图形、异议、独立迁移**：协议层测试不是成人/孩子端到端验收。持续保留“有提示完成”与“独立完成”的区别。
6. 切换 tab、App 被杀、宿主重启、USB 地址变化/断开还需逐项验收。不要从一次后台恢复推广成全部生命周期通过。

完成标准仍是孩子主动提交、AI 根据证据小步介入、孩子继续思考并独立迁移；不是“模型能说话”即完成。
