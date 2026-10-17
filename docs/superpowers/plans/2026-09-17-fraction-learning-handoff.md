# 分数学习闭环：跨 Agent 执行交接清单

> 执行者使用 superpowers:executing-plans 逐项推进。此文是已批准范围的交接与任务拆分，不是已经实现的状态报告；本轮不启动其他 agent。涉及接口的新细节先按下列门禁验证，再编写对应小任务的 TDD 实施步骤，不一次性重写项目。

**Goal:** 系统出题，孩子独立表达分数比较，主动提交、获得受控图形提示、独立迁移，并能恢复本次学习。

**Architecture:** Swift/PencilKit 负责操作和本地草稿；Mac 宿主负责单一流程状态、记录与命令校验；千问 Omni 负责理解和讲解。图形只能走白名单，不写孩子原笔迹，不进入长期档案。

**Tech Stack:** Swift 6、SwiftUI、PencilKit、AVAudioEngine；TypeScript、Fastify、WebSocket、现有 Zod / Vitest；继续 Qwen Omni，不增 LiveKit、DeepSeek、Pi 或独立 STT/TTS。

## 0. 接手必读与工作树

- 仓库绝对路径：`/Users/houbin/Documents/Codex/2026-08-29/wo-yo`。
- 当前分支：`codex/ipad-arrival-plan`；2026-09-17 读取的 HEAD 为 `e2a14d1`。接手必须重新核实，不能把此值当执行时事实。
- 本轮批准设计：`docs/superpowers/specs/2026-09-17-fraction-learning-loop-design.md`。
- 前序证据：`docs/superpowers/plans/2026-09-16-omni-continuation.md`、`2026-09-15-simple-tutor.md`、`2026-09-15-simple-tutor-setup.md`。
- 工作树有大量已修改及未跟踪文件，尤其 `apps/agent-host/src/ai/` 和 SimpleTutor 原生文件。它们不是可删除的临时文件；只检出 HEAD 的新 worktree 会缺少现在能运行的主路径。
- 不执行清理、reset、整仓暂存、自动合并或推送。新 agent 先核实工作树；需要 worktree 时先经协调者建立包含必要未提交成果的基线，不能把缺文件误判成需要重写。
- 品牌固定为 **AI-DTL / AI 学科心智学习系统**，不要改成“新质”。

接手只读命令（仓库根目录）：

```sh
pwd
git branch --show-current
git status --short
git log -1 --oneline
curl -s http://127.0.0.1:8790/healthz
```

healthz 的 configured=true 仅表示配置结构存在，不证明云端授权成功。不得读取、打印或传递 `.env.ai.local` 内容；由用户在本地填写密钥。

## 1. 当前证据与不能误报的事项

- 当前运行主路径是 8790 的 `simple-tutor.ts`，不是旧 8788 教学实验室，也不是 Pi Agent。
- 前一轮已有：后端相关 7 项测试通过；真机相关 11 项测试通过；真实千问同连接十轮合成音频+白图成功。
- 真机十轮用例是静音播放/录音生命周期测试，云端十轮是另一次独立测试。真人麦克风到模型到扬声器的完整教学验收仍未完成。
- 后台切换验收、语音打断、回声消除未关闭；真实云端第九轮输入 usage 下降原因未定位，不声称模型保留全部历史。
- 当前 SimpleTutor 自动在检测停顿后发送，不满足本次“主动提交才教学反馈”；当前快照只有笔迹，不包含新分数组件。
- 当前简化入口没有接上会话存档。旧实验室虽然有 `DrawingArchive`，却绑定 8788、旧 sessionId 和单笔迹格式，不能直接当成新功能已完成。

## 2. 代码入口与所有权

以下路径均相对上述仓库根目录；新建文件名是建议的明确职责边界，执行前检查是否已有同名实现。

| 工作包 | 现有入口 | 建议新增文件 | 修改权 |
| --- | --- | --- | --- |
| A 流程/题包/契约 | `packages/session-contracts/src/index.ts` | `packages/session-contracts/src/fraction-learning.ts`；`apps/agent-host/src/learning/fraction-pack.ts`；`fraction-session.ts` | 协调者先冻结公共契约 |
| B 受控画布 | `apps/ipad/ScholarPad/ScholarPad/Canvas/ChildCanvasView.swift`；`AgentLayerView.swift` | 同目录 `FractionBoardView.swift`、`FractionBoardState.swift`、`LearningSnapshot.swift` | 画布执行者；不改语音客户端 |
| C Omni 接入 | `apps/agent-host/src/ai/simple-tutor.ts`；`apps/ipad/ScholarPad/ScholarPad/Session/SimpleTutorView.swift` | 宿主 `src/ai/tutor-learning-actions.ts`；原生 Session 下 `LearningSessionClient.swift` | 接入执行者；公共主视图由集成者统一合入 |
| D 保存恢复 | 原生 `Canvas/DrawingArchive.swift`；宿主旧 drawing 路由仅供参考 | 宿主 `src/learning/learning-session-store.ts`；原生 Session 下 `LearningSessionCache.swift` | 保存执行者；不修改成长档案 |
| E 集成验收 | `ScholarPad/App/ScholarPadApp.swift`；`ScholarPadTests`；`ScholarPadUITests` | 原生 Session 下 `FractionLearningView.swift`；验收文档 | 集成者负责入口/真机/服务重启 |

禁止多个 agent 同时改 `SimpleTutorView.swift`、`simple-tutor.ts`、契约出口、项目配置。工作包 A 完成前 B/C/D 不各自发明会话结构；A 完成后可分工开发，E 串行集成。当前文档不自动派发任务。

## 3. 工作包 A：统一契约与三题流程

- [ ] 阅读批准设计，建立三题数据文件，人工核验 `3/4 > 2/3`、`1/2 = 2/4`、`4/5 > 3/4`，题包有版本，不把答案默认下发为可见文案。
- [ ] 定义唯一流程写入者及状态转换：`exploring → reviewing → exploring/clarifying/transfer → reviewing → finished`；`paused` 保存前态。`finished` 仅表示本次结束，不表示掌握。主动求助进入 reviewing；异议回 clarifying；暂停/错误不自动前进。
- [ ] 固定消息 envelope：`schemaVersion, sessionId, eventId, submissionId?, revision, type, payload`。同 eventId 重放只生效一次，旧 revision 不覆盖新状态。
- [ ] 冻结矩形模型字段：`id, wholeGroupId, rows, columns, shadedCells, owner`；owner 为 child/agent，格子索引从 0 开始且唯一，rows/columns 为正整数、乘积不超过 60。整体尺度由渲染器统一而非模型任意指定。
- [ ] 定义 `submit / requestHelp / contest / startTransfer / pause / resume / finishSession` 的合法来源与副作用；绘图或静音事件不得自动变成 submit。
- [ ] 共享 JSON 夹具同时供 Swift Codable 和 TS 校验使用：合法题目与矩形、越界格子、重复格子、旧 revision、非法角色、未知命令、迁移有提示标记。
- [ ] 先写失败测试，再实现最小状态转换和校验；测试放 `packages/session-contracts/test/fraction-learning.test.ts`、宿主 `test/fraction-session.test.ts`。
- [ ] 交付字段契约、共享夹具、通过的测试证据；B/C/D 接手前由集成者确认同一版本。

关键契约示例（用于夹具，不是任意图形 DSL）：

```json
{"schemaVersion":1,"sessionId":"fixture-session","eventId":"event-1","submissionId":"submission-1","revision":3,"type":"submit","payload":{"challengeId":"fraction-compare-01","boardRevision":3}}
```

## 4. 工作包 B：受控分数画布

- [ ] 从共享夹具写 `FractionBoardTests.swift`：两整体同尺度、每格等面积、跨屏旋转不改变值、越界指令拒绝、隐藏提示后孩子层字节不变。
- [ ] 实现孩子矩形的行列分割、涂色切换、擦除与独立清空；改变分割会改变涂色语义，须明确确认或清空该矩形涂色，不能偷偷按旧索引迁移。
- [ ] 提示层只读，不挡 PencilKit 书写；孩子要操作分数图时有明确命中区域，避免重现“大半画布写不了”的问题。
- [ ] 实现合成证据预览：孩子图形 + 孩子笔迹，结构化状态与截图使用同一 revision。不要把 `PKDrawing.image` 当完整新画布截图。
- [ ] 复用 `TutorSnapshot` 的上传压缩边界；图片缩小不修改本地原始图形/笔迹。画布恢复后同步更新提交用的 PKDrawing 状态，不仅让屏幕看起来恢复。
- [ ] `FractionBoardTests`、`TutorSnapshotTests` 通过后，在真机横竖屏确认 Apple Pencil 与涂色都可用。

## 5. 工作包 C：Omni 主动反馈与按钮打断

- [ ] 前置探针：核实当前 Qwen 型号的工具调用/结构化动作和取消协议；用合成数据验证工具参数、结果回传、音频时序。保存协议证据，不保存密钥。
- [ ] 若不支持可靠工具动作，报告阻塞并保留现有功能；禁止换模型、解析任意自由文本为指令，或用脚本演示冒充 AI 决策。
- [ ] 写 `test/tutor-learning-actions.test.ts`：未经提交不请求教学回答、未知动作拒绝、AI 改 child 对象拒绝、重复动作幂等、旧提交图形不得应用到新画布。
- [ ] 将练习模式与现有自由连续聊天明确隔离。按钮提交冻结当前语音/文字、笔迹与图形证据；安静、画完一笔或改图不得自动 response.create。
- [ ] 语音“我做好了”使用可验证的输入转写/明确意图识别路径，不让模型先讲完再决定是否提交。转写有歧义只询问；无法实现时在验收里标未完成，不假称已支持语音提交。
- [ ] AI 先一句复述，歧义才确认；图形动作经宿主校验后应用并回传结果；看不清时询问，不猜测对错。
- [ ] 按钮打断同时停播放器、取消生成、屏蔽旧响应片段。核实截断历史能力；能力不足时以已保存事实重建云端上下文，不让模型假设孩子听过未播放部分。
- [ ] “你理解错了”调用相同取消路径，撤销本次理解的使用资格；保留异议事实，等待新提交。
- [ ] 增加 `LearningSessionClientTests.swift`，覆盖停止/异议/切题后的迟到音频和绘图事件；不接长期 ledger，不新增平台。

## 6. 工作包 D：Mac 权威存档与 iPad 草稿

- [ ] 契约 A 固定后写宿主 `test/learning-session-store.test.ts` 和原生 `LearningSessionCacheTests.swift`：保存再读完全一致、幂等、旧版本冲突、写入失败、损坏文件不覆盖有效草稿。
- [ ] 保存题包版本、题目、阶段、PKDrawing、孩子/AI 图形、提示可见性、反馈/提交/异议事实、辅助标记和 revision；不存音频、密钥、隐藏推理或能力标签。
- [ ] 文件落在项目忽略的应用数据目录或 App Application Support；原子写入，记录 schemaVersion，不写进源码目录或 Git。不因“本地”跳过路径/大小/结构校验。
- [ ] Mac 为最终记录，iPad 离线草稿标记未同步；重新连接先比较 revision，有冲突保留双方，不能旧数据覆盖新笔迹。
- [ ] 恢复页先展示上次题目和状态，只有点击继续才连接 Omni；不自动开麦、不播放历史音频、未完成回答不假作成功。
- [ ] 支持删除本次学习记录，删除不被迟到同步复活；与清空当前画布分开，明确确认。
- [ ] 中途退出、宿主重启、离线编辑再连接通过后交给 E；不声称实现了错题本或成长档案。

## 7. 工作包 E：集成与真人验收

- [ ] 入口保留现有互动老师与教学实验室，不偷偷把旧实验室当成新流程；增加清晰的“分数探索”入口，公共主文件仅集成者修改。
- [ ] 使用同一版本契约连 A/B/C/D；验证新题、保存、恢复、提交、异议、迁移都引用同一 sessionId/revision。
- [ ] 真机执行以下脚本并逐项记录 pass/fail/未测，失败写步骤、设备状态、日志或截图路径。

| 场景 | 操作 | 预期 |
| --- | --- | --- |
| 独立探索 | 看 3/4 与 2/3，静默书写、擦改、涂色 | AI 不主动评判、不开提示解法 |
| 主动提交 | 点击提交；另测说“我做好了” | 使用同版图形和笔迹，AI 先复述；语音路径单独记结果 |
| 证据不足 | 交含糊笔迹或解释 | 先澄清，不武断判错 |
| 提示 | 主动求助一次 | 一小步提示，矩形等分正确，孩子原稿不变 |
| 异议与打断 | 播放中按“你理解错了” | 停声，旧片段不续播，旧判断不继续使用 |
| 独立迁移 | 隐藏探索提示，做 4/5 与 3/4 | 新作答区；若再求助则记录有提示，不宣布掌握 |
| 生命周期 | 后台、切页、杀 App、宿主重启 | 不自动开麦；本地草稿或确认保存的进度可恢复 |
| 断网 | 编辑后断网、重连 | 未同步提示明确；不丢本地新稿、不重复提交 |
| 失败退出 | 迁移答错，选择休息 | 可保存退出，不无限强迫练习 |
| 删除 | 删除本次记录后重连 | 不被缓存或迟到响应恢复 |

- [ ] 成人先测完整十轮，再在家长陪伴下做真实学习验证；不得将儿童数据另传到评审模型。
- [ ] 收尾提交验收报告和剩余项，不自动提交 Git。只有另获明确授权后才精准暂存自己负责文件、正常 hooks 提交；不得整仓 add。

## 8. 验证命令与真机环境

以下是既有可用命令，接手核实工具路径、设备在线和服务状态，不反复让用户截图。新测试文件未建立前不要把选择不到测试当作通过。

```sh
# 仓库根目录
pnpm --filter @ai-scholar/agent-host test test/simple-tutor.test.ts test/qwen-session.test.ts
pnpm --filter @ai-scholar/agent-host typecheck
pnpm --filter @ai-scholar/session-contracts test
git diff --check
```

宿主新测试建立后：

```sh
pnpm --filter @ai-scholar/agent-host test test/fraction-session.test.ts test/tutor-learning-actions.test.ts test/learning-session-store.test.ts
pnpm --filter @ai-scholar/session-contracts test test/fraction-learning.test.ts
```

设备历史标识：珩pad，UDID `00008112-000509D9268A201E`，bundle `com.houbin.aischolar.pad`，Team `YZQ2T35W5C`。正确 Xcode 曾位于 `/Users/houbin/Downloads/Xcode.app/Contents/Developer`，默认 xcode-select 路径曾导致 devicectl 收尾警告。

```sh
DEVELOPER_DIR=/Users/houbin/Downloads/Xcode.app/Contents/Developer xcrun devicectl list devices
# 工作目录 apps/ipad/ScholarPad
xcodegen generate
DEVELOPER_DIR=/Users/houbin/Downloads/Xcode.app/Contents/Developer xcodebuild -project ScholarPad.xcodeproj -scheme ScholarPad -destination 'platform=iOS,id=00008112-000509D9268A201E' -derivedDataPath /tmp/ai-dtl-simple-device -only-testing:ScholarPadTests/TutorAudioTests -only-testing:ScholarPadTests/TutorTurnDetectorTests -only-testing:ScholarPadTests/TutorSnapshotTests DEVELOPMENT_TEAM=YZQ2T35W5C test
```

新增原生测试建立后将对应 `-only-testing:ScholarPadTests/FractionBoardTests`、`LearningSessionClientTests`、`LearningSessionCacheTests` 加入命令；确认日志实际执行数量。构建安装会打断 App，现有简化画布仍仅在内存，先检查是否有需要保留的新内容。

当前支持 USB-only 调试。历史 Mac USB IP `169.254.104.25` 可能变化，不硬编码进新代码。主机 `pnpm host:simple` 使用 8790；重启前确定 PID 和服务归属，不能停止无关 8788 服务。

## 9. 给接手 Agent 的首条消息

> 请在 /Users/houbin/Documents/Codex/2026-08-29/wo-yo 接手 AI 学科心智学习系统。先读本清单与对应 2026-09-17 设计稿，核实 codex/ipad-arrival-plan 的未提交工作，不清理、不重写已有 SimpleTutor 主路径。用户已确认：千问 Omni、系统分数题、受控矩形图形、孩子主动提交、AI 先复述、只保存此次学习。先做工作包 A 的统一契约，并验证 C 的 Omni 工具/取消能力门禁，再推进 B/C/D，最后 E 真机集成。不要切换模型、接成长档案或未经授权提交推送；分别报告模拟、协议、真机和真人验收证据。
