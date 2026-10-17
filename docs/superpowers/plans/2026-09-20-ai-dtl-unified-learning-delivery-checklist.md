# AI-DTL 统一学习空间：分阶段执行交接清单

第一阶段详细实施入口：`2026-09-20-ai-dtl-phase-1-implementation.md`。本文保留为跨阶段路线图；具体第一阶段任务顺序、文件和验证以详细计划为准。

> 执行者使用 superpowers:executing-plans 接续。本文是交付顺序与验收清单，不是完整代码补丁，也不授权自动派发 agent。每个任务实施前据当前源码补充其小步失败测试与改动步骤，禁止一次重写所有模块。

**Goal:** 孩子直接拍一道当前学习阶段的真实数学题，在同一空间连续说写，主动邀请 AI 基于证据帮助，随后继续独立思考。

**Architecture:** 一个 Swift 学习空间、一条 Mac 学习会话链路；复用音频与受控教学实现，题目来源与教学策略分离。阶段一先打通纵向闭环，阶段二扩展必要图形，阶段三完善跨次衔接。

**Tech Stack:** SwiftUI/PencilKit/AVAudioEngine、TypeScript/Fastify/WebSocket、现有千问 Omni、Mac 本地事实记录；不新引入 Pi、LiveKit、独立 STT/TTS 或其他模型。

## 0. 接手与约束

- 仓库：`/Users/houbin/Documents/Codex/2026-08-29/wo-yo`。
- 本稿创建时分支 `codex/ipad-arrival-plan`，大量修改/未跟踪文件是已有成果。先运行 `git status --short` 与 `git branch --show-current`；不 reset、清理、整仓暂存或从缺少这些文件的 HEAD 开始重写。
- 依据：`docs/superpowers/specs/2026-09-20-ai-dtl-unified-learning-space-design.md`。
- 当前证据：`docs/handoffs/2026-09-20-fraction-learning-device-validation.md`；旧通过记录不替代新接口验证。
- 本轮是文档收敛，不启动云调用、安装、提交或推送。接续实施按用户授权范围操作；多个 agent 不同时改公共契约、App 入口或同一会话文件。
- 不按旧文档硬编码 USB 地址、Xcode 路径；先实测。不能让测试长时间占用/锁住唯一真实学习连接。

## 1. 实现入口映射

路径均相对仓库根。新文件为计划名，创建前检查是否有其他 agent 已提供同职责实现。

| 职责 | 复用/修改入口 | 建议新增文件 |
| --- | --- | --- |
| 主入口 | `apps/ipad/ScholarPad/ScholarPad/App/ScholarPadApp.swift` | `Session/LearningWorkspaceView.swift`（位于 ScholarPad 下） |
| 直接拍照 | `apps/ipad/ScholarPad/ScholarPad/Info.plist`、`apps/ipad/ScholarPad/project.yml` | `apps/ipad/ScholarPad/ScholarPad/Camera/ProblemCameraView.swift` |
| 音频生命周期 | `apps/ipad/ScholarPad/ScholarPad/Session/SimpleTutorView.swift`、`TutorTurnDetector.swift` | 仅按实际需要抽共享音频组件，不复制整套 client |
| 学习会话客户端 | `apps/ipad/ScholarPad/ScholarPad/Session/LearningSessionClient.swift`、`FractionLearningView.swift` | 统一空间的 model，不依赖分数题 ID |
| 题目描述/教学权限 | `packages/session-contracts/src/index.ts`、`fraction-learning.ts` | `packages/session-contracts/src/learning-problem.ts` |
| 学习宿主 | `apps/agent-host/src/ai/learning-tutor.ts`、`simple-tutor.ts` | `apps/agent-host/src/learning/teaching-policy.ts` |
| 画布证据 | `apps/ipad/ScholarPad/ScholarPad/Canvas/LearningSnapshot.swift`、`FractionBoardState.swift` | 新图形按阶段二需求建立，不预建大 DSL |
| 本地事实 | `apps/agent-host/src/learning/learning-session-store.ts`、`apps/ipad/ScholarPad/ScholarPad/Session/LearningSessionCache.swift` | 明确 schema 版本及旧记录读取适配 |

## 2. 阶段一任务：唯一当前实施主线

### 任务 1：验证连续语音的教学介入门禁

- [ ] 检查 `simple-tutor.ts`、`learning-tutor.ts` 的音频 commit/response 时序，记录可复用部分及必须移除的自动教学行为。
- [ ] 在 `apps/agent-host/test/learning-tutor.test.ts` 增加行为用例：静音/笔迹变化不生成教学回答；询问题意可回应但不给解法；提交与求助分别绑定本轮证据；不明确意图只澄清。
- [ ] 用合成内容验证当前 Omni 的转写/意图门禁、同一会话连续轮次、取消与迟到输出。不读取或回显密钥；不保存原音频。
- [ ] 记录支持的实际事件和错误；若只能先生成再判断，不允许作为“严格门禁”通过，暂停该能力并报告具体限制。相机/本地草稿准备可继续。
- [ ] 门禁通过后再明确共享音频适配接口；优先复用现有录音转换/播放，不同时维持两个模型会话。

通过条件：有真实上游证据，不仅是 mock；沉默不会主动讲解，明确求助能进入下一轮。

### 任务 2：课程约束与开放题契约

- [ ] 新增 `packages/session-contracts/test/learning-problem.test.ts`：camera 来源必须有照片引用；未确认题意不能开始作答评价；curated 来源保留题包版本；课程阶段不等于掌握状态。
- [ ] 定义并共享 problemId、source、照片引用、候选/确认题意、课程阶段快照；具体字段及 Swift Codable 同步，不让两端各造一套。
- [ ] 在 `apps/agent-host/test/teaching-policy.test.ts` 覆盖表达、题意询问、提交、求助、纠正五类动作；表达与题意询问不得授权作答诊断。
- [ ] 落地家长当前单元设置和持久化；目录未核实前允许家长填写单元名，不造教材目录、不让孩子先做摸底。
- [ ] 将现有审核题包适配为 curated 问题；旧分数回归保留，开放题不得伪造 fraction-compare-01。

通过条件：一道非分数问题可以建会话；已确认题意、孩子证据、模型推测可区分。

### 任务 3：拍照、预览、题意核对

- [ ] 新增 `apps/ipad/ScholarPad/ScholarPadTests/ProblemCaptureTests.swift`：权限拒绝、拍照取消、重拍替换、使用照片之前不上行、未确认不进入教学。
- [ ] 相机仅在孩子点击拍照后打开；无相机/权限被拒时给出可理解说明与返回，不偷偷改成相册导入。
- [ ] 显示照片预览，允许重拍；确认使用后才识别题意。模糊/多题时要求重拍或口头指明，不默认选第一题。
- [ ] 原图和题意并列核对；语音纠正后更新候选版本，孩子确认后锁定本题来源。题意核对阶段禁止输出解题过程。
- [ ] 在真实 iPad 拍一道合成纸面题并核对数字、单位、问题目标；UI 注入图片仅用于自动测试，不冒充相机验收。

通过条件：真正从相机进入一道题，取消和识别失败均不丢原有学习草稿。

### 任务 4：统一语音与画布的五轮闭环

- [ ] 新增 `apps/ipad/ScholarPad/ScholarPadTests/LearningWorkspaceTests.swift`：开启一次语音后可多轮；题目照片不覆盖孩子笔迹；表达与邀请帮助走同一策略；后台停止收音。
- [ ] 新增统一入口，把旧三个页面收进调试路径，不删除旧代码；拍照题与 curated 题进入同一个 model/client。
- [ ] 同一轮绑定 problemId、submissionId、revision、孩子已提交解释及画布快照；旧音频/旧图形不得应用到新题或新稿。
- [ ] 播放结束后恢复可交流状态，不要求每轮重新点击连接；停止播放/纠正同时停本地播放与上游生成，丢弃迟到片段。
- [ ] 界面明确区分“正在听/老师在说/已暂停/未连接”；不把空白画布或题目原图当成孩子的解释。
- [ ] 真机成人连续五轮：表达 → 题意询问 → 邀请查看 → 纠正一次误读 → 求助 → 再次独立表达。记录每轮实际证据，失败停在该链路修复，不以新增模块补进度。

通过条件：不需要家长帮忙切页面/重连；有真实麦克风到扬声器的观察记录，不能拼接独立云探针与本地音频测试冒充通过。

### 任务 5：第一阶段最低保存与恢复

- [ ] 在 `learning-session-store.test.ts` 与 `LearningSessionCacheTests.swift` 加入照片引用、已确认题意、PKDrawing 原稿、合成预览分别往返保存的测试。
- [ ] 修正图片误入 childInkBase64 的路径；明确旧记录格式识别，坏数据不当成 PKDrawing，也不覆盖旧存档。
- [ ] 保存等待确认后才显示成功；失败保留本地未同步稿。退出不能先断连接再假称已保存，删除失败不能被 UI 吞掉。
- [ ] 真机退出并重新打开，手动继续能看到原题和可编辑原稿；不自动开麦、不补播旧回复。
- [ ] 写阶段一验收结果，列明语音门禁、相机、五轮、保存四项分别是否通过。

通过条件：第一阶段可用且不丢稿。此项不是完整跨设备同步平台。

## 3. 阶段二与三的交付门槛

阶段一通过前不并行建设完整图形库/记忆系统。

- [ ] 阶段二先从真实题目选一种最需要的图形，逐一验证“老师生成 → 宿主校验 → 孩子操作/圈画 → 隐藏提示后继续”；等分、单位、尺度等数学关系必须准确。
- [ ] 保持孩子原稿独立；异议后旧判断停止使用。迁移有求助如实标记，不宣称独立完成。
- [ ] 单独核实辅助图片生成能力；不假设 Omni 输出图片，不新增供应商或费用配置绕过用户决定。无生成能力仍可完成结构化图形验收。
- [ ] 阶段三补齐宿主重启、断网、本机草稿缺失与冲突的恢复，事实重建不包含未播放/被异议的结论。
- [ ] 将“今天探索”接入同一工作空间和存档，使用现有题包，不建立第四套流程。
- [ ] 家长陪伴孩子完成一次真实探索，观察能否解释、检验与独立尝试；记录事实，不自动产出能力评级。

阶段二/三实施时再写对应小任务计划，不用阶段一未经验证的接口预写大批代码。

## 4. 验证命令与交接要求

后端与契约相关变更：

```sh
pnpm --filter @ai-scholar/session-contracts test
pnpm --filter @ai-scholar/agent-host test test/learning-tutor.test.ts test/learning-tutor-store.test.ts test/learning-session-store.test.ts
pnpm --filter @ai-scholar/agent-host typecheck
```

新增 test 文件用同一 vitest 命令指定实际路径；必须先观察预期失败，再实现，再观察通过。

iPad 在 `apps/ipad/ScholarPad` 执行 `xcodegen generate`，核实设备后串行执行相关套件，例如已有真实设备路径：

```sh
xcodebuild -project ScholarPad.xcodeproj -scheme ScholarPad -destination 'platform=iOS,id=00008112-000509D9268A201E' -destination-timeout 30 -derivedDataPath /tmp/ai-dtl-unified-learning -only-testing:ScholarPadTests/LearningSessionClientTests DEVELOPMENT_TEAM=YZQ2T35W5C test
```

每项交接提供：改动文件、命令/结果、真实上游与真机证据、未通过项、下一步。代码编译/安装不等于教学验收；不重复沿用旧成功次数。没有请求时不提交/推送，不把全部未跟踪文件一并暂存。

## 5. 本文自检

- 入口遵循用户最新纠正：直接拍照，未保留相册/文字入口。
- 五上当前单元、持续交流与主动介入、两类图形、事实记忆都映射到任务/阶段。
- 当前仅阶段一是实施主线；最低存档不推迟到阶段三。
- 现有三套代码复用但不维持三个儿童产品入口。
- 生成图片、全双工、长期画像不冒充已支持，也不成为第一阶段不交付的借口。
