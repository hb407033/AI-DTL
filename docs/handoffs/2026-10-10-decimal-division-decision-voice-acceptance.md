# 小数除法：教学决策与语音分离验收

日期：2026-10-10（笔记本时区；iPad 日志为10月11日）。品牌：AI-DTL / AI 学科心智学习系统。

## 当前结果

本机 MacBook 已作为真实学习宿主，不依赖离线的家中 Mac mini。沿用 SwiftUI / PencilKit 与 `qwen3.8-omni-flash-realtime`，没有切换模型、接入 Hermes 或引入新平台。

生产 `/tutor/workspace` 的 dialogue 路径改为：冻结题目/笔迹和本轮表达 → 文本模式教学决策 → 宿主校验 → 仅把批准的一句话交给语音层 → 核对播报返回文本 → 反馈与决策原子保存 → 播放。语音层不再拿照片自由解题。

目标教学路径：12.5和0.5同时乘10成为125÷5，理解商不变 → 核对205中的位值问题 → 孩子自行修正25 → 自选检验办法 → 独立新例4.8÷0.6 → 交还控制。不教除以0.5改乘2，不宣布掌握。

## 直接修改入口

- `apps/agent-host/src/ai/workspace-teaching-decision.ts`：决策提供器、课程/抢答/证据/重复提问门禁、数学播读和纯播报核对。
- `apps/agent-host/src/learning/decimal-division-policy.ts`：从孩子表达核对小数除法焦点；原题/整数转换式与新例分开。由宿主决定已解决焦点，不接受模型自报进度。
- `apps/agent-host/src/learning/teaching-decision.ts`、`workspace-store.ts`：会话工作记忆和反馈原子写入；幂等、异议/换题失效及删除联动。
- `apps/agent-host/src/ai/workspace-voice-route.ts`、`learning-tutor.ts`：真实 dialogue 开场和后续接线，打断时取消，失效决策不播放。
- `qwen-workspace-session.ts`、`workspace-usage.ts`：分别记录决策调用用量；未知用量不编造价格。
- `apps/ipad/ScholarPad/ScholarPad/Session/LearningWorkspaceView.swift`：仅 DEBUG 隔离验收支持5轮合成儿童语音及服务器决策判定。
- `apps/ipad/ScholarPad/ScholarPadUITests/ChildLearningFlowUITests.swift`：新增 `testDecimalDivisionDecisionAndSpeechLoop`。

## 实测证据

稳定本地证据目录：`/Users/houbin/Library/Application Support/ai-dtl/acceptance/2026-10-10-decimal-division-decision/`。

| 验证 | 结果与证据 |
| --- | --- |
| 相关后端测试 | 23个文件、96项通过，`accepted-tests.log` |
| 真实云端闭环 | 6轮全部有PCM；第三个儿童回合前断开重连；最终 `return`/`handoff=true`，`backend-probe.json` |
| 真机端到端 | iPad `00008112-000509D9268A201E`，1项0失败，109.102秒；`device-verdict-final.log` |
| 真机教学接续 | 实际作品 `78f0cd01-e9e5-4221-8abe-ea1121fee167`；焦点为 `invariance → invariance → place_value → verify → return → return`；`device-workspace.json` |
| 真机笔迹 | XCTest真实PencilKit手势写125÷5=205，结束仍保留；`screens/initial-ink.png`、`screens/discussion-handoff.png` |
| 构建/安装 | Debug真机构建、安装成功；不带测试环境参数重新启动普通应用，未卸载或清空家庭数据 |
| 本机宿主 | LaunchAgent `com.houbin.ai-dtl.learning-tutor` 已重启载入新源码；8791 `/healthz` 为 `ok` / `learning-tutor` / `configured=true` |
| TypeScript | 尚有既有 `test/photo-learning-closure.test.ts:9` 和 `:11` 两处未使用 `@ts-expect-error`；本次未增加其他报错，不宣称全量类型检查通过 |

完整 XCTest bundle 临时位置：`/tmp/ai-dtl-division-decision.8gWaJc/device-verdict-final.xcresult`。稳定目录已经留存本次通过日志与前后截图，不依赖临时 bundle 才能检查。

曾有一轮失败发生在验收器：测试Runner不能解析mDNS，且启动缓存ID并非拍照后新作品ID。已改为应用沿已连通的音频夹具通道、用真实作品ID核对服务器判定，再宣布验收完成。修正后真机重跑通过；不是忽略失败或降低教学断言。

## 复跑方式

在仓库根目录，用全新的隔离目录（不要指向家庭作品目录）：

```sh
export AI_DTL_PROBE_DIRECTORY="$(mktemp -d /tmp/ai-dtl-division.XXXXXX)"
node apps/agent-host/scripts/make-division-fixtures.mjs
/Users/houbin/.local/bin/node --env-file-if-exists=.env.ai.local --import tsx apps/agent-host/scripts/probe-division-dialogue.ts
```

需要 macOS `swift`、中文 `say` 声音 Tingting、`ffmpeg`，以及本机既有模型配置。生成器与探针已入当前工作区源码，凭据不入日志/文档。云端调用会产生正常接口费用。

真机测试另启同一探针加 `--serve`，监听8797并提供音频与教学判定夹具，然后执行上述单个XCTest。iPad须能访问 `macbookpro.local:8797`；不同主机名应修改测试配置，不修改正式产品地址。测试结束关闭隔离8797服务，正式8791保持运行。

## 已知边界与后续

- 合成题照、预制儿童音频，模拟笔迹；真机验证的是工程链路与脚本场景中的教学接续，不等于真人儿童已理解。真机脚本用口述修正，保留画布205原稿，不假称它自动改写了孩子笔迹。
- 决策和播报现在是同一Omni型号的两次不同职责调用，不是接入了新的推理模型。分层接口已经独立，Hermes/Pi可作为后续决策实现，不是本轮前提。
- 证据识别是保守的小数除法规则，不是跨题型的完整语义诊断；当前开场针对已有转换步骤的场景。空白画布、陌生自然说法及其他学科需另补场景，不能套本次通过结论。
- 播报核对依赖上游返回转写，不是独立ASR逐字审听；真实儿童麦克风、环境噪声、Apple Pencil压力手感与学习效果未在本轮验证。
- 语音全部缓冲后播放，本次后端每轮约4.8–6.3秒；这是正确性优先的第一版，仍需优化等待体验。
- 会话最多取最近12条有效决策；不是完整长期成长记忆。被异议反馈及换题旧决策不再进入有效历史。
- 原 independent 模式及未注入决策器的旧调用保留原行为；生产 dialogue 注入新决策器，失败不偷偷回退自由答题。
- 本机工作分支 `codex/ipad-arrival-plan`，HEAD `e2a14d1`，大量早于本次的未提交/未跟踪文件。没有把这些批量提交，也没有覆盖家庭原稿。
- 收工 `twin-status --no-fetch` 确认 mini 不可达，当前无上游；实际远端是GitHub私有仓库，不是GitLab。本轮未推送。回家后先比对两端未提交内容，再同步本轮列出的文件并重跑相关测试，不能直接覆盖mini工作区。
