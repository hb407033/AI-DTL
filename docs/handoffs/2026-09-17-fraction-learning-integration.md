# 分数学习闭环：2026-09-17 集成与验收记录

状态：工作包 A–E 代码集成完成；协议/单元/模拟器证据齐全；**真机运行与真人教学验收未完成（珩pad 锁屏，需人工解锁后补跑）**。

范围依据：`docs/superpowers/specs/2026-09-17-fraction-learning-loop-design.md`（已确认设计）、`docs/superpowers/plans/2026-09-17-fraction-learning-handoff.md`（交接清单）。本版仅称「一次学习闭环可用」，不称通用课程平台或长期成长系统。

## 1. 工作包 A：统一契约与三题流程

- 契约：`packages/session-contracts/src/fraction-learning.ts`（envelope：schemaVersion/sessionId/eventId/submissionId?/revision/type/payload；7 种命令；矩形模型 rows*columns≤60、格子索引 0 起唯一、每 owner ≤4 个）。
- 共享夹具：`packages/session-contracts/fixtures/fraction-learning-v1.json`（合法/越界/重复/旧 revision/非法角色/未知命令/迁移有提示样例）。
- 三题包：`apps/agent-host/src/learning/fraction-pack.ts`（版本 `fraction-pack-2026-09-17-v1`；题干与核验依据分离，测试断言题干不含 9/12、16/20、「通分」等泄露）。
- 状态机：`apps/agent-host/src/learning/fraction-session.ts`（exploring→reviewing→exploring/clarifying/transfer→reviewing→finished；paused 存前态；eventId 幂等、revision 乐观校验；contest 后反馈失去使用资格）。
- 证据：`pnpm --filter @ai-scholar/session-contracts test` 11 项通过；`test/fraction-session.test.ts` 21 项通过；restore 快照测试 6 项通过。

## 2. 协议能力门禁（工作包 C 前置）

真实千问 Omni（qwen3.5-omni-flash-realtime）探针通过，证据 `validation/results/qwen/2026-09-17-tool-capability.json`（`pnpm probe:qwen-capability` 可复跑）：

- 工具调用：模型发出 `response.function_call_arguments.done`，参数通过白名单校验（3x4 涂 9 格）。
- 结果回传：`function_call_output` + `response.create` 后模型正常完成。
- 取消：`response.cancel` 后 `response.done status="cancelled"`；存在 1 条迟到音频增量（宿主与客户端均按 responseId 丢弃迟到片段）。

## 3. 工作包 B/C/D

- B 受控画布：`FractionBoardState.swift`（三类状态分离、分割变更清空涂色、越界/重复拒绝、AI 白名单三动作幂等）、`FractionBoardView.swift`（同 wholeGroupId 同尺度）、`LearningSnapshot.swift`（孩子矩形+笔迹同 revision 合成证据，复用 TutorSnapshot 压缩边界）。
- C Omni 接入：`tutor-learning-actions.ts`（白名单校验/幂等/submission 绑定）、`learning-tutor.ts`（8791 `/tutor/learning`；只有 submit/requestHelp 才触发教学响应；口头「我画好了」不产生图形；contest/interrupt 共用 response.cancel + 迟到丢弃）、`LearningSessionClient.swift`（迟到音频/图形按 responseId+submissionId 丢弃；voiceIntent 只通知不自动提交）。
- D 存档：`learning-session-store.ts`（原子写入、revision 乐观校验、eventId 幂等、损坏不覆盖、删除墓碑防复活）、`LearningSessionCache.swift`（iPad 草稿、冲突保留双方强制选择）。
- 证据：宿主全量 **117 项 TS 测试通过**（`pnpm --filter @ai-scholar/agent-host test`），typecheck 干净。

## 4. 工作包 E：集成

- 入口：`ScholarPadApp.swift` 新增第三个 tab「分数探索」，原「互动老师」「教学实验室」不动。
- 新屏 `FractionLearningView.swift`：题干、PencilKit 笔迹层 + 受控矩形层、按钮提交（LearningSnapshot 证据冻结）、帮我一下、你理解错了、开始迁移（全新作答空间 + 隐藏探索提示）、暂停/继续、休息退出；「上次停在这里」恢复页（点击继续才连接，不自动开麦/连接）；冲突保留双方强制选择；删除记录与清空画布分开、各自确认。
- 宿主恢复：`hello(sessionId?)` → `ready{ sessionId, revision, phase, challengeId, prompt, restored, packVersion }`；`DELETE /learning/:sessionId` 删除记录；恢复后重放旧事件返回 duplicate，不重生效。
- 模拟器证据：FractionBoardTests 17 + LearningSessionClientTests 11 + FractionLearningViewTests 9 + LearningSessionCacheTests 14 等全部通过（TEST SUCCEEDED，/tmp/ai-dtl-sim-newtests.log、/tmp/ai-dtl-e-test.log）。

## 5. 真机验收脚本（逐项记录）

| 场景 | 结果 | 说明 |
| --- | --- | --- |
| 单元测试真机运行（FractionBoard/LearningSessionClient/LearningSessionCache/FractionLearningView） | 未测 | 珩pad 锁屏，xcodebuild 等待解锁后超时（2 次，各约 40 分钟）。解锁后重跑命令见下 |
| 模拟器全量回归 | 部分通过 | ScholarPadTests 101 项中 78 通过；23 失败全部在 TutorAudioTests（AVAudioEngine 在模拟器的环境限制，2026-09-16 起该类用例即以真机为准）；新增 4 个套件全部通过。ScholarPadUITests 需 scripted 宿主（`pnpm exec tsx src/server.ts --scripted …`），本轮未起该服务，32 失败属环境缺失 |
| 8791 学习宿主启动自检 | 通过 | `pnpm host:learning` 启动正常，/healthz 返回 `{"status":"ok","mode":"learning-tutor","configured":true}` |
| 独立探索（AI 不主动评判） | 未测 | 需真机/真人 |
| 主动提交（按钮；语音「我做好了」单独记） | 未测 | 按钮链路协议测试已过；语音意图仅有明确短语白名单转达界面确认，**云端转写开启未经探针验证，标未完成** |
| 证据不足先澄清 | 未测 | 需真人 |
| 提示（一小步、孩子原稿不变） | 未测 | 协议层已过，真人未测 |
| 异议与打断 | 未测 | 协议测试已过（cancelled + 迟到丢弃），真人未测 |
| 独立迁移（隐藏提示、有提示标记） | 未测 | 状态机/视图测试已过，真人未测 |
| 生命周期（后台/杀 App/宿主重启） | 未测 | 存档恢复测试已过（模拟器+宿主），真机未测 |
| 断网重连 | 未测 | 缓存 reconcile 测试已过，真机未测 |
| 失败退出（休息） | 未测 | finishSession(reason=rest) 已实现 |
| 删除记录 | 未测 | 墓碑机制测试已过，真机未测 |
| 真人教学验收（成人十轮 + 家长陪伴孩子） | 未测 | 必须真人完成，不得以协议测试冒充 |

真机补跑命令（解锁珩pad 后，工作目录 apps/ipad/ScholarPad）：

```sh
xcodegen generate
DEVELOPER_DIR=/Users/houbin/Downloads/Xcode.app/Contents/Developer xcodebuild -project ScholarPad.xcodeproj -scheme ScholarPad -destination 'platform=iOS,id=00008112-000509D9268A201E' -derivedDataPath /tmp/ai-dtl-device-newtests -only-testing:ScholarPadTests/FractionBoardTests -only-testing:ScholarPadTests/LearningSessionClientTests -only-testing:ScholarPadTests/LearningSessionCacheTests -only-testing:ScholarPadTests/FractionLearningViewTests -only-testing:ScholarPadTests/TutorAudioTests -only-testing:ScholarPadTests/TutorTurnDetectorTests -only-testing:ScholarPadTests/TutorSnapshotTests DEVELOPMENT_TEAM=YZQ2T35W5C test
```

宿主启动：`pnpm host:simple`（8790 互动老师，保持不变）、`pnpm host:learning`（8791 分数探索练习模式）。

## 6. 已知未完成项（如实声明）

1. 真机全部场景与真人教学验收未做（设备锁屏 + 必须真人）。
2. 语音提交：只有明确短语白名单经界面确认；云端 `input_audio_transcription` 开启未探针验证，自动语音提交未实现。
3. 恢复时 originPhase/pausedFrom 由记录推导（从 reviewing 暂停后恢复再 resume 会回作答阶段而非 reviewing）——已知近似。
4. 宿主 ready 只回元数据不回画布内容；本机无草稿的恢复显示空白画布并明示「主机有记录但本机没有草稿内容」。
5. 打断后以已保存事实重建云端上下文未实现（当前保证旧片段不续播、旧判断失去资格）。
6. 后台切换 UI 验收、回声消除、双向打断按设计独立推进，不在本版闭环内。
7. 未做任何 git 提交/推送（按交接要求，待明确授权后精准暂存）。
